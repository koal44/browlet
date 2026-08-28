import { describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { WritableStreamImpl } from '../../../../src/streams/writable-stream';
import type { WritableStreamDefaultControllerImpl } from '../../../../src/streams/writable-stream-default-controller';
import {
  getWritableStreamEnvironment, getWritableStreamState,
} from '../../../../src/streams/writable-stream-slots';
import { idlType } from '../../../../src/web-idl/declaration/index';
import { createTestEnvironment } from './environment';

describe('writable-stream implementation', () => {
  it('treats unresolved Promise<undefined> capabilities as pending', () => {
    const environment = createTestEnvironment();
    const promise = environment.promises.create(idlType.undefined);

    expect(environment.promises.isPending(promise)).toBe(true);
    environment.promises.resolve(promise, undefined);
    expect(environment.promises.isPending(promise)).toBe(false);
  });

  it('keeps writable state in per-instance slots', () => {
    const environment = createTestEnvironment();
    const first = new WritableStreamImpl(environment);
    const second = new WritableStreamImpl(environment);

    expect(getWritableStreamEnvironment(first)).toBe(environment);
    expect(getWritableStreamEnvironment(second)).toBe(environment);
    expect(getWritableStreamState(first)).not.toBe(
      getWritableStreamState(second),
    );
  });

  it('writes queued chunks and closes the underlying sink', async () => {
    const write = vi.fn(() => Promise.resolve(undefined));
    const close = vi.fn(() => Promise.resolve(undefined));
    const stream = new WritableStreamImpl(createTestEnvironment(), {
      close,
      write,
    });
    const writer = stream.getWriter();

    await expect(writer.write('first') as Promise<unknown>).resolves
      .toBeUndefined();
    await expect(writer.write('second') as Promise<unknown>).resolves
      .toBeUndefined();
    await expect(writer.close() as Promise<unknown>).resolves.toBeUndefined();

    expect(write.mock.calls).toEqual([
      ['first', expect.any(Object)],
      ['second', expect.any(Object)],
    ]);
    expect(close).toHaveBeenCalledOnce();
    await expect(writer.closed as Promise<unknown>).resolves.toBeUndefined();
  });

  it('locks the stream until its writer releases the lock', () => {
    const stream = new WritableStreamImpl(createTestEnvironment());
    const writer = stream.getWriter();

    expect(stream.locked).toBe(true);
    expect(() => stream.getWriter()).toThrow(/already been locked/u);

    writer.releaseLock();
    expect(stream.locked).toBe(false);
    expect(() => stream.getWriter()).not.toThrow();
  });

  it('uses the injected Abort capability and exposes its signal', async () => {
    const abortController = createAbortController();
    const sinkAbort = vi.fn(() => Promise.resolve(undefined));
    const environment = createTestEnvironment({
      createAbortController: () => abortController,
    });
    const stream = new WritableStreamImpl(environment, { abort: sinkAbort });
    const controller = requireController(stream);

    expect(controller.signal).toBe(abortController.signal);
    await expect(stream.abort('stop') as Promise<unknown>).resolves
      .toBeUndefined();
    expect(abortController.abort).toHaveBeenCalledWith('stop');
    expect(sinkAbort).toHaveBeenCalledWith('stop');
  });

  it('applies backpressure until queued writes drain', async () => {
    let finishWrite: (() => void) | undefined;
    const stream = new WritableStreamImpl(
      createTestEnvironment(),
      {
        write: () => new Promise<undefined>((resolve) => {
          finishWrite = () => resolve(undefined);
        }),
      },
      { highWaterMark: 1 },
    );
    const writer = stream.getWriter();
    const write = writer.write('chunk') as Promise<unknown>;

    expect(writer.desiredSize).toBe(0);
    const ready = writer.ready as Promise<unknown>;
    let readySettled = false;
    void ready.then(() => {
      readySettled = true;
    });
    await Promise.resolve();
    expect(readySettled).toBe(false);

    finishWrite?.();
    await expect(write).resolves.toBeUndefined();
    await expect(ready).resolves.toBeUndefined();
    expect(writer.desiredSize).toBe(1);
  });
});

describe('writable-stream projection', () => {
  it('creates its AbortSignal through the assembled bindings', () => {
    const window = new Browlet({ route: () => '' }).window;
    const WritableStream_ = requireConstructor(window, 'WritableStream');
    const AbortSignal_ = requireConstructor(window, 'AbortSignal');
    let controller: object | undefined;

    Reflect.construct(WritableStream_, [{
      start(value: object) {
        controller = value;
      },
    }]);

    if (!controller) throw new Error('Writable stream did not start');
    expect(Reflect.get(controller, 'signal')).toBeInstanceOf(AbortSignal_);
  });

  it('writes through the projected writer surface', async () => {
    const window = new Browlet({ route: () => '' }).window;
    const WritableStream_ = requireConstructor(window, 'WritableStream');
    const write = vi.fn(() => Promise.resolve(undefined));
    const stream = Reflect.construct(WritableStream_, [{ write }]) as object;
    const writer = Reflect.apply(
      requireMethod(stream, 'getWriter'),
      stream,
      [],
    ) as object;

    await expect(Reflect.apply(
      requireMethod(writer, 'write'),
      writer,
      ['chunk'],
    ) as Promise<unknown>).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledWith('chunk', expect.any(Object));
  });
});

function createAbortController() {
  return {
    abort: vi.fn((_reason?: unknown): void => {}),
    signal: {},
  };
}

function requireController(
  stream: WritableStreamImpl,
): WritableStreamDefaultControllerImpl {
  const controller = getWritableStreamState(stream).controller;
  if (!controller) throw new Error('Writable stream has no controller');
  return controller;
}

function requireConstructor(window: Window, name: string): CallableFunction {
  const constructor = Reflect.get(window, name) as unknown;
  if (typeof constructor !== 'function') {
    throw new TypeError(`${name} is not installed`);
  }
  return constructor;
}

function requireMethod(object: object, name: string): CallableFunction {
  const method = Reflect.get(object, name) as unknown;
  if (typeof method !== 'function') {
    throw new TypeError(`${name} is not callable`);
  }
  return method;
}
