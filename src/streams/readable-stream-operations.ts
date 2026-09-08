// @rollup-cycle streams-readable
import { idlType } from '../web-idl/declaration/index';
import {
  closeAsyncIterator, endOfIteration, getAsyncIteratorNextValue,
  openAsyncSequence, type IDLAsyncSequence,
} from '../web-idl/async-sequence';
import type { BindingContext } from '../web-idl/projection';
import type {
  StreamAbortAlgorithmHandle, StreamAbortSignal,
} from './abort';
import type { StreamPromise } from './promise';
import { cloneStreamValue } from './structured-data';
import {
  cancelSteps, internalStreamSetup, pullSteps, releaseSteps,
} from './internal-methods';
import { dequeueValue, enqueueValueWithSize, resetQueue } from './queue-with-sizes';
import {
  extractHighWaterMark, extractSizeAlgorithm, type QueuingStrategy,
  type QueuingStrategySize,
} from './queuing-strategy';
import {
  ReadableStreamDefaultControllerImpl,
  type ReadableStreamDefaultControllerState,
} from './readable-stream-default-controller';
import {
  ReadableStreamDefaultReaderImpl, type ReadRequest,
} from './readable-stream-default-reader';
import { ReadableStreamBYOBReaderImpl } from './readable-stream-byob-reader';
import {
  ReadableStreamGenericReaderMixin,
} from './readable-stream-generic-reader';
import {
  ReadableStreamImpl, type ReadableStreamState,
  type ReadableStreamIteratorOptions, type UnderlyingSource,
} from './readable-stream';
import {
  acquireWritableStreamDefaultWriter, type WritableStreamImpl,
} from './writable-stream';
import {
  isWritableStreamWritable, writableStreamAbort,
  writableStreamCloseQueuedOrInFlight,
  writableStreamDefaultWriterCloseWithErrorPropagation,
  writableStreamDefaultWriterRelease, writableStreamDefaultWriterWrite,
} from './writable-stream-operations';

// SPEC_MISMATCH: InitializeReadableStream(stream) -> void
export function initializeReadableStream(): ReadableStreamState {
  return {
    detached: false,
    disturbed: false,
    state: 'readable',
  };
}

// SPEC_MISMATCH: CreateReadableStream(startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark = 1, sizeAlgorithm = () => 1) -> ReadableStream
export function createReadableStream(
  context: BindingContext,
  startAlgorithm: () => unknown,
  pullAlgorithm: () => StreamPromise,
  cancelAlgorithm: (reason: unknown) => StreamPromise,
  highWaterMark = 1,
  sizeAlgorithm: QueuingStrategySize = () => 1,
): ReadableStreamImpl {
  const stream = context.construct(
    ReadableStreamImpl,
    internalStreamSetup,
  );
  const controller = context.construct(
    ReadableStreamDefaultControllerImpl,
  );
  setUpReadableStreamDefaultController(
    stream,
    controller,
    startAlgorithm,
    pullAlgorithm,
    cancelAlgorithm,
    highWaterMark,
    sizeAlgorithm,
  );
  return stream;
}

export function isReadableStreamLocked(stream: ReadableStreamImpl): boolean {
  return ReadableStreamImpl.getState(stream).reader !== undefined;
}

export function acquireReadableStreamDefaultReader(
  stream: ReadableStreamImpl,
): ReadableStreamDefaultReaderImpl {
  const context = ReadableStreamImpl.getContext(stream);
  const reader = context.construct(ReadableStreamDefaultReaderImpl);
  setUpReadableStreamDefaultReader(reader, stream);
  return reader;
}

export function readableStreamCancel(
  stream: ReadableStreamImpl,
  reason: unknown,
): StreamPromise {
  const state = ReadableStreamImpl.getState(stream);
  const context = ReadableStreamImpl.getContext(stream);
  state.disturbed = true;

  if (state.state === 'closed') {
    return context.createResolvedPromise(
      undefined,
      idlType.undefined,
    );
  }
  if (state.state === 'errored') {
    return context.createRejectedPromise(
      state.storedError,
      idlType.undefined,
    );
  }

  readableStreamClose(stream);
  const reader = state.reader;
  if (ReadableStreamBYOBReaderImpl.is(reader)) {
    const requests = ReadableStreamBYOBReaderImpl.getReadIntoRequests(reader);
    ReadableStreamBYOBReaderImpl.resetReadIntoRequests(reader);
    for (const request of requests) request.closeSteps(undefined);
  }
  const sourceCancelPromise = ReadableStreamImpl.getController(stream)[
    cancelSteps
  ](reason);
  return context.reactToPromise(
    sourceCancelPromise,
    idlType.undefined,
    { fulfilled: () => undefined },
  );
}

