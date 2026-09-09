import { InternalPromise, type PromiseReactions } from '../js-engine/internal-promise';
import type { StreamAbortController, StreamAbortSignal } from './abort';
import type { QueuingStrategySize } from './queuing-strategy';
import {
  acquireWritableStreamDefaultWriter,
  createWritableStream as createWritableStreamFromAlgorithms,
  type WritableStreamImpl,
} from './writable-stream';
import {
  setUpWritableStreamDefaultWriter, writableStreamAbort, writableStreamClose,
  writableStreamDefaultControllerErrorIfNeeded,
  writableStreamDefaultWriterRelease, writableStreamDefaultWriterWrite,
} from './writable-stream-operations';

/** Streams §9.2, create and set up a writable stream. */
// SPEC_MISMATCH: WritableStream.set up(stream, writeAlgorithm, closeAlgorithm?, abortAlgorithm?, highWaterMark = 1, sizeAlgorithm?) -> void
export function createWritableStream(
  // SPEC_MISMATCH: writeAlgorithm(chunk) -> promise
  writeAlgorithm: (chunk: unknown) => InternalPromise<unknown> | void,
  closeAlgorithm: (() => InternalPromise<unknown> | void) | undefined,
  abortAlgorithm: ((reason: unknown) => InternalPromise<unknown> | void) | undefined,
  highWaterMark = 1,
  sizeAlgorithm: QueuingStrategySize = () => 1,
  abortController: StreamAbortController,
  reactions: PromiseReactions,
): WritableStreamImpl {
  return createWritableStreamFromAlgorithms(
    () => undefined,
    (chunk) => InternalPromise.try(() => writeAlgorithm(chunk)),
    () => InternalPromise.try(() => closeAlgorithm?.()),
    (reason) => InternalPromise.try(() => abortAlgorithm?.(reason)),
    highWaterMark,
    sizeAlgorithm,
    abortController,
    reactions,
  );
}

/** Streams §9.2, error a specification-created writable stream. */
export function errorWritableStream(
  stream: WritableStreamImpl,
  error: unknown,
): void {
  const controller = stream.state.controller;
  if (!controller) throw new Error('WritableStream has no controller');
  writableStreamDefaultControllerErrorIfNeeded(controller, error);
}

/** Streams §9.2, get a specification-created writable stream's signal. */
export function getWritableStreamSignal(
  stream: WritableStreamImpl,
): StreamAbortSignal {
  const controller = stream.state.controller;
  if (!controller) throw new Error('WritableStream has no controller');
  return controller.state.abortController.signal;
}

export {
  writableStreamAbort as abortWritableStream,
  writableStreamClose as closeWritableStream,
  acquireWritableStreamDefaultWriter as getWritableStreamWriter,
  writableStreamDefaultWriterRelease as releaseWritableStreamWriter,
  setUpWritableStreamDefaultWriter as setUpWritableStreamWriter,
  writableStreamDefaultWriterWrite as writeWritableStreamChunk,
};
