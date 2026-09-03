import { describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { WritableStreamImpl } from '../../../../src/streams/writable-stream';
import type { WritableStreamDefaultControllerImpl } from '../../../../src/streams/writable-stream-default-controller';
import { idlType } from '../../../../src/web-idl/declaration/index';
import {
  observeBrowletPromise, performTestMicrotaskCheckpoint,
} from '../test-runtime';
import { createTestContext, unwrapStreamPromise } from './environment';

describe('writable-stream implementation', () => {
  it('treats unresolved Promise<undefined> capabilities as pending', () => {
    const context = createTestContext();
    const promise = context.createPromise(idlType.undefined);

    expect(context.isPromiseUnresolved(promise)).toBe(true);
    context.resolvePromise(promise, undefined);
    expect(context.isPromiseUnresolved(promise)).toBe(false);
  });

  it('keeps writable state per implementation instance', () => {
    const context = createTestContext();
    const first = new WritableStreamImpl(context);
    const second = new WritableStreamImpl(context);

    expect(first.context).toBe(context);
    expect(second.context).toBe(context);
    expect(first.state).not.toBe(second.state);
  });

  it('writes queued chunks and closes the underlying sink', async () => {
    const write = vi.fn();
    const close = vi.fn(() => Promise.resolve(undefined));
    const stream = new WritableStreamImpl(createTestContext(), {
      close,
      write,
    });
    const writer = stream.getWriter();

    await expect(unwrapStreamPromise(writer.write('first'))).resolves
      .toBeUndefined();
    await expect(unwrapStreamPromise(writer.write('second'))).resolves
      .toBeUndefined();
    await expect(unwrapStreamPromise(writer.close())).resolves.toBeUndefined();

    expect(write.mock.calls).toEqual([
      ['first', expect.any(Object)],
      ['second', expect.any(Object)],
    ]);
    expect(close).toHaveBeenCalledOnce();
    await expect(unwrapStreamPromise(writer.closed)).resolves.toBeUndefined();
  });

  it('locks the stream until its writer releases the lock', () => {
    const stream = new WritableStreamImpl(createTestContext());
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
    const context = createTestContext({
      createAbortController: () => abortController,
    });
    const stream = new WritableStreamImpl(context, { abort: sinkAbort });
    const controller = requireController(stream);

    expect(controller.signal).toBe(abortController.signal);
    await expect(unwrapStreamPromise(stream.abort('stop'))).resolves
      .toBeUndefined();
    expect(abortController.abort).toHaveBeenCalledWith('stop');
    expect(sinkAbort).toHaveBeenCalledWith('stop');
  });

  it('applies backpressure until queued writes drain', async () => {
    let finishWrite: (() => void) | undefined;
    const stream = new WritableStreamImpl(
      createTestContext(),
      {
        write: () => new Promise<undefined>((resolve) => {
          finishWrite = () => resolve(undefined);
        }),
      },
      { highWaterMark: 1 },
    );
    const writer = stream.getWriter();
    const write = unwrapStreamPromise(writer.write('chunk'));

    expect(writer.desiredSize).toBe(0);
    const ready = unwrapStreamPromise(writer.ready);
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

  it('rejects writes with a TypeError once close is queued while erroring', async () => {
    const context = createTestContext();
    const failure = new Error('stream failure');
    let controller: WritableStreamDefaultControllerImpl | undefined;
    const stream = new WritableStreamImpl(context, {
      start(value: WritableStreamDefaultControllerImpl) {
        controller = value;
        return new Promise(() => undefined);
      },
    });
    const writer = stream.getWriter();

    void unwrapStreamPromise(writer.close());
    if (!controller) throw new Error('Writable stream did not start');
    controller.error(failure);

    const writing = unwrapStreamPromise(writer.write('late'));
    await expect(writing).rejects.toBeInstanceOf(
      context.realm.intrinsics.typeError,
    );
    await expect(writing).rejects.not.toBe(failure);
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

  it('keeps implementation state off the platform objects', () => {
    const window = new Browlet({ route: () => '' }).window;
    const WritableStream_ = requireConstructor(window, 'WritableStream');
    let controller: object | undefined;
    const stream = Reflect.construct(WritableStream_, [{
      start(value: object) { controller = value; },
    }]) as object;
    const writer = Reflect.apply(
      requireMethod(stream, 'getWriter'),
      stream,
      [],
    ) as object;

    if (!controller) throw new Error('Writable stream did not start');
    for (const value of [stream, writer, controller]) {
      expect(Reflect.has(value, 'state')).toBe(false);
      expect(Reflect.has(value, 'context')).toBe(false);
    }
  });

  it('writes through the projected writer surface', async () => {
    const window = new Browlet({ route: () => '' }).window;
    const WritableStream_ = requireConstructor(window, 'WritableStream');
    const write = vi.fn();
    const stream = Reflect.construct(WritableStream_, [{ write }]) as object;
    const writer = Reflect.apply(
      requireMethod(stream, 'getWriter'),
      stream,
      [],
    ) as object;

    const writing = observeBrowletPromise(window, Reflect.apply(
      requireMethod(writer, 'write'), writer, ['chunk'],
    ) as Promise<unknown>);
    performTestMicrotaskCheckpoint(window);
    await expect(writing).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledWith('chunk', expect.any(Object));
  });

  it('turns a thrown sink callback exception into a rejected promise', async () => {
    const window = new Browlet({ route: () => '' }).window;
    const WritableStream_ = requireConstructor(window, 'WritableStream');
    const failure = new Error('write failed');
    const stream = Reflect.construct(WritableStream_, [{
      write() { throw failure; },
    }]) as object;
    const writer = Reflect.apply(
      requireMethod(stream, 'getWriter'),
      stream,
      [],
    ) as object;

    const writing = observeBrowletPromise(window, Reflect.apply(
      requireMethod(writer, 'write'), writer, ['chunk'],
    ) as Promise<unknown>);
    performTestMicrotaskCheckpoint(window);
    await expect(writing).rejects.toBe(failure);
  });

  it('creates stream failures in the relevant realm', () => {
    const window = new Browlet({ route: () => '' }).window;
    const WritableStream_ = requireConstructor(window, 'WritableStream');
    const TypeError_ = requireConstructor(window, 'TypeError');
    const RangeError_ = requireConstructor(window, 'RangeError');
    const stream = Reflect.construct(WritableStream_, []) as object;
    const writer = Reflect.apply(
      requireMethod(stream, 'getWriter'),
      stream,
      [],
    ) as object;

    Reflect.apply(requireMethod(writer, 'releaseLock'), writer, []);
    const releasedError = catchError(() => Reflect.get(
      writer,
      'desiredSize',
    ));
    const rangeError = catchError(() => Reflect.construct(
      WritableStream_,
      [{}, { highWaterMark: -1 }],
    ));

    expect(TypeError_).not.toBe(TypeError);
    expect(RangeError_).not.toBe(RangeError);
    expect(releasedError).toBeInstanceOf(TypeError_);
    expect(releasedError).not.toBeInstanceOf(TypeError);
    expect(rangeError).toBeInstanceOf(RangeError_);
    expect(rangeError).not.toBeInstanceOf(RangeError);
  });
});

function createAbortController() {
  const signal = {
    aborted: false,
    reason: undefined as unknown,
    addAlgorithm: () => null,
  };
  return {
    abort: vi.fn((reason?: unknown): void => {
      signal.aborted = true;
      signal.reason = reason;
    }),
    signal,
  };
}

function requireController(
  stream: WritableStreamImpl,
): WritableStreamDefaultControllerImpl {
  const { controller } = stream.state;
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

function catchError(steps: () => unknown): unknown {
  try {
    steps();
  } catch (error) {
    return error;
  }
  throw new Error('Expected steps to throw');
}
