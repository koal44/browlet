// @rollup-cycle streams-readable
import type { RuntimeContext } from '../js-engine/runtime-context';
import type { PromiseValue } from '../js-engine/promises';
import { TypeError } from '../js-engine/simple-exception';
import { endOfIteration, type AsyncSequenceValue } from '../web-idl/async-sequence';
import type {
  StreamAbortAlgorithmHandle, StreamAbortSignal,
} from './abort';
import {
  cancelSteps, pullSteps, releaseSteps,
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
  type ReadableStreamIteratorOptions, type UnderlyingDefaultSource,
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

// SPEC_MISMATCH: CreateReadableStream(startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark = 1, sizeAlgorithm) -> ReadableStream
export function createReadableStream(
  startAlgorithm: () => PromiseValue<unknown> | void,
  pullAlgorithm: () => PromiseValue<unknown>,
  cancelAlgorithm: (reason: unknown) => PromiseValue<unknown>,
  highWaterMark = 1,
  sizeAlgorithm: QueuingStrategySize = () => 1,
  runtime: RuntimeContext,
): ReadableStreamImpl {
  const stream = new ReadableStreamImpl(null, {}, runtime);
  const controller = new ReadableStreamDefaultControllerImpl();
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
  const reader = new ReadableStreamDefaultReaderImpl();
  setUpReadableStreamDefaultReader(reader, stream);
  return reader;
}

// SPEC_MISMATCH: ReadableStreamCancel(stream, reason) -> Promise<undefined>
export function readableStreamCancel(
  stream: ReadableStreamImpl,
  reason: unknown,
): PromiseValue<void> {
  const state = ReadableStreamImpl.getState(stream);
  state.disturbed = true;

  if (state.state === 'closed') {
    return stream.runtime.promises.resolve(undefined);
  }
  if (state.state === 'errored') {
    return stream.runtime.promises.reject(state.storedError);
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
  return sourceCancelPromise.then(() => undefined);
}

// SPEC_MISMATCH: ReadableStreamFromIterable(asyncIterable) -> ReadableStream
export function readableStreamFromIterable(
  iterator: AsyncSequenceValue<unknown>,
  runtime: RuntimeContext,
): ReadableStreamImpl {
  const { promises } = runtime;
  const stream = createReadableStream(
    () => undefined,
    () => promises.import(iterator.next()).then((result) => {
      const controller = requireDefaultController(stream);
      if (result === endOfIteration) readableStreamDefaultControllerClose(controller);
      else readableStreamDefaultControllerEnqueue(controller, result);
    }, (reason: unknown) => {
      readableStreamDefaultControllerError(requireDefaultController(stream), reason);
    }),
    (reason) => promises.import(iterator.return(reason)),
    0, () => 1, runtime,
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

// SPEC_MISMATCH: ReadableStream get the next iteration result(stream, iterator) -> Promise<any>
export function readableStreamAsyncIteratorGetNext(
  stream: ReadableStreamImpl,
  iterator: object,
): PromiseValue<unknown> {
  const state = requireAsyncIteratorState(stream, iterator);
  const generic = ReadableStreamDefaultReaderImpl.getGenericReader(
    state.reader,
  );
  if (!ReadableStreamGenericReaderMixin.getState(generic).stream) {
    throw new Error('Readable stream async iterator reader was released');
  }

  const promise = stream.runtime.promises.withResolvers<unknown>();
  readableStreamDefaultReaderRead(state.reader, {
    chunkSteps: (chunk) => promise.resolve(chunk),
    closeSteps() {
      readableStreamDefaultReaderRelease(state.reader);
      promise.resolve(endOfIteration);
    },
    errorSteps(reason) {
      readableStreamDefaultReaderRelease(state.reader);
      promise.reject(reason);
    },
  });
  return promise.promise;
}

// SPEC_MISMATCH: ReadableStream asynchronous iterator return(stream, iterator, arg) -> Promise<undefined>
export function readableStreamAsyncIteratorReturn(
  stream: ReadableStreamImpl,
  iterator: object,
  value: unknown,
): PromiseValue<unknown> {
  const state = requireAsyncIteratorState(stream, iterator);
  const generic = ReadableStreamDefaultReaderImpl.getGenericReader(
    state.reader,
  );
  if (!ReadableStreamGenericReaderMixin.getState(generic).stream) {
    throw new Error('Readable stream async iterator reader was released');
  }

  if (!state.preventCancel) {
    const result = readableStreamReaderGenericCancel(generic, value);
    readableStreamDefaultReaderRelease(state.reader);
    return result;
  }

  readableStreamDefaultReaderRelease(state.reader);
  return stream.runtime.promises.resolve(undefined);
}

// SPEC_MISMATCH: ReadableStreamPipeTo(source, dest, preventClose, preventAbort, preventCancel, signal) -> Promise<undefined>
export function readableStreamPipeTo(
  source: ReadableStreamImpl,
  destination: WritableStreamImpl,
  preventClose: boolean,
  preventAbort: boolean,
  preventCancel: boolean,
  signal?: StreamAbortSignal,
): PromiseValue<unknown> {
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
  let currentWrite = source.runtime.promises.resolve(undefined);
  const result = source.runtime.promises.withResolvers<void>();
  let abortAlgorithmHandle: StreamAbortAlgorithmHandle | null | undefined;

  if (signal) {
    const abortAlgorithm = () => {
      const error = signal.reason;
      const actions: Array<() => PromiseValue<unknown>> = [];
      if (!preventAbort) {
        actions.push(() => isWritableStreamWritable(destination)
          ? writableStreamAbort(destination, error)
          : source.runtime.promises.resolve(undefined));
      }
      if (!preventCancel) {
        actions.push(() => sourceState.state === 'readable'
          ? readableStreamCancel(source, error)
          : source.runtime.promises.resolve(undefined));
      }
      shutdownWithAction(
        () => source.runtime.promises.all(actions.map((action) => action())).then(() => undefined),
        true,
        error,
      );
    };

    if (signal.aborted) {
      abortAlgorithm();
      return result.promise;
    }
    abortAlgorithmHandle = signal.addAlgorithm(abortAlgorithm);
  }

  isOrBecomesErrored(
    sourceState,
    readerState.closedPromise.promise,
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
    writerState.closedPromise.promise,
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
  isOrBecomesClosed(sourceState, readerState.closedPromise.promise, () => {
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
    const error = new TypeError(
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

  void pipeLoop().then(undefined, () => {});
  return result.promise;

  function pipeLoop(): PromiseValue<void> {
    const loop = source.runtime.promises.withResolvers<void>();
    const next = (done: unknown): void => {
      if (done) {
        loop.resolve(undefined);
        return;
      }
      void pipeStep().then(next, (reason) => loop.reject(reason));
    };
    next(false);
    return loop.promise;
  }

  function pipeStep(): PromiseValue<boolean> {
    if (shuttingDown) {
      return source.runtime.promises.resolve(true);
    }

    return source.runtime.promises.import(writerState.readyPromise.promise).then(() => {
      const read = source.runtime.promises.withResolvers<boolean>();
      readableStreamDefaultReaderRead(reader, {
        chunkSteps(chunk) {
          const write = source.runtime.promises.resolve(undefined).then(() => writableStreamDefaultWriterWrite(
            writer,
            chunk,
          ));
          currentWrite = write.then(undefined, () => undefined);
          read.resolve(false);
        },
        closeSteps: () => read.resolve(true),
        errorSteps: (reason) => read.reject(reason),
      });
      return read.promise;
    });
  }

  function waitForWritesToFinish(): PromiseValue<void> {
    const oldCurrentWrite = currentWrite;
    return currentWrite.then(() => oldCurrentWrite !== currentWrite
          ? waitForWritesToFinish()
          : undefined);
  }

  function isOrBecomesErrored(
    state: { readonly state: string; readonly storedError?: unknown; },
    promise: PromiseValue<unknown>,
    action: (reason: unknown) => void,
  ): void {
    if (state.state === 'errored') {
      action(state.storedError);
    } else {
      void source.runtime.promises.import(promise).then(undefined, action);
    }
  }

  function isOrBecomesClosed(
    state: { readonly state: string; },
    promise: PromiseValue<unknown>,
    action: () => void,
  ): void {
    if (state.state === 'closed') {
      action();
    } else {
      void source.runtime.promises.import(promise).then(action, () => undefined);
    }
  }

  // SPEC_MISMATCH: Shutdown with an action(action, originalError?) -> void
  function shutdownWithAction(
    action: () => PromiseValue<unknown>,
    originalIsError = false,
    originalError?: unknown,
  ): void {
    if (shuttingDown) return;
    shuttingDown = true;

    const doTheRest = (): void => {
      void source.runtime.promises.import(action()).then(() => finalize(originalIsError, originalError), (newError) => finalize(true, newError));
    };
    if (isWritableStreamWritable(destination) &&
      !writableStreamCloseQueuedOrInFlight(destination)) {
      void waitForWritesToFinish().then(doTheRest);
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
      void waitForWritesToFinish().then(() => finalize(isError, error));
    } else {
      finalize(isError, error);
    }
  }

  // SPEC_MISMATCH: Finalize(error?) -> void
  function finalize(isError: boolean, error?: unknown): void {
    writableStreamDefaultWriterRelease(writer);
    readableStreamDefaultReaderRelease(reader);
    abortAlgorithmHandle?.remove();
    if (isError) result.reject(error);
    else result.resolve(undefined);
  }
}

export function readableStreamDefaultTee(
  stream: ReadableStreamImpl,
  cloneForBranch2: boolean,
): [ReadableStreamImpl, ReadableStreamImpl] {
  const reader = acquireReadableStreamDefaultReader(stream);
  const generic = ReadableStreamDefaultReaderImpl.getGenericReader(reader);
  let reading = false;
  let readAgain = false;
  let canceled1 = false;
  let canceled2 = false;
  let reason1: unknown = undefined;
  let reason2: unknown = undefined;
  const cancelPromise = stream.runtime.promises.withResolvers<void>();

  const pullAlgorithm = (): PromiseValue<unknown> => {
    if (reading) {
      readAgain = true;
      return stream.runtime.promises.resolve(undefined);
    }
    reading = true;
    readableStreamDefaultReaderRead(reader, {
      chunkSteps(chunk) {
        void stream.runtime.promises.resolve().then(() => {
          readAgain = false;
          let chunk2 = chunk;
          if (cloneForBranch2 && !canceled2) {
            try {
              chunk2 = stream.runtime.clone(chunk);
            } catch (error) {
              readableStreamDefaultControllerError(
                requireDefaultController(branch1),
                error,
              );
              readableStreamDefaultControllerError(
                requireDefaultController(branch2),
                error,
              );
              readableStreamCancel(stream, error).observe(cancelPromise.resolve, cancelPromise.reject);
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
          cancelPromise.resolve(undefined);
        }
      },
      errorSteps() {
        reading = false;
      },
    });
    return stream.runtime.promises.resolve(undefined);
  };

  const cancel1Algorithm = (reason: unknown): PromiseValue<unknown> => {
    canceled1 = true;
    reason1 = reason;
    if (canceled2) settleCancelPromise([reason1, reason2]);
    return cancelPromise.promise;
  };
  const cancel2Algorithm = (reason: unknown): PromiseValue<unknown> => {
    canceled2 = true;
    reason2 = reason;
    if (canceled1) settleCancelPromise([reason1, reason2]);
    return cancelPromise.promise;
  };
  const branch1 = createReadableStream(
    () => undefined,
    pullAlgorithm,
    cancel1Algorithm,
    1, () => 1, stream.runtime,
  );
  const branch2 = createReadableStream(
    () => undefined,
    pullAlgorithm,
    cancel2Algorithm,
    1, () => 1, stream.runtime,
  );

  void ReadableStreamGenericReaderMixin.getState(generic).closedPromise.promise.then(() => undefined, (reason) => {
    readableStreamDefaultControllerError(
      requireDefaultController(branch1),
      reason,
    );
    readableStreamDefaultControllerError(
      requireDefaultController(branch2),
      reason,
    );
    if (!canceled1 || !canceled2) {
      cancelPromise.resolve(undefined);
    }
  });
  return [branch1, branch2];

  function settleCancelPromise(reason: readonly unknown[]): void {
    void readableStreamCancel(stream, [...reason]).then(() => cancelPromise.resolve(undefined), (error) => cancelPromise.reject(error));
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
  ReadableStreamGenericReaderMixin.getState(generic).closedPromise.resolve(undefined);

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
  const closedPromise = ReadableStreamGenericReaderMixin.getState(
    generic,
  ).closedPromise;
  closedPromise.reject(error);
  void closedPromise.promise.then(undefined, () => {});
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
): PromiseValue<void> {
  const stream = ReadableStreamGenericReaderMixin.getState(reader).stream;
  if (!stream) throw new Error('Cannot cancel through a released reader');
  return readableStreamCancel(stream, reason);
}

export function setUpReadableStreamDefaultReader(
  reader: ReadableStreamDefaultReaderImpl,
  stream: ReadableStreamImpl,
): void {
  if (isReadableStreamLocked(stream)) {
    throw new TypeError(
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
  const streamState = ReadableStreamImpl.getState(stream);
  const closedPromise = stream.runtime.promises.withResolvers<void>();
  if (streamState.state === 'closed') closedPromise.resolve();
  if (streamState.state === 'errored') {
    closedPromise.reject(streamState.storedError);
    void closedPromise.promise.then(undefined, () => {});
  }

  ReadableStreamGenericReaderMixin.setState(
    generic,
    { closedPromise, stream, promises: stream.runtime.promises },
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
  readableStreamReaderGenericRelease(generic, reader);

  readableStreamDefaultReaderErrorReadRequests(
    reader,
    new TypeError('Reader was released'),
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
  const error = new TypeError(
    'Reader was released and can no longer monitor the stream\'s closedness',
  );
  if (streamState.state === 'readable') {
    genericState.closedPromise.reject(error);
  } else {
    genericState.closedPromise = genericState.promises.withResolvers<void>();
    genericState.closedPromise.reject(error);
  }
  void genericState.closedPromise.promise.then(undefined, () => {});

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
  const pullPromise = requireAlgorithm(state.pullAlgorithm, 'pull')();
  void pullPromise.then(() => {
    state.pulling = false;
    if (state.pullAgain) {
      state.pullAgain = false;
      readableStreamDefaultControllerCallPullIfNeeded(controller);
    }
  }, (error) => {
    readableStreamDefaultControllerError(controller, error);
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
  source: object,
  sourceDict: UnderlyingDefaultSource,
  strategy: QueuingStrategy,
): void {
  const controller = new ReadableStreamDefaultControllerImpl();
  const highWaterMark = extractHighWaterMark(strategy, 1);
  const sizeAlgorithm = extractSizeAlgorithm(strategy);

  const { start, pull, cancel } = sourceDict;
  const startAlgorithm = () => start && Reflect.apply(start, source, [controller]);
  const pullAlgorithm = () => stream.runtime.promises.try(() => pull?.call(source, controller));
  const cancelAlgorithm = (reason: unknown) => stream.runtime.promises.try(() => cancel?.call(source, reason));

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
  startAlgorithm: () => PromiseValue<unknown> | void,
  pullAlgorithm: () => PromiseValue<unknown>,
  cancelAlgorithm: (reason: unknown) => PromiseValue<unknown>,
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

  const startPromise = stream.runtime.promises.resolve(startAlgorithm());
  void startPromise.then(() => {
    state.started = true;
    readableStreamDefaultControllerCallPullIfNeeded(controller);
  }, (reason) => {
    readableStreamDefaultControllerError(controller, reason);
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
