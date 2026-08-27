import { idlType } from '../web-idl/declaration/index';
import type { StreamEnvironment, StreamPromise } from './environment';
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
  ReadableStreamImpl, type ReadableStreamState, type StreamAbortSignal,
  type ReadableStreamIteratorOptions, type UnderlyingSource,
} from './readable-stream';
import type { WritableStreamImpl } from './writable-stream';
import {
  isWritableStreamWritable, writableStreamAbort,
  writableStreamCloseQueuedOrInFlight,
  writableStreamDefaultWriterCloseWithErrorPropagation,
  writableStreamDefaultWriterRelease, writableStreamDefaultWriterWrite,
} from './writable-stream-operations';
import {
  getWritableStreamDefaultWriterState, getWritableStreamState,
} from './writable-stream-slots';

export function initializeReadableStream(): ReadableStreamState {
  return {
    detached: false,
    disturbed: false,
    state: 'readable',
  };
}

export function createReadableStream(
  environment: StreamEnvironment,
  startAlgorithm: () => unknown,
  pullAlgorithm: () => StreamPromise,
  cancelAlgorithm: (reason: unknown) => StreamPromise,
  highWaterMark = 1,
  sizeAlgorithm: QueuingStrategySize = () => 1,
  startPromise?: StreamPromise,
): ReadableStreamImpl {
  const stream = environment.objects.construct(
    ReadableStreamImpl,
    [internalStreamSetup],
  );
  const controller = environment.objects.create(
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
    startPromise,
  );
  return stream;
}

export function isReadableStreamLocked(stream: ReadableStreamImpl): boolean {
  return ReadableStreamImpl.getState(stream).reader !== undefined;
}

export function acquireReadableStreamDefaultReader(
  stream: ReadableStreamImpl,
): ReadableStreamDefaultReaderImpl {
  const reader = ReadableStreamImpl.getEnvironment(stream).objects.create(
    ReadableStreamDefaultReaderImpl,
  );
  setUpReadableStreamDefaultReader(reader, stream);
  return reader;
}

