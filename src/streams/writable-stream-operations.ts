import { idlType } from '../web-idl/declaration/index';
import { createStreamAbortController } from './abort';
import type { StreamPromise } from './promise';
import {
  dequeueValue, enqueueValueWithSize, peekQueueValue,
} from './queue-with-sizes';
import type { QueuingStrategySize } from './queuing-strategy';
import type {
  UnderlyingSink, WritableStreamImpl, WritableStreamState,
} from './writable-stream';
import type {
  WritableStreamDefaultControllerImpl,
  WritableStreamDefaultControllerState,
} from './writable-stream-default-controller';
import type {
  WritableStreamDefaultWriterImpl,
} from './writable-stream-default-writer';
import {
  getWritableStreamDefaultControllerState,
  getWritableStreamDefaultWriterContext,
  getWritableStreamDefaultWriterState,
  getWritableStreamContext,
  getWritableStreamState,
  setWritableStreamDefaultControllerState,
  setWritableStreamDefaultWriterState,
} from './writable-stream-slots';

export function initializeWritableStream(): WritableStreamState {
  return {
    backpressure: false,
    state: 'writable',
    writeRequests: [],
  };
}

export function isWritableStreamLocked(stream: WritableStreamImpl): boolean {
  return getWritableStreamState(stream).writer !== undefined;
}

export function isWritableStreamWritable(stream: WritableStreamImpl): boolean {
  return getWritableStreamState(stream).state === 'writable';
}

export function writableStreamAbort(
  stream: WritableStreamImpl,
  reason: unknown,
): StreamPromise {
  const state = getWritableStreamState(stream);
  const context = getWritableStreamContext(stream);
  if (isWritableStreamFinished(state)) {
    return context.createResolvedPromise(undefined, idlType.undefined);
  }

  getWritableStreamDefaultControllerState(
    requireController(state),
  ).abortController.abort(reason);
  if (isWritableStreamFinished(state)) {
    return context.createResolvedPromise(undefined, idlType.undefined);
  }
  if (state.pendingAbortRequest) return state.pendingAbortRequest.promise;

  const wasAlreadyErroring = state.state === 'erroring';
  const promise = context.createPromise(idlType.undefined);
  state.pendingAbortRequest = {
    promise,
    reason: wasAlreadyErroring ? undefined : reason,
    wasAlreadyErroring,
  };
  if (!wasAlreadyErroring) writableStreamStartErroring(stream, reason);
  return promise;
}

export function writableStreamClose(stream: WritableStreamImpl): StreamPromise {
  const state = getWritableStreamState(stream);
  const context = getWritableStreamContext(stream);
  if (state.state === 'closed' || state.state === 'errored') {
    return context.createRejectedPromise(
      new context.realm.intrinsics.typeError(
        `A stream in the ${state.state} state cannot be closed`,
      ),
      idlType.undefined,
    );
  }
  if (writableStreamCloseQueuedOrInFlight(stream)) {
    throw new Error('Writable stream already has a close operation');
  }

  const promise = context.createPromise(idlType.undefined);
  state.closeRequest = promise;
  if (state.writer && state.backpressure && state.state === 'writable') {
    context.resolvePromise(
      getWritableStreamDefaultWriterState(state.writer).readyPromise,
      undefined,
    );
  }
  writableStreamDefaultControllerClose(requireController(state));
  return promise;
}

export function writableStreamCloseQueuedOrInFlight(
  stream: WritableStreamImpl,
): boolean {
  const state = getWritableStreamState(stream);
  return state.closeRequest !== undefined ||
    state.inFlightCloseRequest !== undefined;
}

