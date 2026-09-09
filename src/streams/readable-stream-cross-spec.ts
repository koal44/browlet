import { InternalPromise, type PromiseReactions } from '../js-engine/internal-promise';
import type { AsyncSequenceValue } from '../web-idl/async-sequence';
import {
  ReadableByteStreamControllerImpl,
} from './readable-byte-stream-controller';
import {
  readableByteStreamControllerClose,
  readableByteStreamControllerEnqueue,
  readableByteStreamControllerError,
  readableByteStreamControllerGetBYOBRequest,
  readableByteStreamControllerGetDesiredSize,
  readableByteStreamControllerRespond,
  readableByteStreamTee,
} from './readable-byte-stream-operations';
import { ReadableStreamDefaultReaderImpl } from './readable-stream-default-reader';
import {
  acquireReadableStreamDefaultReader,
  createReadableStream as createReadableStreamFromAlgorithms,
  isReadableStreamLocked,
  readableStreamCancel,
  readableStreamDefaultControllerClose,
  readableStreamDefaultControllerEnqueue,
  readableStreamDefaultControllerError,
  readableStreamDefaultControllerGetDesiredSize,
  readableStreamDefaultReaderRead,
  readableStreamDefaultReaderRelease,
  readableStreamDefaultTee,
  readableStreamFromIterable,
  readableStreamPipeTo,
  readableStreamReaderGenericCancel,
  setUpReadableStreamDefaultReader,
} from './readable-stream-operations';
import {
  ReadableStreamImpl, type StreamPipeOptions,
} from './readable-stream';
import {
  getBufferSourceByteLength,
  getBufferSourceByteOffset, getBufferSourceCopy,
  getBufferSourceUnderlyingBuffer, getBufferTypeName,
  writeArrayBufferView,
} from '../web-idl/buffer-source';
import { RangeError, TypeError } from '../js-engine/simple-exception';
import type { StreamAbortController } from './abort';
import type { QueuingStrategySize } from './queuing-strategy';
import type { WritableStreamImpl } from './writable-stream';
import { isWritableStreamLocked } from './writable-stream-operations';
import { TransformStreamImpl } from './transform-stream';

/** Streams §9.1, create and set up a default readable stream. */
// SPEC_MISMATCH: ReadableStream.set up(stream, pullAlgorithm?, cancelAlgorithm?, highWaterMark = 1, sizeAlgorithm?) -> void
export function createReadableStream(
  pullAlgorithm: (() => InternalPromise<unknown> | void) | undefined,
  cancelAlgorithm: ((reason: unknown) => InternalPromise<unknown> | void) | undefined,
  highWaterMark = 1,
  sizeAlgorithm: QueuingStrategySize = () => 1,
  reactions: PromiseReactions,
): ReadableStreamImpl {
  return createReadableStreamFromAlgorithms(
    () => undefined,
    () => InternalPromise.try(() => pullAlgorithm?.()),
    (reason) => InternalPromise.try(() => cancelAlgorithm?.(reason)),
    highWaterMark,
    sizeAlgorithm,
    reactions,
  );
}

/** Streams §9.1, create a readable stream from an acquired async iterator. */
// SPEC_MISMATCH: ReadableStream.create from async sequence(sequence) -> ReadableStream
export function createReadableStreamFromAsyncSequence(
  sequence: AsyncSequenceValue<unknown>,
  reactions: PromiseReactions,
): ReadableStreamImpl {
  return readableStreamFromIterable(sequence, reactions);
}

/** Streams §9.1, get the desired size of a specification-created stream. */
export function getReadableStreamDesiredSize(
  stream: ReadableStreamImpl,
): number {
  const state = ReadableStreamImpl.getState(stream);
  if (state.state !== 'readable') return 0;
  const controller = ReadableStreamImpl.getController(stream);
  const desiredSize = ReadableByteStreamControllerImpl.is(controller)
    ? readableByteStreamControllerGetDesiredSize(controller)
    : readableStreamDefaultControllerGetDesiredSize(controller);
  if (desiredSize === null) {
    throw new Error('A readable stream has no desired size');
  }
  return desiredSize;
}

/** Streams §9.1, whether a specification-created stream needs more data. */
export function readableStreamNeedsMoreData(
  stream: ReadableStreamImpl,
): boolean {
  return getReadableStreamDesiredSize(stream) > 0;
}

/** Streams §9.1, close a ReadableStream from another specification. */
export function closeReadableStream(stream: ReadableStreamImpl): void {
  const controller = ReadableStreamImpl.getController(stream);
  if (ReadableByteStreamControllerImpl.is(controller)) {
    readableByteStreamControllerClose(controller);
    if (ReadableByteStreamControllerImpl.getState(
      controller,
    ).pendingPullIntos.length > 0) {
      readableByteStreamControllerRespond(controller, 0);
    }
  } else {
    readableStreamDefaultControllerClose(controller);
  }
}

