import {
  ReadableByteStreamControllerImpl,
} from './readable-byte-stream-controller';
import {
  readableByteStreamControllerClose,
  readableByteStreamControllerEnqueue,
  readableByteStreamControllerError,
  readableByteStreamControllerRespond,
} from './readable-byte-stream-operations';
import { ReadableStreamDefaultReaderImpl } from './readable-stream-default-reader';
import { ReadableStreamGenericReaderMixin } from './readable-stream-generic-reader';
import {
  acquireReadableStreamDefaultReader,
  readableStreamDefaultControllerClose,
  readableStreamDefaultControllerEnqueue,
  readableStreamDefaultControllerError,
  readableStreamDefaultReaderRead,
} from './readable-stream-operations';
import { ReadableStreamImpl } from './readable-stream';
import { isObject } from './ecmascript';
import {
  getBufferSourceCopy, getBufferTypeName,
} from '../web-idl/buffer-source';

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
    if (!isObject(chunk)) {
      throw new Error('A byte stream chunk must be an ArrayBufferView');
    }
    readableByteStreamControllerEnqueue(controller, chunk);
  } else {
    readableStreamDefaultControllerEnqueue(controller, chunk);
  }
}

/** Streams §9.1, get a default reader for another specification. */
export function getReadableStreamReader(
  stream: ReadableStreamImpl,
): ReadableStreamDefaultReaderImpl {
  return acquireReadableStreamDefaultReader(stream);
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
