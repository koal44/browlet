import { createRuntime } from '../../js-engine/runtime-fixture';
import { createTransformStream, observe } from './implementation-fixture';
import { describe, expect, it, vi } from 'vitest';
import {
  closeReadableStream, closeWritableStream, createReadableStream,
  createReadableStreamProxy, createReadableStreamWithByteReadingSupport,
  createWritableStream, enqueueReadableStream,
  errorWritableStream, GenericTransformStreamMixin,
  getReadableStreamBYOBRequestView, getReadableStreamDesiredSize,
  getReadableStreamReader, getWritableStreamSignal, getWritableStreamWriter,
  isReadableStreamClosed, isReadableStreamDisturbed,
  isReadableStreamLocked, isReadableStreamReadable,
  pullReadableStreamFromBytes, readAllBytes, readableStreamNeedsMoreData,
  readReadableStreamChunk, releaseReadableStreamReader,
  releaseWritableStreamWriter, writeWritableStreamChunk,
  type ReadableStreamImpl,
} from '../../../src/streams/index';
import {
  getBufferSourceByteOffset, getBufferSourceCopy,
  getBufferSourceUnderlyingBuffer,
  writeArrayBufferView,
} from '../../../src/web-idl/buffer-source';

describe('Streams operations for other specifications', () => {
  it('drains buffered bytes without recursion or Node microtask scheduling', () => {
    const stream = createReadableStream(undefined, undefined, 1, () => 1, createRuntime());
    for (let i = 0; i < 4_096; i++) enqueueReadableStream(stream, Uint8Array.of(i % 256));
    closeReadableStream(stream);
    const success = vi.fn();
    const failure = vi.fn();
    const schedule = vi.spyOn(globalThis, 'queueMicrotask');
    try {
      readAllBytes(getReadableStreamReader(stream), success, failure);
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
    const stream = createReadableStream(undefined, undefined, 1, () => 1, createRuntime());
    const success = vi.fn();
    const failure = vi.fn();
    readAllBytes(getReadableStreamReader(stream), success, failure);
    expect(success).not.toHaveBeenCalled();
    enqueueReadableStream(stream, Uint8Array.of(1, 2));
    enqueueReadableStream(stream, Uint8Array.of(3));
    closeReadableStream(stream);
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
    const stream: ReadableStreamImpl = createReadableStream(() => {
      if (pulled) return;
      pulled = true;
      enqueueReadableStream(stream, 'chunk');
      closeReadableStream(stream);
    }, undefined, 1, () => 1, createRuntime());

    expect(getReadableStreamDesiredSize(stream)).toBe(1);
    expect(readableStreamNeedsMoreData(stream)).toBe(true);
    expect(isReadableStreamReadable(stream)).toBe(true);

    const reader = getReadableStreamReader(stream);
    expect(isReadableStreamLocked(stream)).toBe(true);
    const chunk = new Promise<unknown>((resolve, reject) => {
      readReadableStreamChunk(reader, {
        chunkSteps: resolve,
        closeSteps: () => reject(new Error('Stream closed without a chunk')),
        errorSteps: reject,
      });
    });

    await expect(chunk).resolves.toBe('chunk');
    expect(isReadableStreamDisturbed(stream)).toBe(true);
    expect(isReadableStreamClosed(stream)).toBe(true);
    releaseReadableStreamReader(reader);
    expect(isReadableStreamLocked(stream)).toBe(false);
  });

  it('responds when a byte chunk uses the current BYOB request buffer', async () => {
    const stream: ReadableStreamImpl = createReadableStreamWithByteReadingSupport(() => {
      const view = getReadableStreamBYOBRequestView(stream);
      if (view === null) throw new Error('No current BYOB request');
      const chunk = new Uint8Array(getBufferSourceUnderlyingBuffer(view) as ArrayBuffer, getBufferSourceByteOffset(view), 2);
      writeArrayBufferView(chunk, [7, 8]);
      enqueueReadableStream(stream, chunk);
      closeReadableStream(stream);
    }, undefined, 0, createRuntime());
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
    const stream: ReadableStreamImpl = createReadableStreamWithByteReadingSupport(() => {
      offset = pullReadableStreamFromBytes(stream, bytes, offset);
      closeReadableStream(stream);
    }, undefined, 0, createRuntime());
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
    const stream = createWritableStream(write, undefined, undefined, 1, () => 1, runtime);
    const writer = getWritableStreamWriter(stream);
    const writing = writeWritableStreamChunk(
      writer,
      'chunk',
    );
    let settled = false;
    void observe(writing).then(() => { settled = true; });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(getWritableStreamSignal(stream).aborted).toBe(false);
    finishWrite.resolve();
    await expect(observe(writing)).resolves.toBeUndefined();
    await expect(observe(closeWritableStream(stream)))
      .resolves.toBeUndefined();
    releaseWritableStreamWriter(writer);
    expect(write).toHaveBeenCalledWith('chunk');
  });

  it('errors a writable stream and proxies a readable stream', async () => {
    const writable = createWritableStream(() => undefined, undefined, undefined, 1, () => 1, createRuntime());
    const writer = getWritableStreamWriter(writable);
    const failure = new Error('sink failed');
    errorWritableStream(writable, failure);
    await expect(observe(writer.closed)).rejects.toBe(failure);

    const source = createReadableStream(undefined, undefined, 1, () => 1, createRuntime());
    const proxy = createReadableStreamProxy(source);
    expect(isReadableStreamLocked(source)).toBe(true);
    expect(isReadableStreamDisturbed(source)).toBe(true);
    const reading = observe(proxy.getReader({}).read());
    enqueueReadableStream(source, 'proxied');
    closeReadableStream(source);
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