export function setUpWritableStreamDefaultWriter(
  writer: WritableStreamDefaultWriterImpl,
  stream: WritableStreamImpl,
): void {
  const context = getWritableStreamDefaultWriterContext(writer);
  if (isWritableStreamLocked(stream)) {
    throw new context.realm.intrinsics.typeError(
      'This stream has already been locked for exclusive writing',
    );
  }

  const streamState = getWritableStreamState(stream);
  let readyPromise: StreamPromise;
  let closedPromise: StreamPromise;
  if (streamState.state === 'writable') {
    readyPromise = !writableStreamCloseQueuedOrInFlight(stream) &&
      streamState.backpressure
      ? context.createPromise(idlType.undefined)
      : context.createResolvedPromise(undefined, idlType.undefined);
    closedPromise = context.createPromise(idlType.undefined);
  } else if (streamState.state === 'erroring') {
    readyPromise = context.createRejectedPromise(
      streamState.storedError,
      idlType.undefined,
    );
    context.markPromiseHandled(readyPromise);
    closedPromise = context.createPromise(idlType.undefined);
  } else if (streamState.state === 'closed') {
    readyPromise = context.createResolvedPromise(
      undefined,
      idlType.undefined,
    );
    closedPromise = context.createResolvedPromise(
      undefined,
      idlType.undefined,
    );
  } else {
    readyPromise = context.createRejectedPromise(
      streamState.storedError,
      idlType.undefined,
    );
    context.markPromiseHandled(readyPromise);
    closedPromise = context.createRejectedPromise(
      streamState.storedError,
      idlType.undefined,
    );
    context.markPromiseHandled(closedPromise);
  }

  setWritableStreamDefaultWriterState(writer, {
    closedPromise,
    readyPromise,
    stream,
  });
  streamState.writer = writer;
}

export function writableStreamDefaultWriterAbort(
  writer: WritableStreamDefaultWriterImpl,
  reason: unknown,
): StreamPromise {
  return writableStreamAbort(requireWriterStream(writer), reason);
}

export function writableStreamDefaultWriterClose(
  writer: WritableStreamDefaultWriterImpl,
): StreamPromise {
  return writableStreamClose(requireWriterStream(writer));
}

export function writableStreamDefaultWriterCloseWithErrorPropagation(
  writer: WritableStreamDefaultWriterImpl,
): StreamPromise {
  const stream = requireWriterStream(writer);
  const streamState = getWritableStreamState(stream);
  const context = getWritableStreamContext(stream);
  if (writableStreamCloseQueuedOrInFlight(stream) ||
    streamState.state === 'closed') {
    return context.createResolvedPromise(undefined, idlType.undefined);
  }
  if (streamState.state === 'errored') {
    return context.createRejectedPromise(
      streamState.storedError,
      idlType.undefined,
    );
  }
  return writableStreamDefaultWriterClose(writer);
}

export function writableStreamDefaultWriterGetDesiredSize(
  writer: WritableStreamDefaultWriterImpl,
): number | null {
  const stream = requireWriterStream(writer);
  const state = getWritableStreamState(stream);
  if (state.state === 'errored' || state.state === 'erroring') return null;
  if (state.state === 'closed') return 0;
  return writableStreamDefaultControllerGetDesiredSize(
    requireController(state),
  );
}

export function writableStreamDefaultWriterRelease(
  writer: WritableStreamDefaultWriterImpl,
): void {
  const writerState = getWritableStreamDefaultWriterState(writer);
  const stream = requireWriterStream(writer);
  const streamState = getWritableStreamState(stream);
  if (streamState.writer !== writer) {
    throw new Error('Writable stream is locked by another writer');
  }

  const context = getWritableStreamDefaultWriterContext(writer);
  const releasedError = new context.realm.intrinsics.typeError(
    'Writer was released and can no longer monitor the stream',
  );
  writableStreamDefaultWriterEnsureReadyPromiseRejected(
    writer,
    releasedError,
  );
  writableStreamDefaultWriterEnsureClosedPromiseRejected(
    writer,
    releasedError,
  );
  streamState.writer = undefined;
  writerState.stream = undefined;
}