export function readableStreamCancel(
  stream: ReadableStreamImpl,
  reason: unknown,
): StreamPromise {
  const state = ReadableStreamImpl.getState(stream);
  const environment = ReadableStreamImpl.getEnvironment(stream);
  state.disturbed = true;

  if (state.state === 'closed') {
    return environment.promises.createResolved(
      undefined,
      idlType.undefined,
    );
  }
  if (state.state === 'errored') {
    return environment.promises.createRejected(
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
  const sourceCancelPromise = requireController(state)[cancelSteps](reason);
  return environment.promises.react(
    sourceCancelPromise,
    idlType.undefined,
    { fulfilled: () => undefined },
  );
}

export function readableStreamFromIterable(
  environment: StreamEnvironment,
  asyncIterable: object,
): ReadableStreamImpl {
  const iterator = environment.iteration.open(asyncIterable);
  const source: UnderlyingSource = {
    start: () => undefined,
    pull() {
      return environment.promises.react(
        environment.iteration.getNext(iterator),
        idlType.undefined,
        {
          fulfilled(value) {
            const controller = requireDefaultController(stream);
            if (value === environment.iteration.end) {
              readableStreamDefaultControllerClose(controller);
            } else {
              readableStreamDefaultControllerEnqueue(controller, value);
            }
          },
        },
      );
    },
    cancel(reason) {
      return environment.promises.react(
        environment.iteration.close(iterator, reason),
        idlType.undefined,
        { fulfilled: () => undefined },
      );
    },
  };
  const stream = environment.objects.construct(
    ReadableStreamImpl,
    [source, { highWaterMark: 0 }],
  );
  return stream;
}

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
  const environment = ReadableStreamGenericReaderMixin.getEnvironment(generic);
  if (!ReadableStreamGenericReaderMixin.getState(generic).stream) {
    throw new Error('Readable stream async iterator reader was released');
  }

  const promise = environment.promises.create(idlType.any);
  readableStreamDefaultReaderRead(state.reader, {
    chunkSteps: (chunk) => environment.promises.resolve(promise, chunk),
    closeSteps() {
      readableStreamDefaultReaderRelease(state.reader);
      environment.promises.resolve(promise, environment.iteration.end);
    },
    errorSteps(reason) {
      readableStreamDefaultReaderRelease(state.reader);
      environment.promises.reject(promise, reason);
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
  const environment = ReadableStreamGenericReaderMixin.getEnvironment(generic);
  if (!ReadableStreamGenericReaderMixin.getState(generic).stream) {
    throw new Error('Readable stream async iterator reader was released');
  }

  if (!state.preventCancel) {
    const result = readableStreamReaderGenericCancel(generic, value);
    readableStreamDefaultReaderRelease(state.reader);
    return result;
  }

  readableStreamDefaultReaderRelease(state.reader);
  return environment.promises.createResolved(undefined, idlType.undefined);
}

export function readableStreamPipeTo(
  source: ReadableStreamImpl,
  destination: WritableStreamImpl,
  preventClose: boolean,
  preventAbort: boolean,
  preventCancel: boolean,
  signal?: StreamAbortSignal,
): StreamPromise {
  const environment = ReadableStreamImpl.getEnvironment(source);
  const reader = acquireReadableStreamDefaultReader(source);
  const writer = destination.getWriter();
  const sourceState = ReadableStreamImpl.getState(source);
  const destinationState = getWritableStreamState(destination);
  const readerState = ReadableStreamGenericReaderMixin.getState(
    ReadableStreamDefaultReaderImpl.getGenericReader(reader),
  );
  const writerState = getWritableStreamDefaultWriterState(writer);
  sourceState.disturbed = true;

  let shuttingDown = false;
  let currentWrite = environment.promises.createResolved(
    undefined,
    idlType.undefined,
  );
  const result = environment.promises.create(idlType.undefined);
  let abortAlgorithm: (() => void) | undefined;

  if (signal) {
    abortAlgorithm = () => {
      const error = signal.reason;
      const actions: Array<() => StreamPromise> = [];
      if (!preventAbort) {
        actions.push(() => isWritableStreamWritable(destination)
          ? writableStreamAbort(destination, error)
          : environment.promises.createResolved(
            undefined,
            idlType.undefined,
          ));
      }
      if (!preventCancel) {
        actions.push(() => sourceState.state === 'readable'
          ? readableStreamCancel(source, error)
          : environment.promises.createResolved(
            undefined,
            idlType.undefined,
          ));
      }
      shutdownWithAction(
        () => environment.promises.waitForAll(
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
    signal.addEventListener('abort', abortAlgorithm);
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

  environment.promises.markHandled(pipeLoop());
  return result;

  function pipeLoop(): StreamPromise {
    const loop = environment.promises.create(idlType.undefined);
    const next = (done: unknown): void => {
      if (done) {
        environment.promises.resolve(loop, undefined);
        return;
      }
      environment.promises.react(pipeStep(), idlType.undefined, {
        fulfilled: next,
        rejected: (reason) => environment.promises.reject(loop, reason),
      });
    };
    next(false);
    return loop;
  }

  function pipeStep(): StreamPromise {
    if (shuttingDown) {
      return environment.promises.createResolved(true, idlType.boolean);
    }

    return environment.promises.react(
      writerState.readyPromise,
      idlType.boolean,
      {
        fulfilled() {
          const read = environment.promises.create(idlType.boolean);
          readableStreamDefaultReaderRead(reader, {
            chunkSteps(chunk) {
              currentWrite = environment.promises.react(
                writableStreamDefaultWriterWrite(writer, chunk),
                idlType.undefined,
                { rejected: () => undefined },
              );
              environment.promises.resolve(read, false);
            },
            closeSteps: () => environment.promises.resolve(read, true),
            errorSteps: (reason) => environment.promises.reject(read, reason),
          });
          return read;
        },
      },
    );
  }

  function waitForWritesToFinish(): StreamPromise {
    const oldCurrentWrite = currentWrite;
    return environment.promises.react(
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
      environment.promises.react(
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
      environment.promises.react(
        promise,
        idlType.undefined,
        {
          fulfilled: action,
          rejected: () => undefined,
        },
      );
    }
  }

  function shutdownWithAction(
    action: () => StreamPromise,
    originalIsError = false,
    originalError?: unknown,
  ): void {
    if (shuttingDown) return;
    shuttingDown = true;

    const doTheRest = (): void => {
      environment.promises.react(action(), idlType.undefined, {
        fulfilled: () => finalize(originalIsError, originalError),
        rejected: (newError) => finalize(true, newError),
      });
    };
    if (isWritableStreamWritable(destination) &&
      !writableStreamCloseQueuedOrInFlight(destination)) {
      environment.promises.react(
        waitForWritesToFinish(),
        idlType.undefined,
        { fulfilled: doTheRest },
      );
    } else {
      doTheRest();
    }
  }

  function shutdown(isError = false, error?: unknown): void {
    if (shuttingDown) return;
    shuttingDown = true;

    if (isWritableStreamWritable(destination) &&
      !writableStreamCloseQueuedOrInFlight(destination)) {
      environment.promises.react(
        waitForWritesToFinish(),
        idlType.undefined,
        { fulfilled: () => finalize(isError, error) },
      );
    } else {
      finalize(isError, error);
    }
  }

  function finalize(isError: boolean, error?: unknown): void {
    writableStreamDefaultWriterRelease(writer);
    readableStreamDefaultReaderRelease(reader);
    if (signal && abortAlgorithm) {
      signal.removeEventListener('abort', abortAlgorithm);
    }
    if (isError) environment.promises.reject(result, error);
    else environment.promises.resolve(result, undefined);
  }
}

export function readableStreamDefaultTee(
  stream: ReadableStreamImpl,
  cloneForBranch2: boolean,
): [ReadableStreamImpl, ReadableStreamImpl] {
  const environment = ReadableStreamImpl.getEnvironment(stream);
  const reader = acquireReadableStreamDefaultReader(stream);
  const generic = ReadableStreamDefaultReaderImpl.getGenericReader(reader);
  let reading = false;
  let readAgain = false;
  let canceled1 = false;
  let canceled2 = false;
  let reason1: unknown = undefined;
  let reason2: unknown = undefined;
  const cancelPromise = environment.promises.create(idlType.undefined);

  const pullAlgorithm = (): StreamPromise => {
    if (reading) {
      readAgain = true;
      return environment.promises.createResolved(
        undefined,
        idlType.undefined,
      );
    }
    reading = true;
    readableStreamDefaultReaderRead(reader, {
      chunkSteps(chunk) {
        environment.queueMicrotask(() => {
          readAgain = false;
          if (cloneForBranch2 && !canceled2) {
            throw new Error(
              'Structured cloning for generic stream teeing is not available',
            );
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
              chunk,
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
          environment.promises.resolve(cancelPromise, undefined);
        }
      },
      errorSteps() {
        reading = false;
      },
    });
    return environment.promises.createResolved(
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
  const source1: UnderlyingSource = {
    cancel: cancel1Algorithm,
    pull: pullAlgorithm,
    start: () => undefined,
  };
  const source2: UnderlyingSource = {
    cancel: cancel2Algorithm,
    pull: pullAlgorithm,
    start: () => undefined,
  };
  const branch1 = environment.objects.construct(ReadableStreamImpl, [source1]);
  const branch2 = environment.objects.construct(ReadableStreamImpl, [source2]);

  environment.promises.react(
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
          environment.promises.resolve(cancelPromise, undefined);
        }
      },
    },
  );
  return [branch1, branch2];

  function settleCancelPromise(reason: readonly unknown[]): void {
    environment.promises.react(
      readableStreamCancel(stream, [...reason]),
      idlType.undefined,
      {
        fulfilled: () => environment.promises.resolve(
          cancelPromise,
          undefined,
        ),
        rejected: (error) => environment.promises.reject(
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
  const environment = ReadableStreamGenericReaderMixin.getEnvironment(generic);
  environment.promises.resolve(
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
  const environment = ReadableStreamGenericReaderMixin.getEnvironment(generic);
  const closedPromise = ReadableStreamGenericReaderMixin.getState(
    generic,
  ).closedPromise;
  environment.promises.reject(closedPromise, error);
  environment.promises.markHandled(closedPromise);
  if (ReadableStreamDefaultReaderImpl.is(reader)) {
    readableStreamDefaultReaderErrorReadRequests(reader, error);
  } else {
    const requests = ReadableStreamBYOBReaderImpl.getReadIntoRequests(reader);
    ReadableStreamBYOBReaderImpl.resetReadIntoRequests(reader);
    for (const request of requests) request.errorSteps(error);
  }
}

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
  if (isReadableStreamLocked(stream)) {
    throw new TypeError(
      'This stream has already been locked for exclusive reading by another reader',
    );
  }

  const generic = ReadableStreamDefaultReaderImpl.getGenericReader(reader);
  readableStreamReaderGenericInitialize(generic, reader, stream);
  ReadableStreamDefaultReaderImpl.resetReadRequests(reader);
}

export function readableStreamReaderGenericInitialize(
  generic: ReadableStreamGenericReaderMixin,
  reader: ReadableStreamState['reader'] & object,
  stream: ReadableStreamImpl,
): void {
  const environment = ReadableStreamGenericReaderMixin.getEnvironment(generic);
  const streamState = ReadableStreamImpl.getState(stream);
  let closedPromise: StreamPromise;
  if (streamState.state === 'readable') {
    closedPromise = environment.promises.create(idlType.undefined);
  } else if (streamState.state === 'closed') {
    closedPromise = environment.promises.createResolved(
      undefined,
      idlType.undefined,
    );
  } else {
    closedPromise = environment.promises.createRejected(
      streamState.storedError,
      idlType.undefined,
    );
    environment.promises.markHandled(closedPromise);
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
    requireController(streamState)[pullSteps](request);
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

export function readableStreamReaderGenericRelease(
  generic: ReadableStreamGenericReaderMixin,
  reader: ReadableStreamState['reader'] & object,
): void {
  const genericState = ReadableStreamGenericReaderMixin.getState(generic);
  const stream = genericState.stream;
  if (!stream) throw new Error('Cannot release an already released reader');

  const streamState = ReadableStreamImpl.getState(stream);
  if (streamState.reader !== reader) {
    throw new Error('Readable stream is locked by a different reader');
  }
  const environment = ReadableStreamGenericReaderMixin.getEnvironment(generic);
  const error = new TypeError(
    'Reader was released and can no longer monitor the stream\'s closedness',
  );
  if (streamState.state === 'readable') {
    environment.promises.reject(genericState.closedPromise, error);
  } else {
    genericState.closedPromise = environment.promises.createRejected(
      error,
      idlType.undefined,
    );
  }
  environment.promises.markHandled(genericState.closedPromise);

  requireController(streamState)[releaseSteps]();
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
  const environment = ReadableStreamDefaultControllerImpl.getEnvironment(
    controller,
  );
  const pullPromise = requireAlgorithm(state.pullAlgorithm, 'pull')();
  environment.promises.react(pullPromise, idlType.undefined, {
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
      enqueueValueWithSize(state, chunk, chunkSize);
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

export function setUpReadableStreamDefaultControllerFromUnderlyingSource(
  stream: ReadableStreamImpl,
  underlyingSource: unknown,
  source: UnderlyingSource,
  strategy: QueuingStrategy,
): void {
  const environment = ReadableStreamImpl.getEnvironment(stream);
  const controller = environment.objects.create(
    ReadableStreamDefaultControllerImpl,
  );
  const highWaterMark = extractHighWaterMark(strategy, 1);
  const sizeAlgorithm = extractSizeAlgorithm(strategy);

  const startAlgorithm = source.start === undefined
    ? () => undefined
    : () => environment.callbacks.invoke(
      source.start,
      [controller],
      'rethrow',
      underlyingSource,
    );
  const pullAlgorithm = source.pull === undefined
    ? () => environment.promises.createResolved(
      undefined,
      idlType.undefined,
    )
    : () => requirePromise(environment.callbacks.invoke(
      source.pull,
      [controller],
      undefined,
      underlyingSource,
    ));
  const cancelAlgorithm = source.cancel === undefined
    ? () => environment.promises.createResolved(
      undefined,
      idlType.undefined,
    )
    : (reason: unknown) => requirePromise(environment.callbacks.invoke(
      source.cancel,
      [reason],
      undefined,
      underlyingSource,
    ));

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
  suppliedStartPromise?: StreamPromise,
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

  const environment = ReadableStreamImpl.getEnvironment(stream);
  const startPromise = suppliedStartPromise ??
    environment.promises.createResolved(startAlgorithm(), idlType.any);
  environment.promises.react(startPromise, idlType.undefined, {
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

function requireController(
  state: ReadableStreamState,
): NonNullable<ReadableStreamState['controller']> {
  if (!state.controller) throw new Error('ReadableStream has no controller');
  return state.controller;
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
  const controller = ReadableStreamImpl.getState(stream).controller;
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

function requirePromise(value: unknown): StreamPromise {
  if ((typeof value !== 'object' || value === null) &&
    typeof value !== 'function') {
    throw new TypeError('Stream callback did not return a Web IDL promise');
  }
  return value;
}

type ReadableStreamAsyncIteratorState = {
  readonly preventCancel: boolean;
  readonly reader: ReadableStreamDefaultReaderImpl;
};

const readableStreamAsyncIterators = new WeakMap<
  object,
  ReadableStreamAsyncIteratorState
>();