// SPEC_MISMATCH: ReadableStreamFromIterable(asyncIterable) -> ReadableStream
export function readableStreamFromIterable(
  context: BindingContext,
  asyncIterable: IDLAsyncSequence,
): ReadableStreamImpl {
  const iterator = openAsyncSequence(asyncIterable, context.realm);
  const pullAlgorithm = () => context.reactToPromise(
    getAsyncIteratorNextValue(
      iterator,
      context.realm,
      (value, type) => context.convert(value, type),
    ),
    idlType.undefined,
    {
      fulfilled(value) {
        const controller = requireDefaultController(stream);
        if (value === endOfIteration) {
          readableStreamDefaultControllerClose(controller);
        } else {
          readableStreamDefaultControllerEnqueue(controller, value);
        }
      },
      rejected(reason) {
        readableStreamDefaultControllerError(
          requireDefaultController(stream),
          reason,
        );
      },
    },
  );
  const cancelAlgorithm = (reason: unknown) => context.reactToPromise(
    closeAsyncIterator(iterator, reason, context.realm),
    idlType.undefined,
    { fulfilled: () => undefined },
  );
  const stream = createReadableStream(
    context,
    () => undefined,
    pullAlgorithm,
    cancelAlgorithm,
    0,
  );
  return stream;
}

// SPEC_MISMATCH: ReadableStream asynchronous iterator initialization steps(stream, iterator, args) -> void
export function initializeReadableStreamAsyncIterator(
  stream: ReadableStreamImpl,
  iterator: object,
  options: ReadableStreamIteratorOptions,
): void {
  readableStreamAsyncIterators.set(iterator, {
    preventCancel: options.preventCancel,
    reader: acquireReadableStreamDefaultReader(stream),
  });
}

export function readableStreamAsyncIteratorGetNext(
  stream: ReadableStreamImpl,
  iterator: object,
): StreamPromise {
  const state = requireAsyncIteratorState(stream, iterator);
  const generic = ReadableStreamDefaultReaderImpl.getGenericReader(
    state.reader,
  );
  const context = ReadableStreamGenericReaderMixin.getContext(generic);
  if (!ReadableStreamGenericReaderMixin.getState(generic).stream) {
    throw new Error('Readable stream async iterator reader was released');
  }

  const promise = context.createPromise(idlType.any);
  readableStreamDefaultReaderRead(state.reader, {
    chunkSteps: (chunk) => context.resolvePromise(promise, chunk),
    closeSteps() {
      readableStreamDefaultReaderRelease(state.reader);
      context.resolvePromise(promise, endOfIteration);
    },
    errorSteps(reason) {
      readableStreamDefaultReaderRelease(state.reader);
      context.rejectPromise(promise, reason);
    },
  });
  return promise;
}

export function readableStreamAsyncIteratorReturn(
  stream: ReadableStreamImpl,
  iterator: object,
  value: unknown,
): StreamPromise {
  const state = requireAsyncIteratorState(stream, iterator);
  const generic = ReadableStreamDefaultReaderImpl.getGenericReader(
    state.reader,
  );
  const context = ReadableStreamGenericReaderMixin.getContext(generic);
  if (!ReadableStreamGenericReaderMixin.getState(generic).stream) {
    throw new Error('Readable stream async iterator reader was released');
  }

  if (!state.preventCancel) {
    const result = readableStreamReaderGenericCancel(generic, value);
    readableStreamDefaultReaderRelease(state.reader);
    return result;
  }

  readableStreamDefaultReaderRelease(state.reader);
  return context.createResolvedPromise(undefined, idlType.undefined);
}