export function writableStreamDefaultWriterWrite(
  writer: WritableStreamDefaultWriterImpl,
  chunk: unknown,
): StreamPromise {
  const stream = requireWriterStream(writer);
  const streamState = getWritableStreamState(stream);
  const context = getWritableStreamContext(stream);
  const controller = requireController(streamState);
  const chunkSize = writableStreamDefaultControllerGetChunkSize(
    controller,
    chunk,
  );

  if (stream !== getWritableStreamDefaultWriterState(writer).stream) {
    return context.createRejectedPromise(
      new context.realm.intrinsics.typeError(
        'Cannot write using a released writer',
      ),
      idlType.undefined,
    );
  }
  if (streamState.state === 'errored' ||
    streamState.state === 'erroring') {
    return context.createRejectedPromise(
      streamState.storedError,
      idlType.undefined,
    );
  }
  if (writableStreamCloseQueuedOrInFlight(stream) ||
    streamState.state === 'closed') {
    return context.createRejectedPromise(
      new context.realm.intrinsics.typeError(
        'The stream is closing or closed',
      ),
      idlType.undefined,
    );
  }

  const promise = context.createPromise(idlType.undefined);
  streamState.writeRequests.push(promise);
  writableStreamDefaultControllerWrite(controller, chunk, chunkSize);
  return promise;
}

export function setUpWritableStreamDefaultControllerFromUnderlyingSink(
  stream: WritableStreamImpl,
  controller: WritableStreamDefaultControllerImpl,
  underlyingSink: unknown,
  sink: UnderlyingSink,
  highWaterMark: number,
  sizeAlgorithm: QueuingStrategySize,
  suppliedStartPromise?: StreamPromise,
): void {
  const context = getWritableStreamContext(stream);
  const startCallback = sink.start;
  const writeCallback = sink.write;
  const closeCallback = sink.close;
  const abortCallback = sink.abort;
  const startAlgorithm = startCallback === undefined
    ? () => undefined
    : () => Reflect.apply(startCallback, underlyingSink, [controller]);
  const writeAlgorithm = writeCallback === undefined
    ? () => context.createResolvedPromise(
      undefined,
      idlType.undefined,
    )
    : (chunk: unknown) => Reflect.apply(
      writeCallback,
      underlyingSink,
      [chunk, controller],
    );
  const closeAlgorithm = closeCallback === undefined
    ? () => context.createResolvedPromise(
      undefined,
      idlType.undefined,
    )
    : () => Reflect.apply(closeCallback, underlyingSink, []);
  const abortAlgorithm = abortCallback === undefined
    ? () => context.createResolvedPromise(
      undefined,
      idlType.undefined,
    )
    : (reason: unknown) => Reflect.apply(
      abortCallback,
      underlyingSink,
      [reason],
    );

  setUpWritableStreamDefaultController(
    stream,
    controller,
    startAlgorithm,
    writeAlgorithm,
    closeAlgorithm,
    abortAlgorithm,
    highWaterMark,
    sizeAlgorithm,
    suppliedStartPromise,
  );
}

export function writableStreamDefaultControllerClearAlgorithms(
  controller: WritableStreamDefaultControllerImpl,
): void {
  const state = getWritableStreamDefaultControllerState(controller);
  state.writeAlgorithm = undefined;
  state.closeAlgorithm = undefined;
  state.abortAlgorithm = undefined;
  state.strategySizeAlgorithm = undefined;
}

export function writableStreamDefaultControllerError(
  controller: WritableStreamDefaultControllerImpl,
  error: unknown,
): void {
  const state = getWritableStreamDefaultControllerState(controller);
  if (getWritableStreamState(state.stream).state !== 'writable') {
    throw new Error('Only a writable stream can start erroring');
  }
  writableStreamDefaultControllerClearAlgorithms(controller);
  writableStreamStartErroring(state.stream, error);
}

export function writableStreamDefaultControllerErrorIfNeeded(
  controller: WritableStreamDefaultControllerImpl,
  error: unknown,
): void {
  const stream = getWritableStreamDefaultControllerState(
    controller,
  ).stream;
  if (getWritableStreamState(stream).state === 'writable') {
    writableStreamDefaultControllerError(controller, error);
  }
}