/** Streams §9.1, error a ReadableStream from another specification. */
export function errorReadableStream(
  stream: ReadableStreamImpl,
  error: unknown,
): void {
  const controller = ReadableStreamImpl.getController(stream);
  if (ReadableByteStreamControllerImpl.is(controller)) {
    readableByteStreamControllerError(controller, error);
  } else {
    readableStreamDefaultControllerError(controller, error);
  }
}

/** Streams §9.1, enqueue a chunk from another specification. */
export function enqueueReadableStream(
  stream: ReadableStreamImpl,
  chunk: unknown,
): void {
  const controller = ReadableStreamImpl.getController(stream);
  if (ReadableByteStreamControllerImpl.is(controller)) {
    if (
      typeof chunk !== 'object' || chunk === null ||
      !isArrayBufferView(chunk)
    ) {
      throw new Error('A byte stream chunk must be an ArrayBufferView');
    }
    const byobView = getReadableStreamBYOBRequestView(stream);
    if (
      byobView !== null &&
      getBufferSourceUnderlyingBuffer(chunk) ===
      getBufferSourceUnderlyingBuffer(byobView)
    ) {
      if (
        getBufferSourceByteOffset(chunk) !==
        getBufferSourceByteOffset(byobView) ||
        getBufferSourceByteLength(chunk) >
        getBufferSourceByteLength(byobView)
      ) {
        throw new Error('A byte stream chunk exceeds its BYOB request view');
      }
      readableByteStreamControllerRespond(
        controller,
        getBufferSourceByteLength(chunk),
      );
      return;
    }
    readableByteStreamControllerEnqueue(controller, chunk);
  } else {
    readableStreamDefaultControllerEnqueue(controller, chunk);
  }
}

/** Streams §9.1, get the current BYOB request view. */
export function getReadableStreamBYOBRequestView(
  stream: ReadableStreamImpl,
): object | null {
  const controller = ReadableStreamImpl.getController(stream);
  if (!ReadableByteStreamControllerImpl.is(controller)) {
    throw new Error('A default readable stream has no BYOB request view');
  }
  return readableByteStreamControllerGetBYOBRequest(controller)?.view ?? null;
}

/**
 * Streams §9.1, pull from a byte sequence.
 *
 * The returned offset represents removing the consumed prefix from `bytes`
 * without copying the remainder.
 */
// SPEC_MISMATCH: pull from bytes(bytes, stream) -> void
export function pullReadableStreamFromBytes(
  stream: ReadableStreamImpl,
  bytes: Uint8Array,
  offset = 0,
): number {
  if (!Number.isInteger(offset) || offset < 0 || offset > bytes.length) {
    throw new Error('Byte sequence offset is out of range');
  }
  const available = bytes.length - offset;
  const byobView = getReadableStreamBYOBRequestView(stream);
  const pullSize = Math.min(
    available,
    byobView === null
      ? available
      : getBufferSourceByteLength(byobView),
  );
  const pulled = bytes.subarray(offset, offset + pullSize);
  if (byobView === null) {
    readableByteStreamControllerEnqueue(
      requireByteController(stream),
      new Uint8Array(pulled),
    );
  } else {
    writeArrayBufferView(byobView, pulled);
    readableByteStreamControllerRespond(
      requireByteController(stream),
      pullSize,
    );
  }
  return offset + pullSize;
}

/** Streams §9.1, read all bytes from a default reader. */
export function readAllBytes(
  reader: ReadableStreamDefaultReaderImpl,
  successSteps: (bytes: Uint8Array) => void,
  failureSteps: (reason: unknown) => void,
): void {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  let reading = false;
  let readAgain = false;
  const request = {
    chunkSteps(chunk: unknown) {
      let bytes: Uint8Array;
      try {
        if (
          typeof chunk !== 'object' || chunk === null ||
          getBufferTypeName(chunk) !== 'Uint8Array'
        ) {
          failureSteps(new TypeError(
            'A byte stream produced a non-Uint8Array chunk',
          ));
          return;
        }
        bytes = getBufferSourceCopy(chunk);
        if (bytes.length > Number.MAX_SAFE_INTEGER - byteLength) {
          throw new RangeError(
            'Readable stream byte length is too large',
          );
        }
      } catch (error) {
        failureSteps(error);
        return;
      }
      chunks.push(bytes);
      byteLength += bytes.length;
      readLoop();
    },
    closeSteps() {
      const bytes = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      successSteps(bytes);
    },
    errorSteps: failureSteps,
  };

  readLoop();

  // SPEC_MISMATCH: read-loop(reader, bytes, successSteps, failureSteps) -> void
  function readLoop(): void {
    readAgain = true;
    if (reading) return;
    reading = true;
    try {
      // The Streams note permits an iterative drain to avoid stack growth.
      // A synchronous chunk requests another pass; a later chunk restarts it.
      while (readAgain) {
        readAgain = false;
        readableStreamDefaultReaderRead(reader, request);
      }
    } finally {
      reading = false;
    }
  }
}