export function readableStreamPipeTo(
  source: ReadableStreamImpl,
  destination: WritableStreamImpl,
  preventClose: boolean,
  preventAbort: boolean,
  preventCancel: boolean,
  signal?: StreamAbortSignal,
): StreamPromise {
  const context = ReadableStreamImpl.getContext(source);
  const reader = acquireReadableStreamDefaultReader(source);
  const writer = acquireWritableStreamDefaultWriter(destination);
  const sourceState = ReadableStreamImpl.getState(source);
  const destinationState = destination.state;
  const readerState = ReadableStreamGenericReaderMixin.getState(
    ReadableStreamDefaultReaderImpl.getGenericReader(reader),
  );
  const writerState = writer.state;
  sourceState.disturbed = true;

  let shuttingDown = false;
  let currentWrite = context.createResolvedPromise(
    undefined,
    idlType.undefined,
  );
  const result = context.createPromise(idlType.undefined);
  let abortAlgorithmHandle: StreamAbortAlgorithmHandle | null | undefined;

  if (signal) {
    const abortAlgorithm = () => {
      const error = signal.reason;
      const actions: Array<() => StreamPromise> = [];
      if (!preventAbort) {
        actions.push(() => isWritableStreamWritable(destination)
          ? writableStreamAbort(destination, error)
          : context.createResolvedPromise(
            undefined,
            idlType.undefined,
          ));
      }
      if (!preventCancel) {
        actions.push(() => sourceState.state === 'readable'
          ? readableStreamCancel(source, error)
          : context.createResolvedPromise(
            undefined,
            idlType.undefined,
          ));
      }
      shutdownWithAction(
        () => context.waitForAllPromises(
          actions.map((action) => action()),
          idlType.undefined,
        ),
        true,
        error,
      );
    };

    if (signal.aborted) {
      abortAlgorithm();
      return result;
    }
    abortAlgorithmHandle = signal.addAlgorithm(abortAlgorithm);
  }

  isOrBecomesErrored(
    sourceState,
    readerState.closedPromise,
    (storedError) => {
      if (!preventAbort) {
        shutdownWithAction(
          () => writableStreamAbort(destination, storedError),
          true,
          storedError,
        );
      } else {
        shutdown(true, storedError);
      }
    },
  );
  isOrBecomesErrored(
    destinationState,
    writerState.closedPromise,
    (storedError) => {
      if (!preventCancel) {
        shutdownWithAction(
          () => readableStreamCancel(source, storedError),
          true,
          storedError,
        );
      } else {
        shutdown(true, storedError);
      }
    },
  );
  isOrBecomesClosed(sourceState, readerState.closedPromise, () => {
    if (!preventClose) {
      shutdownWithAction(
        () => writableStreamDefaultWriterCloseWithErrorPropagation(writer),
      );
    } else {
      shutdown();
    }
  });

  if (writableStreamCloseQueuedOrInFlight(destination) ||
    destinationState.state === 'closed') {
    const error = new context.realm.intrinsics.typeError(
      'The destination WritableStream closed before all data could be piped to it',
    );
    if (!preventCancel) {
      shutdownWithAction(
        () => readableStreamCancel(source, error),
        true,
        error,
      );
    } else {
      shutdown(true, error);
    }
  }

  context.markPromiseHandled(pipeLoop());
  return result;

  function pipeLoop(): StreamPromise {
    const loop = context.createPromise(idlType.undefined);
    const next = (done: unknown): void => {
      if (done) {
        context.resolvePromise(loop, undefined);
        return;
      }
      context.reactToPromise(pipeStep(), idlType.undefined, {
        fulfilled: next,
        rejected: (reason) => context.rejectPromise(loop, reason),
      });
    };
    next(false);
    return loop;
  }

  function pipeStep(): StreamPromise {
    if (shuttingDown) {
      return context.createResolvedPromise(true, idlType.boolean);
    }

    return context.reactToPromise(
      writerState.readyPromise,
      idlType.boolean,
      {
        fulfilled() {
          const read = context.createPromise(idlType.boolean);
          readableStreamDefaultReaderRead(reader, {
            chunkSteps(chunk) {
              const write = context.reactToPromise(
                context.createResolvedPromise(undefined, idlType.undefined),
                idlType.undefined,
                {
                  fulfilled: () => writableStreamDefaultWriterWrite(
                    writer,
                    chunk,
                  ),
                },
              );
              currentWrite = context.reactToPromise(
                write,
                idlType.undefined,
                { rejected: () => undefined },
              );
              context.resolvePromise(read, false);
            },
            closeSteps: () => context.resolvePromise(read, true),
            errorSteps: (reason) => context.rejectPromise(read, reason),
          });
          return read;
        },
      },
    );
  }

  function waitForWritesToFinish(): StreamPromise {
    const oldCurrentWrite = currentWrite;
    return context.reactToPromise(
      currentWrite,
      idlType.undefined,
      {
        fulfilled: () => oldCurrentWrite !== currentWrite
          ? waitForWritesToFinish()
          : undefined,
      },
    );
  }

  function isOrBecomesErrored(
    state: { readonly state: string; readonly storedError?: unknown; },
    promise: StreamPromise,
    action: (reason: unknown) => void,
  ): void {
    if (state.state === 'errored') {
      action(state.storedError);
    } else {
      context.reactToPromise(
        promise,
        idlType.undefined,
        { rejected: action },
      );
    }
  }

  function isOrBecomesClosed(
    state: { readonly state: string; },
    promise: StreamPromise,
    action: () => void,
  ): void {
    if (state.state === 'closed') {
      action();
    } else {
      context.reactToPromise(
        promise,
        idlType.undefined,
        {
          fulfilled: action,
          rejected: () => undefined,
        },
      );
    }
  }

  // SPEC_MISMATCH: Shutdown with an action(action, originalError?) -> void
  function shutdownWithAction(
    action: () => StreamPromise,
    originalIsError = false,
    originalError?: unknown,
  ): void {
    if (shuttingDown) return;
    shuttingDown = true;

    const doTheRest = (): void => {
      context.reactToPromise(action(), idlType.undefined, {
        fulfilled: () => finalize(originalIsError, originalError),
        rejected: (newError) => finalize(true, newError),
      });
    };
    if (isWritableStreamWritable(destination) &&
      !writableStreamCloseQueuedOrInFlight(destination)) {
      context.reactToPromise(
        waitForWritesToFinish(),
        idlType.undefined,
        { fulfilled: doTheRest },
      );
    } else {
      doTheRest();
    }
  }

  // SPEC_MISMATCH: Shutdown(error?) -> void
  function shutdown(isError = false, error?: unknown): void {
    if (shuttingDown) return;
    shuttingDown = true;

    if (isWritableStreamWritable(destination) &&
      !writableStreamCloseQueuedOrInFlight(destination)) {
      context.reactToPromise(
        waitForWritesToFinish(),
        idlType.undefined,
        { fulfilled: () => finalize(isError, error) },
      );
    } else {
      finalize(isError, error);
    }
  }

  // SPEC_MISMATCH: Finalize(error?) -> void
  function finalize(isError: boolean, error?: unknown): void {
    writableStreamDefaultWriterRelease(writer);
    readableStreamDefaultReaderRelease(reader);
    abortAlgorithmHandle?.remove();
    if (isError) context.rejectPromise(result, error);
    else context.resolvePromise(result, undefined);
  }
}