export function setUpWritableStreamDefaultController(
  stream: WritableStreamImpl,
  controller: WritableStreamDefaultControllerImpl,
  startAlgorithm: () => unknown,
  writeAlgorithm: (chunk: unknown) => StreamPromise,
  closeAlgorithm: () => StreamPromise,
  abortAlgorithm: (reason: unknown) => StreamPromise,
  highWaterMark: number,
  sizeAlgorithm: QueuingStrategySize,
  suppliedStartPromise?: StreamPromise,
): void {
  const streamState = getWritableStreamState(stream);
  if (streamState.controller) {
    throw new Error('WritableStream already has a controller');
  }
  const context = getWritableStreamContext(stream);
  const state: WritableStreamDefaultControllerState = {
    abortAlgorithm,
    abortController: createStreamAbortController(context),
    closeAlgorithm,
    queue: [],
    queueTotalSize: 0,
    started: false,
    strategyHighWaterMark: highWaterMark,
    strategySizeAlgorithm: sizeAlgorithm,
    stream,
    writeAlgorithm,
  };
  setWritableStreamDefaultControllerState(controller, state);
  streamState.controller = controller;

  writableStreamUpdateBackpressure(
    stream,
    writableStreamDefaultControllerGetBackpressure(controller),
  );
  const startPromise = suppliedStartPromise ??
    context.createResolvedPromise(startAlgorithm(), idlType.any);
  context.reactToPromise(startPromise, idlType.undefined, {
    fulfilled() {
      state.started = true;
      writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
    },
    rejected(reason) {
      state.started = true;
      writableStreamDealWithRejection(stream, reason);
    },
  });
}

function writableStreamDefaultControllerAdvanceQueueIfNeeded(
  controller: WritableStreamDefaultControllerImpl,
): void {
  const controllerState = getWritableStreamDefaultControllerState(
    controller,
  );
  if (!controllerState.started) return;

  const stream = controllerState.stream;
  const streamState = getWritableStreamState(stream);
  if (streamState.inFlightWriteRequest) return;
  if (streamState.state === 'erroring') {
    writableStreamFinishErroring(stream);
    return;
  }
  if (controllerState.queue.length === 0) return;

  const value = peekQueueValue(controllerState);
  if (value === closeSentinel) {
    writableStreamDefaultControllerProcessClose(controller);
  } else {
    writableStreamDefaultControllerProcessWrite(controller, value);
  }
}

function writableStreamDefaultControllerClose(
  controller: WritableStreamDefaultControllerImpl,
): void {
  const controllerState = getWritableStreamDefaultControllerState(controller);
  enqueueValueWithSize(
    controllerState,
    closeSentinel,
    0,
    getWritableStreamContext(controllerState.stream).realm.intrinsics.rangeError,
  );
  writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
}

function writableStreamDefaultControllerGetBackpressure(
  controller: WritableStreamDefaultControllerImpl,
): boolean {
  return writableStreamDefaultControllerGetDesiredSize(controller) <= 0;
}

function writableStreamDefaultControllerGetChunkSize(
  controller: WritableStreamDefaultControllerImpl,
  chunk: unknown,
): number {
  const state = getWritableStreamDefaultControllerState(controller);
  if (!state.strategySizeAlgorithm) return 1;
  try {
    return state.strategySizeAlgorithm(chunk);
  } catch (error) {
    writableStreamDefaultControllerErrorIfNeeded(controller, error);
    return 1;
  }
}

function writableStreamDefaultControllerGetDesiredSize(
  controller: WritableStreamDefaultControllerImpl,
): number {
  const state = getWritableStreamDefaultControllerState(controller);
  return state.strategyHighWaterMark - state.queueTotalSize;
}

