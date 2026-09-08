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
import { ReadableStreamGenericReaderMixin } from './readable-stream-generic-reader';
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
  createArrayBufferView, getBufferSourceByteLength,
  getBufferSourceByteOffset, getBufferSourceCopy,
  getBufferSourceUnderlyingBuffer, getBufferTypeName,
  writeArrayBufferView,
} from '../web-idl/buffer-source';
import type { BindingContext } from '../web-idl/projection';
import type { IDLAsyncSequence } from '../web-idl/async-sequence';
import type { QueuingStrategySize } from './queuing-strategy';
import { runPromiseAlgorithm, type StreamPromise } from './promise';
import type { WritableStreamImpl } from './writable-stream';
import { isWritableStreamLocked } from './writable-stream-operations';
import type { TransformStreamImpl } from './transform-stream';
import {
  createIdentityTransformStream,
} from './transform-stream-cross-spec';

/** Streams §9.1, create and set up a default readable stream. */
// SPEC_MISMATCH: ReadableStream.set up(stream, pullAlgorithm?, cancelAlgorithm?, highWaterMark = 1, sizeAlgorithm?) -> void
export function createReadableStream(
  context: BindingContext,
  pullAlgorithm?: () => unknown,
  cancelAlgorithm?: (reason: unknown) => unknown,
  highWaterMark = 1,
  sizeAlgorithm: QueuingStrategySize = () => 1,
): ReadableStreamImpl {
  return createReadableStreamFromAlgorithms(
    context,
    () => undefined,
    () => runPromiseAlgorithm(context, () => pullAlgorithm?.()),
    (reason) => runPromiseAlgorithm(
      context,
      () => cancelAlgorithm?.(reason),
    ),
    highWaterMark,
    sizeAlgorithm,
  );
}

/** Streams §9.1, create a readable stream from an async sequence. */
// SPEC_MISMATCH: ReadableStream.create from async sequence(sequence) -> ReadableStream
export function createReadableStreamFromAsyncSequence(
  context: BindingContext,
  sequence: IDLAsyncSequence,
): ReadableStreamImpl {
  return readableStreamFromIterable(context, sequence);
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
    const context = ReadableStreamImpl.getContext(stream);
    readableByteStreamControllerEnqueue(
      requireByteController(stream),
      createArrayBufferView('Uint8Array', pulled, context.realm),
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
  const context = ReadableStreamGenericReaderMixin.getContext(
    ReadableStreamDefaultReaderImpl.getGenericReader(reader),
  );
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  readLoop();

  // SPEC_MISMATCH: read-loop(reader, bytes, successSteps, failureSteps) -> void
  function readLoop(): void {
    readableStreamDefaultReaderRead(reader, {
      chunkSteps(chunk) {
        let bytes: Uint8Array;
        try {
          if (
            typeof chunk !== 'object' || chunk === null ||
            getBufferTypeName(chunk) !== 'Uint8Array'
          ) {
            failureSteps(new context.realm.intrinsics.typeError(
              'A byte stream produced a non-Uint8Array chunk',
            ));
            return;
          }
          bytes = getBufferSourceCopy(chunk);
          if (bytes.length > Number.MAX_SAFE_INTEGER - byteLength) {
            throw new context.realm.intrinsics.rangeError(
              'Readable stream byte length is too large',
            );
          }
        } catch (error) {
          failureSteps(error);
          return;
        }
        chunks.push(bytes);
        byteLength += bytes.length;
        context.realm.queueMicrotask(readLoop);
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
    });
  }
}

/** Streams §9.2, cancel through a default reader. */
export function cancelReadableStreamReader(
  reader: ReadableStreamDefaultReaderImpl,
  reason: unknown,
): StreamPromise {
  return readableStreamReaderGenericCancel(
    ReadableStreamDefaultReaderImpl.getGenericReader(reader),
    reason,
  );
}

/** Streams §9.2, tee a stream with cloning enabled for the second branch. */
export function teeReadableStream(
  stream: ReadableStreamImpl,
): [ReadableStreamImpl, ReadableStreamImpl] {
  return ReadableByteStreamControllerImpl.is(
    ReadableStreamImpl.getController(stream),
  )
    ? readableByteStreamTee(stream)
    : readableStreamDefaultTee(stream, true);
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
): StreamPromise {
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
  const context = ReadableStreamImpl.getContext(readable);
  const promise = pipeReadableStreamTo(readable, transform.writable, options);
  context.markPromiseHandled(promise);
  return transform.readable;
}

/** Streams §9.5, create a proxy for a readable stream. */
export function createReadableStreamProxy(
  stream: ReadableStreamImpl,
): ReadableStreamImpl {
  return pipeReadableStreamThrough(
    stream,
    createIdentityTransformStream(ReadableStreamImpl.getContext(stream)),
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
