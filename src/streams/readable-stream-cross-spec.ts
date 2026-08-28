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
import type {
  ReadableStreamDefaultControllerImpl,
} from './readable-stream-default-controller';
import { ReadableStreamImpl } from './readable-stream';

/** Streams §9.1, close a ReadableStream from another specification. */
export function closeReadableStream(stream: ReadableStreamImpl): void {
  const controller = requireController(stream);
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
  const controller = requireController(stream);
  if (ReadableByteStreamControllerImpl.is(controller)) {
    readableByteStreamControllerError(controller, error);
  } else {
    readableStreamDefaultControllerError(controller, error);
  }
}

/** Streams §9.1, enqueue a chunk from another specification. */
export function enqueueReadableStream(
  stream: ReadableStreamImpl,
  chunk: object,
): void {
  const controller = requireController(stream);
  if (ReadableByteStreamControllerImpl.is(controller)) {
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
  const environment = ReadableStreamImpl.getEnvironment(
    requireReaderStream(reader),
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
            environment.buffers.getViewType(chunk) !== 'Uint8Array'
          ) {
            failureSteps(environment.exceptions.createTypeError(
              'A byte stream produced a non-Uint8Array chunk',
            ));
            return;
          }
          bytes = environment.buffers.copyBytes(chunk);
          if (bytes.length > Number.MAX_SAFE_INTEGER - byteLength) {
            throw new RangeError('Readable stream byte length is too large');
          }
        } catch (error) {
          failureSteps(error);
          return;
        }
        chunks.push(bytes);
        byteLength += bytes.length;
        environment.queueMicrotask(readLoop);
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

function requireController(
  stream: ReadableStreamImpl,
): ReadableByteStreamControllerImpl | ReadableStreamDefaultControllerImpl {
  const controller = ReadableStreamImpl.getState(stream).controller;
  if (!controller) throw new Error('ReadableStream has no controller');
  return controller;
}

function requireReaderStream(
  reader: ReadableStreamDefaultReaderImpl,
): ReadableStreamImpl {
  const generic = ReadableStreamDefaultReaderImpl.getGenericReader(reader);
  const stream = ReadableStreamGenericReaderMixin.getState(generic).stream;
  if (!stream) throw new Error('ReadableStream reader has been released');
  return stream;
}
