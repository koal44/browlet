import { idlType } from '../web-idl/declaration/index';
import type { StreamPromise } from './environment';
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
import {
  ReadableStreamGenericReaderMixin,
} from './readable-stream-generic-reader';
import {
  ReadableStreamImpl, type ReadableStreamState, type UnderlyingSource,
} from './readable-stream';

export function initializeReadableStream(): ReadableStreamState {
  return {
    detached: false,
    disturbed: false,
    state: 'readable',
  };
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
  const sourceCancelPromise = requireController(state)[cancelSteps](reason);
  return environment.promises.react(
    sourceCancelPromise,
    idlType.undefined,
    { fulfilled: () => undefined },
  );
}

export function readableStreamClose(stream: ReadableStreamImpl): void {
  const state = ReadableStreamImpl.getState(stream);
  if (state.state !== 'readable') {
    throw new Error('Only a readable stream can be closed');
  }
  state.state = 'closed';

  const reader = state.reader;
  if (!reader) return;

  const generic = ReadableStreamDefaultReaderImpl.getGenericReader(reader);
  const environment = ReadableStreamGenericReaderMixin.getEnvironment(generic);
  environment.promises.resolve(
    ReadableStreamGenericReaderMixin.getState(generic).closedPromise,
    undefined,
  );

  const requests = ReadableStreamDefaultReaderImpl.getReadRequests(reader);
  ReadableStreamDefaultReaderImpl.resetReadRequests(reader);
  for (const request of requests) request.closeSteps();
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

  const generic = ReadableStreamDefaultReaderImpl.getGenericReader(reader);
  const environment = ReadableStreamGenericReaderMixin.getEnvironment(generic);
  const closedPromise = ReadableStreamGenericReaderMixin.getState(
    generic,
  ).closedPromise;
  environment.promises.reject(closedPromise, error);
  environment.promises.markHandled(closedPromise);
  readableStreamDefaultReaderErrorReadRequests(reader, error);
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
  ReadableStreamDefaultReaderImpl.resetReadRequests(reader);
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
  const genericState = ReadableStreamGenericReaderMixin.getState(generic);
  const stream = genericState.stream;
  if (!stream) throw new Error('Cannot release an already released reader');

  const streamState = ReadableStreamImpl.getState(stream);
  const environment = ReadableStreamGenericReaderMixin.getEnvironment(generic);
  const error = new TypeError(
    'Reader was released and can no longer be used to monitor the stream\'s closedness',
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

  readableStreamDefaultReaderErrorReadRequests(
    reader,
    new TypeError('Reader was released'),
  );
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
  if (reader && ReadableStreamDefaultReaderImpl.getReadRequests(reader).length) {
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
  if (!reader) throw new Error('Locked readable stream has no reader');
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
  const startResult = startAlgorithm();
  const startPromise = environment.promises.createResolved(
    startResult,
    idlType.any,
  );
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
  if (reader && ReadableStreamDefaultReaderImpl.getReadRequests(reader).length) {
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
): ReadableStreamDefaultControllerImpl {
  if (!state.controller) throw new Error('ReadableStream has no controller');
  return state.controller;
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
