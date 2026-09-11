import { createRuntime } from '../../js-engine/runtime-fixture';
import { observe, createWritableStream } from './implementation-fixture';
import { describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';
import {
  WritableStreamImpl, type WritableStreamDefaultControllerImpl,
} from '../../../src/streams/index';
import { observeBrowletPromise, performTestMicrotaskCheckpoint } from '../test-runtime';

describe('writable-stream implementation', () => {
  it('keeps writable state per implementation instance', () => {
    const first = createWritableStream();
    const second = createWritableStream();

    expect(first.state).not.toBe(second.state);
  });

  it('writes queued chunks and closes the underlying sink', async () => {
    const runtime = createRuntime();
    const { promises } = runtime;
    const write = vi.fn();
    const close = vi.fn(() => promises.resolve(undefined));
    const stream = createWritableStream({
      close,
      write,
    });
    const writer = stream.getWriter();

    await expect(observe(writer.write('first'))).resolves
      .toBeUndefined();
    await expect(observe(writer.write('second'))).resolves
      .toBeUndefined();
    await expect(observe(writer.close())).resolves.toBeUndefined();

    expect(write.mock.calls).toEqual([
      ['first', expect.any(Object)],
      ['second', expect.any(Object)],
    ]);
    expect(close).toHaveBeenCalledOnce();
    await expect(observe(writer.closed)).resolves.toBeUndefined();
  });

  it('locks the stream until its writer releases the lock', () => {
    const stream = createWritableStream();
    const writer = stream.getWriter();

    expect(stream.locked).toBe(true);
    expect(() => stream.getWriter()).toThrow(/already been locked/u);

    writer.releaseLock();
    expect(stream.locked).toBe(false);
    expect(() => stream.getWriter()).not.toThrow();
  });

  it('uses the injected Abort capability and exposes its signal', async () => {
    const runtime = createRuntime();
    const { promises } = runtime;
    const abortController = createAbortController();
    vi.spyOn(runtime, 'createAbortController').mockReturnValue(abortController);
    const sinkAbort = vi.fn(() => promises.resolve(undefined));
    const stream = new WritableStreamImpl({ abort: sinkAbort }, {}, runtime);
    const controller = requireController(stream);

    expect(controller.signal).toBe(abortController.signal);
    await expect(observe(stream.abort('stop'))).resolves
      .toBeUndefined();
    expect(abortController.abort).toHaveBeenCalledWith('stop');
    expect(sinkAbort).toHaveBeenCalledWith('stop');
  });

  it('applies backpressure until queued writes drain', async () => {
    const runtime = createRuntime();
    const { promises } = runtime;
    const finishWrite = promises.withResolvers<void>();
    const stream = createWritableStream({
      write: () => finishWrite.promise,
    }, { highWaterMark: 1 });
    const writer = stream.getWriter();
    const write = writer.write('chunk');

    expect(writer.desiredSize).toBe(0);
    const ready = writer.ready;
    let readySettled = false;
    void observe(ready).then(() => {
      readySettled = true;
    });
    await Promise.resolve();
    expect(readySettled).toBe(false);

    finishWrite.resolve();
    await expect(observe(write)).resolves.toBeUndefined();
    await expect(observe(ready)).resolves.toBeUndefined();
    expect(writer.desiredSize).toBe(1);
  });

  it('signals abort immediately and waits for an in-flight write', async () => {
    const runtime = createRuntime();
    const { promises } = runtime;
    const writeStarted = promises.withResolvers<void>();
    const finishWrite = promises.withResolvers<void>();
    const abortController = createAbortController();
    vi.spyOn(runtime, 'createAbortController').mockReturnValue(abortController);
    const abort = vi.fn(() => promises.resolve());
    const stream = new WritableStreamImpl({
      write: () => {
        writeStarted.resolve();
        return finishWrite.promise;
      },
      abort,
    }, {}, runtime);
    const writer = stream.getWriter();
    const writing = writer.write('chunk');
    await observe(writeStarted.promise);

    const aborting = writer.abort('stop');
    expect(abortController.signal.aborted).toBe(true);
    expect(abort).not.toHaveBeenCalled();
    finishWrite.resolve();

    await observe(writing);
    await observe(aborting);
    expect(abort).toHaveBeenCalledExactlyOnceWith('stop');
    await expect(observe(writer.closed)).rejects.toBe('stop');
  });

  it('rejects writes with a TypeError once close is queued while erroring', async () => {
    const runtime = createRuntime();
    const { promises } = runtime;
    const failure = new Error('stream failure');
    let controller: WritableStreamDefaultControllerImpl | undefined;
    const stream = createWritableStream({
      start(value: WritableStreamDefaultControllerImpl) {
        controller = value;
        return promises.withResolvers<unknown>().promise;
      },
    });
    const writer = stream.getWriter();

    void writer.close();
    if (!controller) throw new Error('Writable stream did not start');
    controller.error(failure);

    const writing = writer.write('late');
    await expect(observe(writing)).rejects.toBeInstanceOf(
      TypeError,
    );
    await expect(observe(writing)).rejects.not.toBe(failure);
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