function writableStreamDefaultControllerProcessClose(
  controller: WritableStreamDefaultControllerImpl,
): void {
  const controllerState = getWritableStreamDefaultControllerState(
    controller,
  );
  const stream = controllerState.stream;
  const streamState = getWritableStreamState(stream);
  if (!streamState.closeRequest || streamState.inFlightCloseRequest) {
    throw new Error('Writable stream has no pending close request');
  }
  streamState.inFlightCloseRequest = streamState.closeRequest;
  streamState.closeRequest = undefined;
  dequeueValue(controllerState);
  if (controllerState.queue.length !== 0) {
    throw new Error('Writable stream close sentinel was not last');
  }

  const closePromise = requireAlgorithm(
    controllerState.closeAlgorithm,
    'close',
  )();
  writableStreamDefaultControllerClearAlgorithms(controller);
  getWritableStreamContext(stream).reactToPromise(
    closePromise,
    idlType.undefined,
    {
      fulfilled: () => writableStreamFinishInFlightClose(stream),
      rejected: (reason) =>
        writableStreamFinishInFlightCloseWithError(stream, reason),
    },
  );
}

function writableStreamDefaultControllerProcessWrite(
  controller: WritableStreamDefaultControllerImpl,
  chunk: unknown,
): void {
  const controllerState = getWritableStreamDefaultControllerState(
    controller,
  );
  const stream = controllerState.stream;
  const streamState = getWritableStreamState(stream);
  if (streamState.inFlightWriteRequest ||
    streamState.writeRequests.length === 0) {
    throw new Error('Writable stream has no queued write request');
  }
  streamState.inFlightWriteRequest = streamState.writeRequests.shift();

  const writePromise = requireAlgorithm(
    controllerState.writeAlgorithm,
    'write',
  )(chunk);
  getWritableStreamContext(stream).reactToPromise(
    writePromise,
    idlType.undefined,
    {
      fulfilled() {
        writableStreamFinishInFlightWrite(stream);
        dequeueValue(controllerState);
        if (!writableStreamCloseQueuedOrInFlight(stream) &&
          streamState.state === 'writable') {
          writableStreamUpdateBackpressure(
            stream,
            writableStreamDefaultControllerGetBackpressure(controller),
          );
        }
        writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
      },
      rejected(reason) {
        if (streamState.state === 'writable') {
          writableStreamDefaultControllerClearAlgorithms(controller);
        }
        writableStreamFinishInFlightWriteWithError(stream, reason);
      },
    },
  );
}

function writableStreamDefaultControllerWrite(
  controller: WritableStreamDefaultControllerImpl,
  chunk: unknown,
  chunkSize: number,
): void {
  const controllerState = getWritableStreamDefaultControllerState(
    controller,
  );
  try {
    enqueueValueWithSize(
      controllerState,
      chunk,
      chunkSize,
      getWritableStreamContext(controllerState.stream)
        .realm.intrinsics.rangeError,
    );
  } catch (error) {
    writableStreamDefaultControllerErrorIfNeeded(controller, error);
    return;
  }

  const stream = controllerState.stream;
  const streamState = getWritableStreamState(stream);
  if (!writableStreamCloseQueuedOrInFlight(stream) &&
    streamState.state === 'writable') {
    writableStreamUpdateBackpressure(
      stream,
      writableStreamDefaultControllerGetBackpressure(controller),
    );
  }
  writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
}

function writableStreamDealWithRejection(
  stream: WritableStreamImpl,
  error: unknown,
): void {
  if (getWritableStreamState(stream).state === 'writable') {
    writableStreamStartErroring(stream, error);
  } else {
    writableStreamFinishErroring(stream);
  }
}