export function readableStreamDefaultTee(
  stream: ReadableStreamImpl,
  cloneForBranch2: boolean,
): [ReadableStreamImpl, ReadableStreamImpl] {
  const context = ReadableStreamImpl.getContext(stream);
  const reader = acquireReadableStreamDefaultReader(stream);
  const generic = ReadableStreamDefaultReaderImpl.getGenericReader(reader);
  let reading = false;
  let readAgain = false;
  let canceled1 = false;
  let canceled2 = false;
  let reason1: unknown = undefined;
  let reason2: unknown = undefined;
  const cancelPromise = context.createPromise(idlType.undefined);

  const pullAlgorithm = (): StreamPromise => {
    if (reading) {
      readAgain = true;
      return context.createResolvedPromise(
        undefined,
        idlType.undefined,
      );
    }
    reading = true;
    readableStreamDefaultReaderRead(reader, {
      chunkSteps(chunk) {
        context.realm.queueMicrotask(() => {
          readAgain = false;
          let chunk2 = chunk;
          if (cloneForBranch2 && !canceled2) {
            try {
              chunk2 = cloneStreamValue(context, chunk);
            } catch (error) {
              readableStreamDefaultControllerError(
                requireDefaultController(branch1),
                error,
              );
              readableStreamDefaultControllerError(
                requireDefaultController(branch2),
                error,
              );
              context.resolvePromise(
                cancelPromise,
                readableStreamCancel(stream, error),
              );
              return;
            }
          }
          if (!canceled1) {
            readableStreamDefaultControllerEnqueue(
              requireDefaultController(branch1),
              chunk,
            );
          }
          if (!canceled2) {
            readableStreamDefaultControllerEnqueue(
              requireDefaultController(branch2),
              chunk2,
            );
          }
          reading = false;
          // Enqueuing can synchronously reenter a branch pull algorithm.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (readAgain) void pullAlgorithm();
        });
      },
      closeSteps() {
        reading = false;
        if (!canceled1) {
          readableStreamDefaultControllerClose(
            requireDefaultController(branch1),
          );
        }
        if (!canceled2) {
          readableStreamDefaultControllerClose(
            requireDefaultController(branch2),
          );
        }
        if (!canceled1 || !canceled2) {
          context.resolvePromise(cancelPromise, undefined);
        }
      },
      errorSteps() {
        reading = false;
      },
    });
    return context.createResolvedPromise(
      undefined,
      idlType.undefined,
    );
  };

  const cancel1Algorithm = (reason: unknown): StreamPromise => {
    canceled1 = true;
    reason1 = reason;
    if (canceled2) settleCancelPromise([reason1, reason2]);
    return cancelPromise;
  };
  const cancel2Algorithm = (reason: unknown): StreamPromise => {
    canceled2 = true;
    reason2 = reason;
    if (canceled1) settleCancelPromise([reason1, reason2]);
    return cancelPromise;
  };
  const branch1 = createReadableStream(
    context,
    () => undefined,
    pullAlgorithm,
    cancel1Algorithm,
  );
  const branch2 = createReadableStream(
    context,
    () => undefined,
    pullAlgorithm,
    cancel2Algorithm,
  );

  context.reactToPromise(
    ReadableStreamGenericReaderMixin.getState(generic).closedPromise,
    idlType.undefined,
    {
      fulfilled: () => undefined,
      rejected(reason) {
        readableStreamDefaultControllerError(
          requireDefaultController(branch1),
          reason,
        );
        readableStreamDefaultControllerError(
          requireDefaultController(branch2),
          reason,
        );
        if (!canceled1 || !canceled2) {
          context.resolvePromise(cancelPromise, undefined);
        }
      },
    },
  );
  return [branch1, branch2];

  function settleCancelPromise(reason: readonly unknown[]): void {
    context.reactToPromise(
      readableStreamCancel(stream, [...reason]),
      idlType.undefined,
      {
        fulfilled: () => context.resolvePromise(
          cancelPromise,
          undefined,
        ),
        rejected: (error) => context.rejectPromise(
          cancelPromise,
          error,
        ),
      },
    );
  }
}

