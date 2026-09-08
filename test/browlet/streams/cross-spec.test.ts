import { describe, expect, it, vi } from 'vitest';
import {
  closeReadableStream, closeWritableStream, createReadableStream,
  createReadableStreamProxy, createReadableStreamWithByteReadingSupport,
  createWritableStream, enqueueReadableStream,
  errorWritableStream, GenericTransformStreamMixin,
  getReadableStreamBYOBRequestView, getReadableStreamDesiredSize,
  getReadableStreamReader, getWritableStreamSignal, getWritableStreamWriter,
  isReadableStreamClosed, isReadableStreamDisturbed,
  internalStreamSetup, isReadableStreamLocked, isReadableStreamReadable,
  pullReadableStreamFromBytes, readableStreamNeedsMoreData,
  readReadableStreamChunk, releaseReadableStreamReader,
  releaseWritableStreamWriter, TransformStreamImpl, writeWritableStreamChunk,
  type ReadableStreamImpl,
} from '../../../src/streams/index';
import {
  createArrayBufferView, createArrayBufferViewFromBuffer,
  getBufferSourceByteOffset, getBufferSourceCopy,
  getBufferSourceUnderlyingBuffer,
  writeArrayBufferView,
} from '../../../src/web-idl/buffer-source';
import { createTestContext, unwrapStreamPromise } from './environment';

describe('Streams operations for other specifications', () => {
  it('retains the actual transform associated with a generic transform', () => {
    const context = createTestContext();
    const transform = new TransformStreamImpl(context, internalStreamSetup);
    transform.setUp(() => undefined);
    const generic = new GenericTransformStreamMixin(transform);

    expect(GenericTransformStreamMixin.getAssociatedTransform(generic))
      .toBe(transform);
    expect(generic.readable).toBe(transform.readable);
    expect(generic.writable).toBe(transform.writable);
  });

  it('creates, reads, and introspects an ordinary readable stream', async () => {
    const context = createTestContext();
    let pulled = false;
    const stream: ReadableStreamImpl = createReadableStream(context, () => {
      if (pulled) return;
      pulled = true;
      enqueueReadableStream(stream, 'chunk');
      closeReadableStream(stream);
    });

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
    const context = createTestContext();
    const stream: ReadableStreamImpl = createReadableStreamWithByteReadingSupport(context, () => {
      const view = getReadableStreamBYOBRequestView(stream);
      if (view === null) throw new Error('No current BYOB request');
      const chunk = createArrayBufferViewFromBuffer(
        'Uint8Array',
        getBufferSourceUnderlyingBuffer(view),
        getBufferSourceByteOffset(view),
        2,
        2,
        context.realm,
      );
      writeArrayBufferView(chunk, [7, 8]);
      enqueueReadableStream(stream, chunk);
      closeReadableStream(stream);
    });
    const reader = stream.getReader({ mode: 'byob' });
    const destination = createArrayBufferView(
      'Uint8Array',
      [0, 0, 0, 0],
      context.realm,
    );

    const result = await unwrapStreamPromise<ReadableStreamReadResult>(
      reader.read(destination, { min: 1 }),
    );

    expect(result.done).toBe(false);
    expect(getBufferSourceCopy(requireObject(result.value)))
      .toEqual(Uint8Array.from([7, 8]));
  });

  it('pulls bytes into a BYOB view without copying the remainder', async () => {
    const context = createTestContext();
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    let offset = 1;
    const stream: ReadableStreamImpl = createReadableStreamWithByteReadingSupport(context, () => {
      offset = pullReadableStreamFromBytes(stream, bytes, offset);
      closeReadableStream(stream);
    });
    const reader = stream.getReader({ mode: 'byob' });
    const destination = createArrayBufferView(
      'Uint8Array',
      [0, 0, 0, 0],
      context.realm,
    );

    const result = await unwrapStreamPromise<ReadableStreamReadResult>(
      reader.read(destination, { min: 1 }),
    );

    expect(offset).toBe(4);
    expect(getBufferSourceCopy(requireObject(result.value)))
      .toEqual(Uint8Array.from([2, 3, 4]));
  });

  it('waits for host promises returned by writable algorithms', async () => {
    const context = createTestContext();
    let finishWrite: (() => void) | undefined;
    const write = vi.fn(() => new Promise<void>((resolve) => {
      finishWrite = resolve;
    }));
    const stream = createWritableStream(context, write);
    const writer = getWritableStreamWriter(stream);
    const writing = unwrapStreamPromise(writeWritableStreamChunk(
      writer,
      'chunk',
    ));
    let settled = false;
    void writing.then(() => { settled = true; });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(getWritableStreamSignal(stream).aborted).toBe(false);
    finishWrite?.();
    await expect(writing).resolves.toBeUndefined();
    await expect(unwrapStreamPromise(closeWritableStream(stream)))
      .resolves.toBeUndefined();
    releaseWritableStreamWriter(writer);
    expect(write).toHaveBeenCalledWith('chunk');
  });

  it('errors a writable stream and proxies a readable stream', async () => {
    const context = createTestContext();
    const writable = createWritableStream(context, () => undefined);
    const writer = getWritableStreamWriter(writable);
    const failure = new Error('sink failed');
    errorWritableStream(writable, failure);
    await expect(unwrapStreamPromise(writer.closed)).rejects.toBe(failure);

    const source = createReadableStream(context);
    const proxy = createReadableStreamProxy(source);
    expect(isReadableStreamLocked(source)).toBe(true);
    expect(isReadableStreamDisturbed(source)).toBe(true);
    const reading = unwrapStreamPromise<ReadableStreamReadResult>(
      proxy.getReader({}).read(),
    );
    enqueueReadableStream(source, 'proxied');
    closeReadableStream(source);
    await expect(reading).resolves.toEqual({
      done: false,
      value: 'proxied',
    });
  });
});

type ReadableStreamReadResult = {
  readonly done: boolean;
  readonly value?: unknown;
};

function requireObject(value: unknown): object {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Expected an object');
  }
  return value;
}