function writableStreamFinishErroring(stream: WritableStreamImpl): void {
  const state = getWritableStreamState(stream);
  if (state.state !== 'erroring' || writableStreamHasOperationInFlight(state)) {
    throw new Error('Writable stream cannot finish erroring yet');
  }
  state.state = 'errored';
  writableStreamDefaultControllerErrorSteps(requireController(state));

  const context = getWritableStreamContext(stream);
  for (const request of state.writeRequests) {
    context.rejectPromise(request, state.storedError);
  }
  state.writeRequests = [];

  const abortRequest = state.pendingAbortRequest;
  if (!abortRequest) {
    writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    return;
  }
  state.pendingAbortRequest = undefined;
  if (abortRequest.wasAlreadyErroring) {
    context.rejectPromise(abortRequest.promise, state.storedError);
    writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    return;
  }

  const abortPromise = writableStreamDefaultControllerAbortSteps(
    requireController(state),
    abortRequest.reason,
  );
  context.reactToPromise(abortPromise, idlType.undefined, {
    fulfilled() {
      context.resolvePromise(abortRequest.promise, undefined);
      writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    },
    rejected(reason) {
      context.rejectPromise(abortRequest.promise, reason);
      writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    },
  });
}

function writableStreamFinishInFlightClose(stream: WritableStreamImpl): void {
  const state = getWritableStreamState(stream);
  const request = state.inFlightCloseRequest;
  if (!request) throw new Error('Writable stream has no in-flight close');
  const context = getWritableStreamContext(stream);
  context.resolvePromise(request, undefined);
  state.inFlightCloseRequest = undefined;

  if (state.state === 'erroring') {
    state.storedError = undefined;
    if (state.pendingAbortRequest) {
      context.resolvePromise(
        state.pendingAbortRequest.promise,
        undefined,
      );
      state.pendingAbortRequest = undefined;
    }
  }
  state.state = 'closed';
  if (state.writer) {
    context.resolvePromise(
      getWritableStreamDefaultWriterState(state.writer).closedPromise,
      undefined,
    );
  }
}

function writableStreamDefaultControllerAbortSteps(
  controller: WritableStreamDefaultControllerImpl,
  reason: unknown,
): StreamPromise {
  const state = getWritableStreamDefaultControllerState(controller);
  const promise = requireAlgorithm(state.abortAlgorithm, 'abort')(reason);
  writableStreamDefaultControllerClearAlgorithms(controller);
  return promise;
}

function writableStreamDefaultControllerErrorSteps(
  controller: WritableStreamDefaultControllerImpl,
): void {
  const state = getWritableStreamDefaultControllerState(controller);
  state.queue = [];
  state.queueTotalSize = 0;
}

function writableStreamFinishInFlightCloseWithError(
  stream: WritableStreamImpl,
  error: unknown,
): void {
  const state = getWritableStreamState(stream);
  const request = state.inFlightCloseRequest;
  if (!request) throw new Error('Writable stream has no in-flight close');
  const context = getWritableStreamContext(stream);
  context.rejectPromise(request, error);
  state.inFlightCloseRequest = undefined;
  if (state.pendingAbortRequest) {
    context.rejectPromise(state.pendingAbortRequest.promise, error);
    state.pendingAbortRequest = undefined;
  }
  writableStreamDealWithRejection(stream, error);
}

function writableStreamFinishInFlightWrite(stream: WritableStreamImpl): void {
  const state = getWritableStreamState(stream);
  const request = state.inFlightWriteRequest;
  if (!request) throw new Error('Writable stream has no in-flight write');
  getWritableStreamContext(stream).resolvePromise(
    request,
    undefined,
  );
  state.inFlightWriteRequest = undefined;
}

function writableStreamFinishInFlightWriteWithError(
  stream: WritableStreamImpl,
  error: unknown,
): void {
  const state = getWritableStreamState(stream);
  const request = state.inFlightWriteRequest;
  if (!request) throw new Error('Writable stream has no in-flight write');
  getWritableStreamContext(stream).rejectPromise(request, error);
  state.inFlightWriteRequest = undefined;
  writableStreamDealWithRejection(stream, error);
}