export function readableStreamClose(stream: ReadableStreamImpl): void {
  const state = ReadableStreamImpl.getState(stream);
  if (state.state !== 'readable') {
    throw new Error('Only a readable stream can be closed');
  }
  state.state = 'closed';

  const reader = state.reader;
  if (!reader) return;

  const generic = getGenericReader(reader);
  const context = ReadableStreamGenericReaderMixin.getContext(generic);
  context.resolvePromise(
    ReadableStreamGenericReaderMixin.getState(generic).closedPromise,
    undefined,
  );

  if (ReadableStreamDefaultReaderImpl.is(reader)) {
    const requests = ReadableStreamDefaultReaderImpl.getReadRequests(reader);
    ReadableStreamDefaultReaderImpl.resetReadRequests(reader);
    for (const request of requests) request.closeSteps();
  }
}

export function readableStreamError(
  stream: ReadableStreamImpl,
  error: unknown,
): void {
  const state = ReadableStreamImpl.getState(stream);
  if (state.state !== 'readable') {
    throw new Error('Only a readable stream can be errored');
  }
  state.state = 'errored';
  state.storedError = error;

  const reader = state.reader;
  if (!reader) return;

  const generic = getGenericReader(reader);
  const context = ReadableStreamGenericReaderMixin.getContext(generic);
  const closedPromise = ReadableStreamGenericReaderMixin.getState(
    generic,
  ).closedPromise;
  context.rejectPromise(closedPromise, error);
  context.markPromiseHandled(closedPromise);
  if (ReadableStreamDefaultReaderImpl.is(reader)) {
    readableStreamDefaultReaderErrorReadRequests(reader, error);
  } else {
    const requests = ReadableStreamBYOBReaderImpl.getReadIntoRequests(reader);
    ReadableStreamBYOBReaderImpl.resetReadIntoRequests(reader);
    for (const request of requests) request.errorSteps(error);
  }
}

// SPEC_MISMATCH: ReadableStreamReaderGenericCancel(reader: ReadableStreamDefaultReader | ReadableStreamBYOBReader, reason) -> Promise<undefined>
export function readableStreamReaderGenericCancel(
  reader: ReadableStreamGenericReaderMixin,
  reason: unknown,
): StreamPromise {
  const stream = ReadableStreamGenericReaderMixin.getState(reader).stream;
  if (!stream) throw new Error('Cannot cancel through a released reader');
  return readableStreamCancel(stream, reason);
}

export function setUpReadableStreamDefaultReader(
  reader: ReadableStreamDefaultReaderImpl,
  stream: ReadableStreamImpl,
): void {
  const context = ReadableStreamImpl.getContext(stream);
  if (isReadableStreamLocked(stream)) {
    throw new context.realm.intrinsics.typeError(
      'This stream has already been locked for exclusive reading by another reader',
    );
  }

  const generic = ReadableStreamDefaultReaderImpl.getGenericReader(reader);
  readableStreamReaderGenericInitialize(generic, reader, stream);
  ReadableStreamDefaultReaderImpl.resetReadRequests(reader);
}

// SPEC_MISMATCH: ReadableStreamReaderGenericInitialize(reader, stream) -> void
export function readableStreamReaderGenericInitialize(
  generic: ReadableStreamGenericReaderMixin,
  reader: NonNullable<ReadableStreamState['reader']>,
  stream: ReadableStreamImpl,
): void {
  const context = ReadableStreamGenericReaderMixin.getContext(generic);
  const streamState = ReadableStreamImpl.getState(stream);
  let closedPromise: StreamPromise;
  if (streamState.state === 'readable') {
    closedPromise = context.createPromise(idlType.undefined);
  } else if (streamState.state === 'closed') {
    closedPromise = context.createResolvedPromise(
      undefined,
      idlType.undefined,
    );
  } else {
    closedPromise = context.createRejectedPromise(
      streamState.storedError,
      idlType.undefined,
    );
    context.markPromiseHandled(closedPromise);
  }

  ReadableStreamGenericReaderMixin.setState(
    generic,
    { closedPromise, stream },
  );
  streamState.reader = reader;
}