/** Streams §9.2, cancel through a default reader. */
export function cancelReadableStreamReader(
  reader: ReadableStreamDefaultReaderImpl,
  reason: unknown,
): InternalPromise<unknown> {
  return readableStreamReaderGenericCancel(
    ReadableStreamDefaultReaderImpl.getGenericReader(reader),
    reason,
  );
}

/** Streams §9.2, tee a stream with cloning enabled for the second branch. */
// SPEC_MISMATCH: ReadableStream.tee(stream) -> [ReadableStream, ReadableStream]
export function teeReadableStream(
  stream: ReadableStreamImpl,
  clone?: (value: unknown) => unknown,
): [ReadableStreamImpl, ReadableStreamImpl] {
  return ReadableByteStreamControllerImpl.is(
    ReadableStreamImpl.getController(stream),
  )
    ? readableByteStreamTee(stream)
    : readableStreamDefaultTee(stream, true, clone);
}

export function isReadableStreamReadable(stream: ReadableStreamImpl): boolean {
  return ReadableStreamImpl.getState(stream).state === 'readable';
}

export function isReadableStreamClosed(stream: ReadableStreamImpl): boolean {
  return ReadableStreamImpl.getState(stream).state === 'closed';
}

export function isReadableStreamErrored(stream: ReadableStreamImpl): boolean {
  return ReadableStreamImpl.getState(stream).state === 'errored';
}

export function isReadableStreamDisturbed(stream: ReadableStreamImpl): boolean {
  return ReadableStreamImpl.getState(stream).disturbed;
}

/** Streams §9.5, pipe one stream to another. */
// SPEC_MISMATCH: (readable, writable, preventClose = false, preventAbort = false, preventCancel = false, signal?) -> Promise<undefined>
export function pipeReadableStreamTo(
  readable: ReadableStreamImpl,
  writable: WritableStreamImpl,
  options: Partial<StreamPipeOptions> = {},
): InternalPromise<unknown> {
  if (isReadableStreamLocked(readable) || isWritableStreamLocked(writable)) {
    throw new Error('Streams must be unlocked before piping');
  }
  return readableStreamPipeTo(
    readable,
    writable,
    options.preventClose ?? false,
    options.preventAbort ?? false,
    options.preventCancel ?? false,
    options.signal,
  );
}

/** Streams §9.5, pipe a stream through a transform stream. */
// SPEC_MISMATCH: (readable, transform, preventClose = false, preventAbort = false, preventCancel = false, signal?) -> ReadableStream
export function pipeReadableStreamThrough(
  readable: ReadableStreamImpl,
  transform: TransformStreamImpl,
  options: Partial<StreamPipeOptions> = {},
): ReadableStreamImpl {
  const promise = pipeReadableStreamTo(readable, transform.writable, options);
  void promise.chain(undefined, () => {}, readable.reactions);
  return transform.readable;
}

/** Streams §9.5, create a proxy for a readable stream. */
// SPEC_MISMATCH: ReadableStream.create a proxy(stream) -> ReadableStream
export function createReadableStreamProxy(
  stream: ReadableStreamImpl,
  abortController: StreamAbortController,
): ReadableStreamImpl {
  return pipeReadableStreamThrough(
    stream,
    TransformStreamImpl.createIdentity(abortController, stream.reactions),
  );
}

export {
  createReadableStreamWithByteReadingSupport,
} from './readable-byte-stream-operations';
export {
  readableStreamCancel as cancelReadableStream,
  acquireReadableStreamDefaultReader as getReadableStreamReader,
  isReadableStreamLocked,
  readableStreamDefaultReaderRead as readReadableStreamChunk,
  readableStreamDefaultReaderRelease as releaseReadableStreamReader,
  setUpReadableStreamDefaultReader as setUpReadableStreamReader,
};

function requireByteController(
  stream: ReadableStreamImpl,
): ReadableByteStreamControllerImpl {
  const controller = ReadableStreamImpl.getController(stream);
  if (!ReadableByteStreamControllerImpl.is(controller)) {
    throw new Error('ReadableStream has no byte controller');
  }
  return controller;
}

function isArrayBufferView(value: object): boolean {
  const name = getBufferTypeName(value);
  return name !== undefined &&
    name !== 'ArrayBuffer' &&
    name !== 'SharedArrayBuffer';
}
