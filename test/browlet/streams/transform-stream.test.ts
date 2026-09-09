import { describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';
import {
  browletBindings, getRelevantRealm,
} from '../../../src/browlet/bindings';
import { TransformStreamImpl } from '../../../src/streams/index';
import type { TransformStreamDefaultControllerImpl } from '../../../src/streams/transform-stream-default-controller';
import { RangeError, TypeError } from '../../../src/js-engine/simple-exception';
import {
  observeBrowletPromise, performTestMicrotaskCheckpoint,
} from '../test-runtime';
import { createTransformStream } from './implementation-fixture';

describe('transform-stream implementation', () => {
  it('validates transformer types before strategy high-water marks', () => {
    expect(() => createTransformStream({ readableType: 'bytes' }, { highWaterMark: -1 })).toThrow('Invalid readableType specified');
  });

  it('requests internal RangeErrors for unsupported transformer types', () => {
    expect(() => createTransformStream({ readableType: 'bytes' }))
      .toThrow(RangeError);
    expect(() => createTransformStream({ writableType: 'bytes' }))
      .toThrow(RangeError);
  });

  it('treats undefined transformer types as absent', () => {
    expect(() => createTransformStream({ readableType: undefined, writableType: undefined }, { highWaterMark: -1 })).toThrow('Invalid highWaterMark');
  });

  it('captures transformer members once and retains their original receiver', async () => {
    const getters: string[] = [];
    const calls: { name: string; receiver: unknown; }[] = [];
    const transformer = {
      get start() {
        getters.push('start');
        return function(this: unknown) {
          calls.push({ name: 'start', receiver: this });
        };
      },
      get transform() {
        getters.push('transform');
        return function(this: unknown, chunk: unknown, controller: TransformStreamDefaultControllerImpl) {
          calls.push({ name: 'transform', receiver: this });
          controller.enqueue(chunk);
          return Promise.resolve();
        };
      },
      get flush() {
        getters.push('flush');
        return function(this: unknown) {
          calls.push({ name: 'flush', receiver: this });
          return Promise.resolve();
        };
      },
    };
    const stream = createTransformStream(transformer);
    expect(getters).toEqual(['flush', 'start', 'transform']);
    const reader = stream.readable.getReader();
    const writer = stream.writable.getWriter();
    const read = reader.read();
    await writer.write('chunk');
    await expect(read).resolves.toEqual(readResult('chunk', false));
    await writer.close();
    expect(calls.map((call) => call.name)).toEqual(['start', 'transform', 'flush']);
    for (const call of calls) expect(call.receiver).toBe(transformer);
    expect(getters).toEqual(['flush', 'start', 'transform']);
  });

  it('uses the default identity transform', async () => {
    const stream = createTransformStream({});
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader({});
    const read = reader.read();

    await expect(writer.write('chunk')).resolves
      .toBeUndefined();
    await expect(read).resolves.toEqual(readResult('chunk', false));

    await expect(writer.close()).resolves.toBeUndefined();
    await expect(reader.read()).resolves
      .toEqual(readResult(undefined, true));
  });

  it('runs custom transform and flush algorithms', async () => {
    const transform = vi.fn((
      chunk: unknown,
      controller: TransformStreamDefaultControllerImpl,
    ) => {
      controller.enqueue(String(chunk).toUpperCase());
      return Promise.resolve(undefined);
    });
    const flush = vi.fn((controller: TransformStreamDefaultControllerImpl) => {
      controller.enqueue('DONE');
      return Promise.resolve(undefined);
    });
    const stream = createTransformStream({ flush, transform });
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader({});
    const firstRead = reader.read();

    await expect(writer.write('hello')).resolves
      .toBeUndefined();
    await expect(firstRead).resolves.toEqual(readResult('HELLO', false));

    const flushRead = reader.read();
    const close = writer.close();
    await expect(flushRead).resolves.toEqual(readResult('DONE', false));
    await expect(close).resolves.toBeUndefined();
    expect(transform).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledOnce();
  });

  it('holds writes until the readable side pulls', async () => {
    const transform = vi.fn((
      chunk: unknown,
      controller: TransformStreamDefaultControllerImpl,
    ) => {
      controller.enqueue(chunk);
      return Promise.resolve(undefined);
    });
    const stream = createTransformStream({ transform });
    const writer = stream.writable.getWriter();
    const write = writer.write('waiting');
    let settled = false;
    void write.then(() => {
      settled = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(transform).not.toHaveBeenCalled();

    const read = stream.readable.getReader({}).read();
    await expect(write).resolves.toBeUndefined();
    await expect(read).resolves.toEqual(readResult('waiting', false));
    expect(transform).toHaveBeenCalledOnce();
  });

  it('waits for start before invoking a transform', async () => {
    const start = Promise.withResolvers<void>();
    const transform = vi.fn((chunk: unknown, controller: TransformStreamDefaultControllerImpl) => {
      controller.enqueue(chunk);
      return Promise.resolve();
    });
    const stream = createTransformStream({ start: () => start.promise, transform });
    const reader = stream.readable.getReader();
    const writer = stream.writable.getWriter();
    const reading = reader.read();
    const writing = writer.write('after start');

    await Promise.resolve();
    expect(transform).not.toHaveBeenCalled();
    start.resolve();

    await writing;
    await expect(reading).resolves.toEqual(readResult('after start', false));
  });

  it('errors both sides when transform rejects', async () => {
    const failure = new Error('transform failed');
    const stream = createTransformStream({
      transform: () => Promise.reject(failure),
    });
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader({});
    const read = reader.read();

    await expect(writer.write('chunk')).rejects
      .toBe(failure);
    await expect(read).rejects.toBe(failure);
    await expect(writer.closed).rejects.toBe(failure);
    await expect(reader.closed).rejects.toBe(failure);
  });

  it('runs the transformer cancel algorithm from either side', async () => {
    const readableReason = new Error('readable cancelled');
    const readableCancel = vi.fn(() => Promise.resolve(undefined));
    const readable = createTransformStream({ cancel: readableCancel });

    await expect(readable.readable.cancel(readableReason))
      .resolves.toBeUndefined();
    expect(readableCancel).toHaveBeenCalledWith(readableReason);

    const writableReason = new Error('writable aborted');
    const writableCancel = vi.fn(() => Promise.resolve(undefined));
    const writable = createTransformStream({ cancel: writableCancel });

    await expect(writable.writable.abort(writableReason))
      .resolves.toBeUndefined();
    expect(writableCancel).toHaveBeenCalledWith(writableReason);
  });

  it('closes the readable and errors the writable when terminated', async () => {
    let controller: TransformStreamDefaultControllerImpl | undefined;
    const stream = createTransformStream({
      start(value: TransformStreamDefaultControllerImpl) {
        controller = value;
      },
    });
    const reader = stream.readable.getReader({});
    const writer = stream.writable.getWriter();

    requireController(controller).terminate();

    await expect(reader.read()).resolves
      .toEqual(readResult(undefined, true));
    await expect(writer.closed).rejects
      .toBeInstanceOf(TypeError);
  });
});

describe('transform-stream projection', () => {
  it('projects a cross-specification transform at the binding boundary', () => {
    const window = new Browlet({ route: () => '' }).window;
    const bindings = browletBindings.forRealm(getRelevantRealm(window));
    const stream = createTransformStream(null);
    stream.setUp(() => undefined);

    expect(bindings.context.resolvePlatformObject(stream)).toBeUndefined();
    const object = bindings.context.project(TransformStreamImpl, stream);
    const projectedStream = bindings.context.resolvePlatformObject(object);
    expect(projectedStream?.primaryInterface.definition.name)
      .toBe('TransformStream');
    expect(projectedStream?.implementation).toBe(stream);
  });

  it('keeps implementation state off the platform objects', () => {
    const window = new Browlet({ route: () => '' }).window;
    const TransformStream_ = requireFunction(window, 'TransformStream');
    let controller: object | undefined;
    const stream = Reflect.construct(TransformStream_, [{
      start(value: object) { controller = value; },
    }]) as object;
    const readable = requireObject(stream, 'readable');
    const writable = requireObject(stream, 'writable');

    if (!controller) throw new Error('Transform stream did not start');
    for (const value of [stream, controller, readable, writable]) {
      expect(Reflect.has(value, 'state')).toBe(false);
      expect(Reflect.has(value, 'context')).toBe(false);
    }
  });

  it('connects its projected writable and readable sides', async () => {
    const window = new Browlet({ route: () => '' }).window;
    const TransformStream_ = requireFunction(window, 'TransformStream');
    const stream = Reflect.construct(TransformStream_, []) as object;
    const writable = requireObject(stream, 'writable');
    const readable = requireObject(stream, 'readable');
    const writer = Reflect.apply(
      requireFunction(writable, 'getWriter'),
      writable,
      [],
    ) as object;
    const reader = Reflect.apply(
      requireFunction(readable, 'getReader'),
      readable,
      [],
    ) as object;
    const read = observeBrowletPromise(window, Reflect.apply(
      requireFunction(reader, 'read'), reader, [],
    ) as Promise<unknown>);

    const writing = observeBrowletPromise(window, Reflect.apply(
      requireFunction(writer, 'write'), writer, ['projected'],
    ) as Promise<unknown>);
    performTestMicrotaskCheckpoint(window);
    await expect(writing).resolves.toBeUndefined();
    await expect(read).resolves.toEqual({
      done: false,
      value: 'projected',
    });
  });
});

function requireFunction(object: object, name: string): CallableFunction {
  const value = Reflect.get(object, name) as unknown;
  if (typeof value !== 'function') {
    throw new TypeError(`${name} is not callable`);
  }
  return value;
}

function requireObject(object: object, name: string): object {
  const value = Reflect.get(object, name) as unknown;
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`${name} is not an object`);
  }
  return value;
}

function requireController(
  controller: TransformStreamDefaultControllerImpl | undefined,
): TransformStreamDefaultControllerImpl {
  if (!controller) throw new Error('Transform stream did not start');
  return controller;
}

function readResult(value: unknown, done: boolean): object {
  return { done, value };
}