export function readableStreamDefaultReaderRead(
  reader: ReadableStreamDefaultReaderImpl,
  request: ReadRequest,
): void {
  const generic = ReadableStreamDefaultReaderImpl.getGenericReader(reader);
  const stream = ReadableStreamGenericReaderMixin.getState(generic).stream;
  if (!stream) throw new Error('Cannot read through a released reader');

  const streamState = ReadableStreamImpl.getState(stream);
  streamState.disturbed = true;
  if (streamState.state === 'closed') {
    request.closeSteps();
  } else if (streamState.state === 'errored') {
    request.errorSteps(streamState.storedError);
  } else {
    ReadableStreamImpl.getController(stream)[pullSteps](request);
  }
}

export function readableStreamDefaultReaderRelease(
  reader: ReadableStreamDefaultReaderImpl,
): void {
  const generic = ReadableStreamDefaultReaderImpl.getGenericReader(reader);
  const context = ReadableStreamGenericReaderMixin.getContext(generic);
  readableStreamReaderGenericRelease(generic, reader);

  readableStreamDefaultReaderErrorReadRequests(
    reader,
    new context.realm.intrinsics.typeError('Reader was released'),
  );
}

// SPEC_MISMATCH: ReadableStreamReaderGenericRelease(reader) -> void
export function readableStreamReaderGenericRelease(
  generic: ReadableStreamGenericReaderMixin,
  reader: NonNullable<ReadableStreamState['reader']>,
): void {
  const genericState = ReadableStreamGenericReaderMixin.getState(generic);
  const stream = genericState.stream;
  if (!stream) throw new Error('Cannot release an already released reader');

  const streamState = ReadableStreamImpl.getState(stream);
  if (streamState.reader !== reader) {
    throw new Error('Readable stream is locked by a different reader');
  }
  const context = ReadableStreamGenericReaderMixin.getContext(generic);
  const error = new context.realm.intrinsics.typeError(
    'Reader was released and can no longer monitor the stream\'s closedness',
  );
  if (streamState.state === 'readable') {
    context.rejectPromise(genericState.closedPromise, error);
  } else {
    genericState.closedPromise = context.createRejectedPromise(
      error,
      idlType.undefined,
    );
  }
  context.markPromiseHandled(genericState.closedPromise);

  ReadableStreamImpl.getController(stream)[releaseSteps]();
  streamState.reader = undefined;
  genericState.stream = undefined;
}

export function readableStreamDefaultControllerCallPullIfNeeded(
  controller: ReadableStreamDefaultControllerImpl,
): void {
  if (!readableStreamDefaultControllerShouldCallPull(controller)) return;

  const state = ReadableStreamDefaultControllerImpl.getState(controller);
  if (state.pulling) {
    state.pullAgain = true;
    return;
  }

  state.pulling = true;
  const context = ReadableStreamDefaultControllerImpl.getContext(
    controller,
  );
  const pullPromise = requireAlgorithm(state.pullAlgorithm, 'pull')();
  context.reactToPromise(pullPromise, idlType.undefined, {
    fulfilled() {
      state.pulling = false;
      if (state.pullAgain) {
        state.pullAgain = false;
        readableStreamDefaultControllerCallPullIfNeeded(controller);
      }
    },
    rejected(error) {
      readableStreamDefaultControllerError(controller, error);
    },
  });
}

export function readableStreamDefaultControllerClearAlgorithms(
  controller: ReadableStreamDefaultControllerImpl,
): void {
  const state = ReadableStreamDefaultControllerImpl.getState(controller);
  state.pullAlgorithm = undefined;
  state.cancelAlgorithm = undefined;
  state.strategySizeAlgorithm = undefined;
}

export function readableStreamDefaultControllerClose(
  controller: ReadableStreamDefaultControllerImpl,
): void {
  if (!readableStreamDefaultControllerCanCloseOrEnqueue(controller)) return;
  const state = ReadableStreamDefaultControllerImpl.getState(controller);
  state.closeRequested = true;
  if (state.queue.length === 0) {
    readableStreamDefaultControllerClearAlgorithms(controller);
    readableStreamClose(state.stream);
  }
}

