import { createRuntime } from '../../js-engine/runtime-fixture';
import { createTransformStream, observe } from './implementation-fixture';
import { describe, expect, it, vi } from 'vitest';
import {
  createReadableStreamProxy, GenericTransformStreamMixin, ReadableStreamImpl,
  WritableStreamImpl,
} from '../../../src/streams/index';
import {
  getBufferSourceByteOffset, getBufferSourceCopy, getBufferSourceUnderlyingBuffer,
  writeArrayBufferView,
} from '../../../src/js-engine/index';

describe('Streams operations for other specifications', () => {
  it('drains buffered bytes without recursion or Node microtask scheduling', () => {
    const stream = ReadableStreamImpl.createDefault(undefined, undefined, 1, () => 1, createRuntime());
    for (let i = 0; i < 4_096; i++) stream.enqueueChunk(Uint8Array.of(i % 256));
    stream.close();
    const success = vi.fn();
    const failure = vi.fn();
    const schedule = vi.spyOn(globalThis, 'queueMicrotask');
    try {
      stream.getDefaultReader().readAllBytes(success, failure);
      expect(schedule).not.toHaveBeenCalled();
      expect(failure).not.toHaveBeenCalled();
      expect(success).toHaveBeenCalledExactlyOnceWith(
        Uint8Array.from({ length: 4_096 }, (_, i) => i % 256),
      );
    } finally {
      schedule.mockRestore();
    }
  });

  it('resumes byte reading when later chunks arrive', () => {
    const stream = ReadableStreamImpl.createDefault(undefined, undefined, 1, () => 1, createRuntime());
    const success = vi.fn();
    const failure = vi.fn();
    stream.getDefaultReader().readAllBytes(success, failure);
    expect(success).not.toHaveBeenCalled();
    stream.enqueueChunk(Uint8Array.of(1, 2));
    stream.enqueueChunk(Uint8Array.of(3));
    stream.close();
    expect(success).toHaveBeenCalledExactlyOnceWith(Uint8Array.of(1, 2, 3));
    expect(failure).not.toHaveBeenCalled();
  });

  it('retains the actual transform associated with a generic transform', () => {
    const transform = createTransformStream(null);
    transform.setUp(() => undefined);
    const generic = new GenericTransformStreamMixin(transform);

    expect(GenericTransformStreamMixin.getAssociatedTransform(generic))
      .toBe(transform);
    expect(generic.readable).toBe(transform.readable);
    expect(generic.writable).toBe(transform.writable);
  });

  it('creates, reads, and introspects an ordinary readable stream', async () => {
    let pulled = false;
    const stream: ReadableStreamImpl = ReadableStreamImpl.createDefault(
      () => {
        if (pulled) return;
        pulled = true;
        stream.enqueueChunk('chunk');
        stream.close();
      },
      undefined,
      1,
      () => 1,
      createRuntime(),
    );

    expect(stream.desiredSize).toBe(1);
    expect(stream.needsMoreData).toBe(true);
    expect(stream.isReadable).toBe(true);

    const reader = stream.getDefaultReader();
    expect(stream.locked).toBe(true);
    const chunk = new Promise<unknown>((resolve, reject) => {
      reader.readChunk({
        chunkSteps: resolve,
        closeSteps: () => reject(new Error('Stream closed without a chunk')),
        errorSteps: reject,
      });
    });

    await expect(chunk).resolves.toBe('chunk');
    expect(stream.disturbed).toBe(true);
    expect(stream.isClosed).toBe(true);
    reader.release();
    expect(stream.locked).toBe(false);
  });

  it('responds when a byte chunk uses the current BYOB request buffer', async () => {
    const stream: ReadableStreamImpl = ReadableStreamImpl.createWithByteReadingSupport(
      () => {
        const view = stream.byobRequestView;
        if (view === null) throw new Error('No current BYOB request');
        const chunk = new Uint8Array(getBufferSourceUnderlyingBuffer(view) as ArrayBuffer, getBufferSourceByteOffset(view), 2);
        writeArrayBufferView(chunk, [7, 8]);
        stream.enqueueChunk(chunk);
        stream.close();
      },
      undefined,
      0,
      createRuntime(),
    );
    const reader = stream.getReader({ mode: 'byob' });
    const destination = new Uint8Array([0, 0, 0, 0]);

    const result = await observe(reader.read(destination, { min: 1 }));

    expect(result.done).toBe(false);
    expect(getBufferSourceCopy(requireObject(result.value)))
      .toEqual(Uint8Array.from([7, 8]));
  });

  it('pulls bytes into a BYOB view without copying the remainder', async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    let offset = 1;
    const stream: ReadableStreamImpl = ReadableStreamImpl.createWithByteReadingSupport(
      () => {
        offset = stream.pullFromBytes(bytes, offset);
        stream.close();
      },
      undefined,
      0,
      createRuntime(),
    );
    const reader = stream.getReader({ mode: 'byob' });
    const destination = new Uint8Array([0, 0, 0, 0]);

    const result = await observe(reader.read(destination, { min: 1 }));

    expect(offset).toBe(4);
    expect(getBufferSourceCopy(requireObject(result.value)))
      .toEqual(Uint8Array.from([2, 3, 4]));
  });

  it('waits for internal promises returned by writable algorithms', async () => {
    const runtime = createRuntime();
    const { promises } = runtime;
    const finishWrite = promises.withResolvers<void>();
    const write = vi.fn(() => finishWrite.promise);
    const stream = WritableStreamImpl.createDefault(write, undefined, undefined, 1, () => 1, runtime);
    const writer = stream.getWriter();
    const writing = writer.writeInternal('chunk');
    let settled = false;
    void observe(writing).then(() => { settled = true; });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(stream.signal.aborted).toBe(false);
    finishWrite.resolve();
    await expect(observe(writing)).resolves.toBeUndefined();
    await expect(observe(stream.closeInternal()))
      .resolves.toBeUndefined();
    writer.release();
    expect(write).toHaveBeenCalledWith('chunk');
  });

  it('errors a writable stream and proxies a readable stream', async () => {
    const writable = WritableStreamImpl.createDefault(
      () => undefined,
      undefined,
      undefined,
      1,
      () => 1,
      createRuntime(),
    );
    const writer = writable.getWriter();
    const failure = new Error('sink failed');
    writable.error(failure);
    await expect(observe(writer.closed)).rejects.toBe(failure);

    const source = ReadableStreamImpl.createDefault(undefined, undefined, 1, () => 1, createRuntime());
    const proxy = createReadableStreamProxy(source);
    expect(source.locked).toBe(true);
    expect(source.disturbed).toBe(true);
    const reading = observe(proxy.getReader({}).read());
    source.enqueueChunk('proxied');
    source.close();
    await expect(reading).resolves.toEqual({
      done: false,
      value: 'proxied',
    });
  });
});

function requireObject(value: unknown): object {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Expected an object');
  }
  return value;
}
