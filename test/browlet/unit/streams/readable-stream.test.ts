import { describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { ReadableStreamDefaultControllerImpl } from '../../../../src/streams/readable-stream-default-controller';
import type { ReadableByteStreamControllerImpl } from '../../../../src/streams/readable-byte-stream-controller';
import { ReadableStreamImpl } from '../../../../src/streams/readable-stream';
import { WritableStreamImpl } from '../../../../src/streams/writable-stream';
import { createTestEnvironment } from './environment';

describe('ordinary readable-stream implementation', () => {
  it('creates a stream from a synchronous iterable', async () => {
    const stream = ReadableStreamImpl.from(
      createTestEnvironment(),
      ['first', 'second'],
    );
    const reader = stream.getReader({});

    await expect(reader.read() as Promise<unknown>).resolves.toEqual({
      done: false,
      value: 'first',
    });
    await expect(reader.read() as Promise<unknown>).resolves.toEqual({
      done: false,
      value: 'second',
    });
    await expect(reader.read() as Promise<unknown>).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it('delivers enqueued chunks and then observes close', async () => {
    const { controller, stream } = createReadableStream();
    const reader = stream.getReader({});

    const chunk = reader.read() as Promise<unknown>;
    controller.enqueue('chunk');
    await expect(chunk).resolves.toEqual({ done: false, value: 'chunk' });

    controller.close();
    await expect(reader.read() as Promise<unknown>).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await expect(reader.closed as Promise<unknown>).resolves.toBeUndefined();
  });

  it('locks a stream until its reader is released', () => {
    const { stream } = createReadableStream();
    const reader = stream.getReader({});

    expect(stream.locked).toBe(true);
    expect(() => stream.getReader({})).toThrow(/already been locked/u);

    reader.releaseLock();
    expect(stream.locked).toBe(false);
    expect(() => stream.getReader({})).not.toThrow();
  });

  it('forwards cancellation to the underlying source', async () => {
    const cancel = vi.fn(() => Promise.resolve(undefined));
    const { stream } = createReadableStream({ cancel });

    await expect(stream.cancel('finished') as Promise<unknown>).resolves
      .toBeUndefined();
    expect(cancel).toHaveBeenCalledWith('finished');
  });

  it('pipes chunks to a writable stream and propagates close', async () => {
    const environment = createTestEnvironment();
    let controller: ReadableStreamDefaultControllerImpl | undefined;
    const source = new ReadableStreamImpl(environment, {
      start(value: ReadableStreamDefaultControllerImpl) {
        controller = value;
      },
    });
    const write = vi.fn(() => Promise.resolve(undefined));
    const close = vi.fn(() => Promise.resolve(undefined));
    const destination = new WritableStreamImpl(environment, { close, write });
    const piping = source.pipeTo(destination) as Promise<unknown>;

    requireDefaultController(controller).enqueue('first');
    requireDefaultController(controller).enqueue('second');
    requireDefaultController(controller).close();

    await expect(piping).resolves.toBeUndefined();
    expect(write.mock.calls).toEqual([
      ['first', expect.any(Object)],
      ['second', expect.any(Object)],
    ]);
    expect(close).toHaveBeenCalledOnce();
    expect(source.locked).toBe(false);
    expect(destination.locked).toBe(false);
  });

  it('aborts both sides of a pipe when its signal aborts', async () => {
    const environment = createTestEnvironment();
    const cancel = vi.fn(() => Promise.resolve(undefined));
    const abort = vi.fn(() => Promise.resolve(undefined));
    const source = new ReadableStreamImpl(environment, { cancel });
    const destination = new WritableStreamImpl(environment, { abort });
    const signal = new TestAbortSignal();
    const piping = source.pipeTo(destination, { signal }) as Promise<unknown>;

    signal.abort('stop');

    await expect(piping).rejects.toBe('stop');
    expect(cancel).toHaveBeenCalledWith('stop');
    expect(abort).toHaveBeenCalledWith('stop');
    expect(source.locked).toBe(false);
    expect(destination.locked).toBe(false);
  });

  it('aborts the destination when the readable stream errors', async () => {
    const environment = createTestEnvironment();
    let controller: ReadableStreamDefaultControllerImpl | undefined;
    const source = new ReadableStreamImpl(environment, {
      start(value: ReadableStreamDefaultControllerImpl) {
        controller = value;
      },
    });
    const abort = vi.fn(() => Promise.resolve(undefined));
    const destination = new WritableStreamImpl(environment, { abort });
    const piping = source.pipeTo(destination) as Promise<unknown>;
    const error = new Error('source failed');

    requireDefaultController(controller).error(error);

    await expect(piping).rejects.toBe(error);
    expect(abort).toHaveBeenCalledWith(error);
    expect(source.locked).toBe(false);
    expect(destination.locked).toBe(false);
  });

  it('tees an ordinary stream into two independently readable branches', async () => {
    const { controller, stream } = createReadableStream();
    const [branch1, branch2] = stream.tee();
    const reader1 = branch1.getReader({});
    const reader2 = branch2.getReader({});
    const read1 = reader1.read() as Promise<ReadableStreamReadResult>;
    const read2 = reader2.read() as Promise<ReadableStreamReadResult>;

    controller.enqueue('shared');
    controller.close();

    await expect(read1).resolves.toEqual({ done: false, value: 'shared' });
    await expect(read2).resolves.toEqual({ done: false, value: 'shared' });
    await expect(reader1.read() as Promise<unknown>).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await expect(reader2.read() as Promise<unknown>).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it('cancels a tee source after both branches cancel', async () => {
    const cancel = vi.fn(() => Promise.resolve(undefined));
    const { stream } = createReadableStream({ cancel });
    const [branch1, branch2] = stream.tee();
    const cancel1 = branch1.cancel('one') as Promise<unknown>;

    expect(cancel).not.toHaveBeenCalled();
    const cancel2 = branch2.cancel('two') as Promise<unknown>;

    await expect(Promise.all([cancel1, cancel2])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(cancel).toHaveBeenCalledWith(['one', 'two']);
  });
});

describe('readable-stream projection', () => {
  it('projects ReadableStream.from() and asynchronous iteration', async () => {
    const window = new Browlet({ route: () => '' }).window;
    const ReadableStream_ = requireFunction(window, 'ReadableStream');
    const stream = Reflect.apply(
      requireFunction(ReadableStream_, 'from'),
      ReadableStream_,
      [['first', 'second']],
    ) as object;
    const iterator = Reflect.apply(
      requireFunction(stream, Symbol.asyncIterator),
      stream,
      [],
    ) as object;

    await expect(callIterator(iterator, 'next')).resolves.toEqual({
      done: false,
      value: 'first',
    });
    await expect(callIterator(iterator, 'next')).resolves.toEqual({
      done: false,
      value: 'second',
    });
    await expect(callIterator(iterator, 'next')).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(Reflect.get(stream, 'locked')).toBe(false);
  });

  it('cancels iteration unless preventCancel is true', async () => {
    const window = new Browlet({ route: () => '' }).window;
    const ReadableStream_ = requireFunction(window, 'ReadableStream');
    const returned = vi.fn(() => Promise.resolve({ done: true }));
    const source = {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise(() => {}),
        return: returned,
      }),
    };
    const cancelingStream = Reflect.apply(
      requireFunction(ReadableStream_, 'from'),
      ReadableStream_,
      [source],
    ) as object;
    const cancelingIterator = Reflect.apply(
      requireFunction(cancelingStream, 'values'),
      cancelingStream,
      [],
    ) as object;

    await expect(callIterator(cancelingIterator, 'return', ['stop']))
      .resolves.toEqual({ done: true, value: 'stop' });
    expect(returned).toHaveBeenCalledWith('stop');

    const retainingStream = Reflect.apply(
      requireFunction(ReadableStream_, 'from'),
      ReadableStream_,
      [source],
    ) as object;
    const retainingIterator = Reflect.apply(
      requireFunction(retainingStream, 'values'),
      retainingStream,
      [{ preventCancel: true }],
    ) as object;
    await expect(callIterator(retainingIterator, 'return'))
      .resolves.toEqual({ done: true, value: undefined });
    expect(returned).toHaveBeenCalledOnce();
    expect(Reflect.get(retainingStream, 'locked')).toBe(false);
  });
});

describe('readable byte-stream implementation', () => {
  it('tees bytes into independently owned chunks', async () => {
    let controller: ReadableByteStreamControllerImpl | undefined;
    const stream = new ReadableStreamImpl(createTestEnvironment(), {
      start(value: ReadableByteStreamControllerImpl) {
        controller = value;
      },
      type: 'bytes',
    });
    const [branch1, branch2] = stream.tee();
    const read1 = branch1.getReader({}).read() as Promise<
      ReadableStreamReadResult
    >;
    const read2 = branch2.getReader({}).read() as Promise<
      ReadableStreamReadResult
    >;

    requireByteController(controller).enqueue(Uint8Array.from([3, 4, 5]));

    const result1 = await read1;
    const result2 = await read2;
    expect(Array.from(result1.value as Uint8Array)).toEqual([3, 4, 5]);
    expect(Array.from(result2.value as Uint8Array)).toEqual([3, 4, 5]);
    expect((result1.value as Uint8Array).buffer).not.toBe(
      (result2.value as Uint8Array).buffer,
    );
  });

  it('coordinates BYOB and default readers across byte tee branches', async () => {
    let controller: ReadableByteStreamControllerImpl | undefined;
    const stream = new ReadableStreamImpl(createTestEnvironment(), {
      start(value: ReadableByteStreamControllerImpl) {
        controller = value;
      },
      type: 'bytes',
    });
    const [byobBranch, defaultBranch] = stream.tee();
    const byobRead = byobBranch.getReader({ mode: 'byob' }).read(
      new Uint8Array(4),
      { min: 1 },
    ) as Promise<ReadableStreamReadResult>;
    const defaultRead = defaultBranch.getReader({}).read() as Promise<
      ReadableStreamReadResult
    >;

    requireByteController(controller).enqueue(Uint8Array.from([6, 7]));

    expect(Array.from((await byobRead).value as Uint8Array)).toEqual([6, 7]);
    expect(Array.from((await defaultRead).value as Uint8Array)).toEqual([6, 7]);
  });

  it('delivers enqueued bytes to a default reader', async () => {
    let controller: ReadableByteStreamControllerImpl | undefined;
    const stream = new ReadableStreamImpl(createTestEnvironment(), {
      start(value: ReadableByteStreamControllerImpl) {
        controller = value;
      },
      type: 'bytes',
    });
    const reader = stream.getReader({});
    const read = reader.read() as Promise<ReadableStreamReadResult>;
    const chunk = Uint8Array.from([1, 2, 3]);

    requireByteController(controller).enqueue(chunk);

    await expect(read).resolves.toMatchObject({ done: false });
    const result = await read;
    expect(Array.from(result.value as Uint8Array)).toEqual([1, 2, 3]);
    expect(chunk.buffer.detached).toBe(true);
  });

  it('fills a BYOB request and returns a view over transferred storage', async () => {
    let controller: ReadableByteStreamControllerImpl | undefined;
    const stream = new ReadableStreamImpl(createTestEnvironment(), {
      start(value: ReadableByteStreamControllerImpl) {
        controller = value;
      },
      type: 'bytes',
    });
    const reader = stream.getReader({ mode: 'byob' });
    const supplied = new Uint16Array(4);
    const read = reader.read(supplied, { min: 2 }) as Promise<
      ReadableStreamReadResult
    >;
    const request = requireByteController(controller).byobRequest;
    if (!request?.view) throw new Error('Missing BYOB request');
    (request.view as Uint8Array).set([1, 0, 2, 0]);

    request.respond(4);

    const result = await read;
    expect(result.done).toBe(false);
    expect(Array.from(result.value as Uint16Array)).toEqual([1, 2]);
    expect(supplied.buffer.detached).toBe(true);
  });

  it('auto-allocates a pull-into buffer for a default reader', async () => {
    const stream = new ReadableStreamImpl(createTestEnvironment(), {
      autoAllocateChunkSize: 4,
      pull(controller: ReadableByteStreamControllerImpl) {
        const request = controller.byobRequest;
        if (!request?.view) throw new Error('Missing auto-allocated request');
        (request.view as Uint8Array).set([7, 8]);
        request.respond(2);
        return Promise.resolve(undefined);
      },
      type: 'bytes',
    });

    const result = await (
      stream.getReader({}).read() as Promise<ReadableStreamReadResult>
    );

    expect(Array.from(result.value as Uint8Array)).toEqual([7, 8]);
  });

  it('fulfills a pending BYOB read with an empty view on close', async () => {
    let controller: ReadableByteStreamControllerImpl | undefined;
    const stream = new ReadableStreamImpl(createTestEnvironment(), {
      start(value: ReadableByteStreamControllerImpl) {
        controller = value;
      },
      type: 'bytes',
    });
    const reader = stream.getReader({ mode: 'byob' });
    const read = reader.read(new Uint8Array(2), { min: 1 }) as Promise<
      ReadableStreamReadResult
    >;
    const byteController = requireByteController(controller);

    byteController.close();
    const request = byteController.byobRequest;
    if (!request) throw new Error('Missing closing BYOB request');
    request.respond(0);

    const result = await read;
    expect(result.done).toBe(true);
    expect((result.value as Uint8Array).byteLength).toBe(0);
  });

  it('rejects a BYOB reader for an ordinary readable stream', () => {
    const { stream } = createReadableStream();

    expect(() => stream.getReader({ mode: 'byob' })).toThrow(
      /requires a stream constructed with a byte source/u,
    );
  });
});

function createReadableStream(
  source: { cancel?(reason: unknown): Promise<undefined>; } = {},
): {
  controller: ReadableStreamDefaultControllerImpl;
  stream: ReadableStreamImpl;
} {
  const environment = createTestEnvironment();
  const stream = new ReadableStreamImpl(environment, source);
  const controller = ReadableStreamImpl.getState(stream).controller;
  if (!(controller instanceof ReadableStreamDefaultControllerImpl)) {
    throw new Error('Readable stream has no default controller');
  }
  return { controller, stream };
}

function requireByteController(
  controller: ReadableByteStreamControllerImpl | undefined,
): ReadableByteStreamControllerImpl {
  if (!controller) throw new Error('Readable byte stream has no controller');
  return controller;
}

function requireDefaultController(
  controller: ReadableStreamDefaultControllerImpl | undefined,
): ReadableStreamDefaultControllerImpl {
  if (!controller) throw new Error('Missing readable stream controller');
  return controller;
}

class TestAbortSignal
{
  aborted = false;
  reason: unknown = undefined;
  readonly #algorithms = new Set<() => void>();

  abort(reason: unknown): void {
    this.aborted = true;
    this.reason = reason;
    for (const algorithm of this.#algorithms) algorithm();
  }

  addEventListener(_type: 'abort', callback: () => void): void {
    this.#algorithms.add(callback);
  }

  removeEventListener(_type: 'abort', callback: () => void): void {
    this.#algorithms.delete(callback);
  }
}

type ReadableStreamReadResult = {
  done: boolean;
  value?: unknown;
};

function requireFunction(object: object, key: PropertyKey): CallableFunction {
  const value = Reflect.get(object, key) as unknown;
  if (typeof value !== 'function') {
    throw new TypeError(`${String(key)} is not callable`);
  }
  return value;
}

function callIterator(
  iterator: object,
  operation: 'next' | 'return',
  argumentsList: unknown[] = [],
): Promise<unknown> {
  return Reflect.apply(
    requireFunction(iterator, operation),
    iterator,
    argumentsList,
  ) as Promise<unknown>;
}
