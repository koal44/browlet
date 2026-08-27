import { describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { TransformStreamImpl } from '../../../../src/streams/transform-stream';
import type { TransformStreamDefaultControllerImpl } from '../../../../src/streams/transform-stream-default-controller';
import { createTestEnvironment } from './environment';

describe('transform-stream implementation', () => {
  it('uses the default identity transform', async () => {
    const stream = new TransformStreamImpl(createTestEnvironment());
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader({});
    const read = reader.read() as Promise<unknown>;

    await expect(writer.write('chunk') as Promise<unknown>).resolves
      .toBeUndefined();
    await expect(read).resolves.toEqual({ done: false, value: 'chunk' });

    await expect(writer.close() as Promise<unknown>).resolves.toBeUndefined();
    await expect(reader.read() as Promise<unknown>).resolves.toEqual({
      done: true,
      value: undefined,
    });
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
      createTestEnvironment(),
      { flush, transform },
    );
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader({});
    const firstRead = reader.read() as Promise<unknown>;

    await expect(writer.write('hello') as Promise<unknown>).resolves
      .toBeUndefined();
    await expect(firstRead).resolves.toEqual({
      done: false,
      value: 'HELLO',
    });

    const flushRead = reader.read() as Promise<unknown>;
    const close = writer.close() as Promise<unknown>;
    await expect(flushRead).resolves.toEqual({
      done: false,
      value: 'DONE',
    });
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
      createTestEnvironment(),
      { transform },
    );
    const writer = stream.writable.getWriter();
    const write = writer.write('waiting') as Promise<unknown>;
    let settled = false;
    void write.then(() => {
      settled = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(transform).not.toHaveBeenCalled();

    const read = stream.readable.getReader({}).read() as Promise<unknown>;
    await expect(write).resolves.toBeUndefined();
    await expect(read).resolves.toEqual({ done: false, value: 'waiting' });
    expect(transform).toHaveBeenCalledOnce();
  });

  it('errors both sides when transform rejects', async () => {
    const failure = new Error('transform failed');
    const stream = new TransformStreamImpl(createTestEnvironment(), {
      transform: () => Promise.reject(failure),
    });
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader({});
    const read = reader.read() as Promise<unknown>;

    await expect(writer.write('chunk') as Promise<unknown>).rejects
      .toBe(failure);
    await expect(read).rejects.toBe(failure);
    await expect(writer.closed as Promise<unknown>).rejects.toBe(failure);
    await expect(reader.closed as Promise<unknown>).rejects.toBe(failure);
  });

  it('runs the transformer cancel algorithm from either side', async () => {
    const readableReason = new Error('readable cancelled');
    const readableCancel = vi.fn(() => Promise.resolve(undefined));
    const readable = new TransformStreamImpl(
      createTestEnvironment(),
      { cancel: readableCancel },
    );

    await expect(readable.readable.cancel(readableReason) as Promise<unknown>)
      .resolves.toBeUndefined();
    expect(readableCancel).toHaveBeenCalledWith(readableReason);

    const writableReason = new Error('writable aborted');
    const writableCancel = vi.fn(() => Promise.resolve(undefined));
    const writable = new TransformStreamImpl(
      createTestEnvironment(),
      { cancel: writableCancel },
    );

    await expect(writable.writable.abort(writableReason) as Promise<unknown>)
      .resolves.toBeUndefined();
    expect(writableCancel).toHaveBeenCalledWith(writableReason);
  });

  it('closes the readable and errors the writable when terminated', async () => {
    let controller: TransformStreamDefaultControllerImpl | undefined;
    const stream = new TransformStreamImpl(createTestEnvironment(), {
      start(value: TransformStreamDefaultControllerImpl) {
        controller = value;
      },
    });
    const reader = stream.readable.getReader({});
    const writer = stream.writable.getWriter();

    requireController(controller).terminate();

    await expect(reader.read() as Promise<unknown>).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await expect(writer.closed as Promise<unknown>).rejects
      .toBeInstanceOf(TypeError);
  });
});

describe('transform-stream projection', () => {
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
    const read = Reflect.apply(
      requireFunction(reader, 'read'),
      reader,
      [],
    ) as Promise<unknown>;

    await expect(Reflect.apply(
      requireFunction(writer, 'write'),
      writer,
      ['projected'],
    ) as Promise<unknown>).resolves.toBeUndefined();
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
