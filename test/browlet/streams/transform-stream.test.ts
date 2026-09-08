import { describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';
import {
  browletBindings, getRelevantRealm,
} from '../../../src/browlet/bindings';
import { internalStreamSetup, TransformStreamImpl } from '../../../src/streams/index';
import type { TransformStreamDefaultControllerImpl } from '../../../src/streams/transform-stream-default-controller';
import {
  observeBrowletPromise, performTestMicrotaskCheckpoint,
} from '../test-runtime';
import { createTestContext, unwrapStreamPromise } from './environment';

describe('transform-stream implementation', () => {
  it('validates transformer types before strategy high-water marks', () => {
    expect(() => new TransformStreamImpl(
      createTestContext(),
      { readableType: 'bytes' },
      { highWaterMark: -1 },
    )).toThrow('Invalid readableType specified');
  });

  it('uses the default identity transform', async () => {
    const stream = new TransformStreamImpl(createTestContext());
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader({});
    const read = unwrapStreamPromise(reader.read());

    await expect(unwrapStreamPromise(writer.write('chunk'))).resolves
      .toBeUndefined();
    await expect(read).resolves.toEqual(readResult('chunk', false));

    await expect(unwrapStreamPromise(writer.close())).resolves.toBeUndefined();
    await expect(unwrapStreamPromise(reader.read())).resolves
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
    const stream = new TransformStreamImpl(
      createTestContext(),
      { flush, transform },
    );
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader({});
    const firstRead = unwrapStreamPromise(reader.read());

    await expect(unwrapStreamPromise(writer.write('hello'))).resolves
      .toBeUndefined();
    await expect(firstRead).resolves.toEqual(readResult('HELLO', false));

    const flushRead = unwrapStreamPromise(reader.read());
    const close = unwrapStreamPromise(writer.close());
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
    const stream = new TransformStreamImpl(
      createTestContext(),
      { transform },
    );
    const writer = stream.writable.getWriter();
    const write = unwrapStreamPromise(writer.write('waiting'));
    let settled = false;
    void write.then(() => {
      settled = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(transform).not.toHaveBeenCalled();

    const read = unwrapStreamPromise(stream.readable.getReader({}).read());
    await expect(write).resolves.toBeUndefined();
    await expect(read).resolves.toEqual(readResult('waiting', false));
    expect(transform).toHaveBeenCalledOnce();
  });

  it('errors both sides when transform rejects', async () => {
    const failure = new Error('transform failed');
    const stream = new TransformStreamImpl(createTestContext(), {
      transform: () => Promise.reject(failure),
    });
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader({});
    const read = unwrapStreamPromise(reader.read());

    await expect(unwrapStreamPromise(writer.write('chunk'))).rejects
      .toBe(failure);
    await expect(read).rejects.toBe(failure);
    await expect(unwrapStreamPromise(writer.closed)).rejects.toBe(failure);
    await expect(unwrapStreamPromise(reader.closed)).rejects.toBe(failure);
  });

  it('runs the transformer cancel algorithm from either side', async () => {
    const readableReason = new Error('readable cancelled');
    const readableCancel = vi.fn(() => Promise.resolve(undefined));
    const readable = new TransformStreamImpl(
      createTestContext(),
      { cancel: readableCancel },
    );

    await expect(unwrapStreamPromise(
      readable.readable.cancel(readableReason),
    ))
      .resolves.toBeUndefined();
    expect(readableCancel).toHaveBeenCalledWith(readableReason);

    const writableReason = new Error('writable aborted');
    const writableCancel = vi.fn(() => Promise.resolve(undefined));
    const writable = new TransformStreamImpl(
      createTestContext(),
      { cancel: writableCancel },
    );

    await expect(unwrapStreamPromise(
      writable.writable.abort(writableReason),
    ))
      .resolves.toBeUndefined();
    expect(writableCancel).toHaveBeenCalledWith(writableReason);
  });

  it('closes the readable and errors the writable when terminated', async () => {
    const context = createTestContext();
    let controller: TransformStreamDefaultControllerImpl | undefined;
    const stream = new TransformStreamImpl(context, {
      start(value: TransformStreamDefaultControllerImpl) {
        controller = value;
      },
    });
    const reader = stream.readable.getReader({});
    const writer = stream.writable.getWriter();

    requireController(controller).terminate();

    await expect(unwrapStreamPromise(reader.read())).resolves
      .toEqual(readResult(undefined, true));
    await expect(unwrapStreamPromise(writer.closed)).rejects
      .toBeInstanceOf(context.realm.intrinsics.typeError);
  });
});

describe('transform-stream projection', () => {
  it('projects a cross-specification transform at the binding boundary', () => {
    const window = new Browlet({ route: () => '' }).window;
    const bindings = browletBindings.forRealm(getRelevantRealm(window));
    const TransformStream_ = requireFunction(window, 'TransformStream');
    const projected = Reflect.construct(TransformStream_, []) as object;
    const resolved = bindings.context.resolvePlatformObject(projected);
    if (resolved?.primaryInterface.definition.name !== 'TransformStream') {
      throw new Error('TransformStream did not resolve to its implementation');
    }
    const stream = new TransformStreamImpl(
      (resolved.implementation as TransformStreamImpl).context,
      internalStreamSetup,
    );
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