export function readableStreamDefaultControllerEnqueue(
  controller: ReadableStreamDefaultControllerImpl,
  chunk: unknown,
): void {
  if (!readableStreamDefaultControllerCanCloseOrEnqueue(controller)) return;
  const state = ReadableStreamDefaultControllerImpl.getState(controller);
  const streamState = ReadableStreamImpl.getState(state.stream);

  const reader = streamState.reader;
  if (ReadableStreamDefaultReaderImpl.is(reader) &&
    ReadableStreamDefaultReaderImpl.getReadRequests(reader).length) {
    const request = ReadableStreamDefaultReaderImpl.getReadRequests(
      reader,
    ).shift();
    if (!request) throw new Error('Readable stream read request disappeared');
    request.chunkSteps(chunk);
  } else {
    let chunkSize: number;
    try {
      chunkSize = requireAlgorithm(
        state.strategySizeAlgorithm,
        'size',
      )(chunk);
    } catch (error) {
      readableStreamDefaultControllerError(controller, error);
      throw error;
    }

    try {
      enqueueValueWithSize(
        state,
        chunk,
        chunkSize,
        ReadableStreamDefaultControllerImpl.getContext(controller)
          .realm.intrinsics.rangeError,
      );
    } catch (error) {
      readableStreamDefaultControllerError(controller, error);
      throw error;
    }
  }

  readableStreamDefaultControllerCallPullIfNeeded(controller);
}

export function readableStreamDefaultControllerError(
  controller: ReadableStreamDefaultControllerImpl,
  error: unknown,
): void {
  const state = ReadableStreamDefaultControllerImpl.getState(controller);
  if (ReadableStreamImpl.getState(state.stream).state !== 'readable') return;
  resetQueue(state);
  readableStreamDefaultControllerClearAlgorithms(controller);
  readableStreamError(state.stream, error);
}

export function readableStreamDefaultControllerGetDesiredSize(
  controller: ReadableStreamDefaultControllerImpl,
): number | null {
  const state = ReadableStreamDefaultControllerImpl.getState(controller);
  const streamState = ReadableStreamImpl.getState(state.stream).state;
  if (streamState === 'errored') return null;
  if (streamState === 'closed') return 0;
  return state.strategyHighWaterMark - state.queueTotalSize;
}

export function readableStreamDefaultControllerHasBackpressure(
  controller: ReadableStreamDefaultControllerImpl,
): boolean {
  return !readableStreamDefaultControllerShouldCallPull(controller);
}

export function readableStreamDefaultControllerCanCloseOrEnqueue(
  controller: ReadableStreamDefaultControllerImpl,
): boolean {
  const state = ReadableStreamDefaultControllerImpl.getState(controller);
  return !state.closeRequested &&
    ReadableStreamImpl.getState(state.stream).state === 'readable';
}

export function readableStreamDefaultControllerPull(
  controller: ReadableStreamDefaultControllerImpl,
  request: ReadRequest,
): void {
  const state = ReadableStreamDefaultControllerImpl.getState(controller);
  if (state.queue.length > 0) {
    const chunk = dequeueValue(state);
    if (state.closeRequested && state.queue.length === 0) {
      readableStreamDefaultControllerClearAlgorithms(controller);
      readableStreamClose(state.stream);
    } else {
      readableStreamDefaultControllerCallPullIfNeeded(controller);
    }
    request.chunkSteps(chunk);
    return;
  }

  const reader = ReadableStreamImpl.getState(state.stream).reader;
  if (!ReadableStreamDefaultReaderImpl.is(reader)) {
    throw new Error('Default controller requires a default reader');
  }
  ReadableStreamDefaultReaderImpl.getReadRequests(reader).push(request);
  readableStreamDefaultControllerCallPullIfNeeded(controller);
}

// SPEC_MISMATCH: SetUpReadableStreamDefaultControllerFromUnderlyingSource(stream, underlyingSource, underlyingSourceDict, highWaterMark, sizeAlgorithm) -> void
export function setUpReadableStreamDefaultControllerFromUnderlyingSource(
  stream: ReadableStreamImpl,
  underlyingSource: unknown,
  source: UnderlyingSource,
  strategy: QueuingStrategy,
): void {
  const context = ReadableStreamImpl.getContext(stream);
  const controller = context.construct(
    ReadableStreamDefaultControllerImpl,
  );
  const highWaterMark = extractHighWaterMark(
    strategy,
    1,
    context.realm.intrinsics.rangeError,
  );
  const sizeAlgorithm = extractSizeAlgorithm(strategy);

  const startCallback = source.start;
  const pullCallback = source.pull;
  const cancelCallback = source.cancel;
  const startAlgorithm = startCallback === undefined
    ? () => undefined
    : () => Reflect.apply(startCallback, underlyingSource, [controller]);
  const pullAlgorithm = pullCallback === undefined
    ? () => context.createResolvedPromise(
      undefined,
      idlType.undefined,
    )
    : () => Reflect.apply(pullCallback, underlyingSource, [controller]);
  const cancelAlgorithm = cancelCallback === undefined
    ? () => context.createResolvedPromise(
      undefined,
      idlType.undefined,
    )
    : (reason: unknown) => Reflect.apply(
      cancelCallback,
      underlyingSource,
      [reason],
    );

  setUpReadableStreamDefaultController(
    stream,
    controller,
    startAlgorithm,
    pullAlgorithm,
    cancelAlgorithm,
    highWaterMark,
    sizeAlgorithm,
  );
}

