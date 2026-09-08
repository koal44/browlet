import type { BindingContext } from '../web-idl/projection';
import type { StreamAbortSignal } from './abort';
import { runPromiseAlgorithm } from './promise';
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
  context: BindingContext,
  // SPEC_MISMATCH: writeAlgorithm(chunk) -> promise
  writeAlgorithm: (chunk: unknown) => unknown,
  closeAlgorithm?: () => unknown,
  abortAlgorithm?: (reason: unknown) => unknown,
  highWaterMark = 1,
  sizeAlgorithm: QueuingStrategySize = () => 1,
): WritableStreamImpl {
  return createWritableStreamFromAlgorithms(
    context,
    () => undefined,
    (chunk) => runPromiseAlgorithm(context, () => writeAlgorithm(chunk)),
    () => runPromiseAlgorithm(context, () => closeAlgorithm?.()),
    (reason) => runPromiseAlgorithm(
      context,
      () => abortAlgorithm?.(reason),
    ),
    highWaterMark,
    sizeAlgorithm,
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