function writableStreamRejectCloseAndClosedPromiseIfNeeded(
  stream: WritableStreamImpl,
): void {
  const state = getWritableStreamState(stream);
  const context = getWritableStreamContext(stream);
  if (state.closeRequest) {
    context.rejectPromise(state.closeRequest, state.storedError);
    state.closeRequest = undefined;
  }
  if (state.writer) {
    const closedPromise = getWritableStreamDefaultWriterState(
      state.writer,
    ).closedPromise;
    context.rejectPromise(closedPromise, state.storedError);
    context.markPromiseHandled(closedPromise);
  }
}

function writableStreamStartErroring(
  stream: WritableStreamImpl,
  reason: unknown,
): void {
  const state = getWritableStreamState(stream);
  if (state.state !== 'writable') {
    throw new Error('Only a writable stream can start erroring');
  }
  state.state = 'erroring';
  state.storedError = reason;
  if (state.writer) {
    writableStreamDefaultWriterEnsureReadyPromiseRejected(
      state.writer,
      reason,
    );
  }
  if (!writableStreamHasOperationInFlight(state) &&
    getWritableStreamDefaultControllerState(
      requireController(state),
    ).started) {
    writableStreamFinishErroring(stream);
  }
}

function writableStreamUpdateBackpressure(
  stream: WritableStreamImpl,
  backpressure: boolean,
): void {
  const state = getWritableStreamState(stream);
  if (state.writer && backpressure !== state.backpressure) {
    const writerState = getWritableStreamDefaultWriterState(state.writer);
    const context = getWritableStreamContext(stream);
    if (backpressure) {
      writerState.readyPromise = context.createPromise(
        idlType.undefined,
      );
    } else {
      context.resolvePromise(writerState.readyPromise, undefined);
    }
  }
  state.backpressure = backpressure;
}

function writableStreamDefaultWriterEnsureClosedPromiseRejected(
  writer: WritableStreamDefaultWriterImpl,
  error: unknown,
): void {
  const state = getWritableStreamDefaultWriterState(writer);
  const context = getWritableStreamDefaultWriterContext(writer);
  if (context.isPromiseUnresolved(state.closedPromise)) {
    context.rejectPromise(state.closedPromise, error);
  } else {
    state.closedPromise = context.createRejectedPromise(
      error,
      idlType.undefined,
    );
  }
  context.markPromiseHandled(state.closedPromise);
}

function writableStreamDefaultWriterEnsureReadyPromiseRejected(
  writer: WritableStreamDefaultWriterImpl,
  error: unknown,
): void {
  const state = getWritableStreamDefaultWriterState(writer);
  const context = getWritableStreamDefaultWriterContext(writer);
  if (context.isPromiseUnresolved(state.readyPromise)) {
    context.rejectPromise(state.readyPromise, error);
  } else {
    state.readyPromise = context.createRejectedPromise(
      error,
      idlType.undefined,
    );
  }
  context.markPromiseHandled(state.readyPromise);
}

function writableStreamHasOperationInFlight(
  state: WritableStreamState,
): boolean {
  return state.inFlightWriteRequest !== undefined ||
    state.inFlightCloseRequest !== undefined;
}

function isWritableStreamFinished(state: WritableStreamState): boolean {
  return state.state === 'closed' || state.state === 'errored';
}

function requireController(
  state: WritableStreamState,
): WritableStreamDefaultControllerImpl {
  if (!state.controller) throw new Error('WritableStream has no controller');
  return state.controller;
}

function requireWriterStream(
  writer: WritableStreamDefaultWriterImpl,
): WritableStreamImpl {
  const stream = getWritableStreamDefaultWriterState(writer).stream;
  if (!stream) throw new Error('WritableStream writer has been released');
  return stream;
}

function requireAlgorithm<Algorithm>(
  algorithm: Algorithm | undefined,
  name: string,
): Algorithm {
  if (!algorithm) throw new Error(`Writable stream ${name} algorithm is gone`);
  return algorithm;
}

const closeSentinel = Symbol('WritableStream close sentinel');