function setUpReadableStreamDefaultController(
  stream: ReadableStreamImpl,
  controller: ReadableStreamDefaultControllerImpl,
  startAlgorithm: () => unknown,
  pullAlgorithm: () => StreamPromise,
  cancelAlgorithm: (reason: unknown) => StreamPromise,
  highWaterMark: number,
  sizeAlgorithm: QueuingStrategySize,
): void {
  const streamState = ReadableStreamImpl.getState(stream);
  if (streamState.controller) {
    throw new Error('ReadableStream already has a controller');
  }

  const state: ReadableStreamDefaultControllerState = {
    cancelAlgorithm,
    closeRequested: false,
    pullAgain: false,
    pullAlgorithm,
    pulling: false,
    queue: [],
    queueTotalSize: 0,
    started: false,
    strategyHighWaterMark: highWaterMark,
    strategySizeAlgorithm: sizeAlgorithm,
    stream,
  };
  ReadableStreamDefaultControllerImpl.setState(controller, state);
  streamState.controller = controller;

  const context = ReadableStreamImpl.getContext(stream);
  const startPromise = context.createResolvedPromise(
    startAlgorithm(),
    idlType.any,
  );
  context.reactToPromise(startPromise, idlType.undefined, {
    fulfilled() {
      state.started = true;
      readableStreamDefaultControllerCallPullIfNeeded(controller);
    },
    rejected(reason) {
      readableStreamDefaultControllerError(controller, reason);
    },
  });
}

function readableStreamDefaultControllerShouldCallPull(
  controller: ReadableStreamDefaultControllerImpl,
): boolean {
  const state = ReadableStreamDefaultControllerImpl.getState(controller);
  if (!readableStreamDefaultControllerCanCloseOrEnqueue(controller)) {
    return false;
  }
  if (!state.started) return false;

  const reader = ReadableStreamImpl.getState(state.stream).reader;
  if (ReadableStreamDefaultReaderImpl.is(reader) &&
    ReadableStreamDefaultReaderImpl.getReadRequests(reader).length) {
    return true;
  }

  const desiredSize = readableStreamDefaultControllerGetDesiredSize(
    controller,
  );
  return desiredSize !== null && desiredSize > 0;
}

function readableStreamDefaultReaderErrorReadRequests(
  reader: ReadableStreamDefaultReaderImpl,
  error: unknown,
): void {
  const requests = ReadableStreamDefaultReaderImpl.getReadRequests(reader);
  ReadableStreamDefaultReaderImpl.resetReadRequests(reader);
  for (const request of requests) request.errorSteps(error);
}

function requireAsyncIteratorState(
  stream: ReadableStreamImpl,
  iterator: object,
): ReadableStreamAsyncIteratorState {
  const state = readableStreamAsyncIterators.get(iterator);
  if (!state || ReadableStreamGenericReaderMixin.getState(
    ReadableStreamDefaultReaderImpl.getGenericReader(state.reader),
  ).stream !== stream) {
    throw new Error('Readable stream async iterator is not initialized');
  }
  return state;
}

function requireDefaultController(
  stream: ReadableStreamImpl,
): ReadableStreamDefaultControllerImpl {
  const controller = ReadableStreamImpl.getController(stream);
  if (!ReadableStreamDefaultControllerImpl.is(controller)) {
    throw new Error('ReadableStream has no default controller');
  }
  return controller;
}

function getGenericReader(
  reader: NonNullable<ReadableStreamState['reader']>,
): ReadableStreamGenericReaderMixin {
  return ReadableStreamDefaultReaderImpl.is(reader)
    ? ReadableStreamDefaultReaderImpl.getGenericReader(reader)
    : ReadableStreamBYOBReaderImpl.getGenericReader(reader);
}

function requireAlgorithm<Algorithm>(
  algorithm: Algorithm | undefined,
  name: string,
): Algorithm {
  if (!algorithm) throw new Error(`Readable stream ${name} algorithm is gone`);
  return algorithm;
}

type ReadableStreamAsyncIteratorState = {
  readonly preventCancel: boolean;
  readonly reader: ReadableStreamDefaultReaderImpl;
};

const readableStreamAsyncIterators = new WeakMap<
  object,
  ReadableStreamAsyncIteratorState
>();
