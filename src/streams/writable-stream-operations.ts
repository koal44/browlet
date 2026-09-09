import { InternalPromise } from '../js-engine/internal-promise';
import { TypeError } from '../js-engine/simple-exception';
import type { StreamAbortController } from './abort';
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

// SPEC_MISMATCH: InitializeWritableStream(stream) -> void
export function initializeWritableStream(): WritableStreamState {
  return {
    backpressure: false,
    state: 'writable',
    writeRequests: [],
  };
}

export function isWritableStreamLocked(stream: WritableStreamImpl): boolean {
  return stream.state.writer !== undefined;
}

export function isWritableStreamWritable(stream: WritableStreamImpl): boolean {
  return stream.state.state === 'writable';
}

// SPEC_MISMATCH: WritableStreamAbort(stream, reason) -> Promise<undefined>
export function writableStreamAbort(
  stream: WritableStreamImpl,
  reason: unknown,
): InternalPromise<void> {
  const { state } = stream;
  if (isWritableStreamFinished(state)) {
    return InternalPromise.resolve(undefined);
  }

  requireController(state).state.abortController.abort(reason);
  if (isWritableStreamFinished(state)) {
    return InternalPromise.resolve(undefined);
  }
  if (state.pendingAbortRequest) return state.pendingAbortRequest.promise.promise;

  const wasAlreadyErroring = state.state === 'erroring';
  const promise = InternalPromise.withResolvers<void>();
  state.pendingAbortRequest = {
    promise,
    reason: wasAlreadyErroring ? undefined : reason,
    wasAlreadyErroring,
  };
  if (!wasAlreadyErroring) writableStreamStartErroring(stream, reason);
  return promise.promise;
}

// SPEC_MISMATCH: WritableStreamClose(stream) -> Promise<undefined>
export function writableStreamClose(stream: WritableStreamImpl): InternalPromise<void> {
  const { state } = stream;
  if (state.state === 'closed' || state.state === 'errored') {
    return InternalPromise.reject(new TypeError(
      `A stream in the ${state.state} state cannot be closed`,
    ));
  }
  if (writableStreamCloseQueuedOrInFlight(stream)) {
    throw new Error('Writable stream already has a close operation');
  }

  const promise = InternalPromise.withResolvers<void>();
  state.closeRequest = promise;
  if (state.writer && state.backpressure && state.state === 'writable') {
    state.writer.state.readyPromise.resolve();
    state.writer.state.readyPending = false;
  }
  writableStreamDefaultControllerClose(requireController(state));
  return promise.promise;
}

export function writableStreamCloseQueuedOrInFlight(
  stream: WritableStreamImpl,
): boolean {
  const { state } = stream;
  return state.closeRequest !== undefined ||
    state.inFlightCloseRequest !== undefined;
}

export function setUpWritableStreamDefaultWriter(
  writer: WritableStreamDefaultWriterImpl,
  stream: WritableStreamImpl,
): void {
  if (isWritableStreamLocked(stream)) {
    throw new TypeError(
      'This stream has already been locked for exclusive writing',
    );
  }

  const streamState = stream.state;
  const readyPromise = InternalPromise.withResolvers<void>();
  const closedPromise = InternalPromise.withResolvers<void>();
  const readyPending = streamState.state === 'writable' &&
    !writableStreamCloseQueuedOrInFlight(stream) && streamState.backpressure;
  const closedPending = streamState.state === 'writable' ||
    streamState.state === 'erroring';
  if (streamState.state === 'writable' || streamState.state === 'closed') {
    if (!readyPending) readyPromise.resolve();
  } else {
    readyPromise.reject(streamState.storedError);
    void readyPromise.promise.chain(undefined, () => {}, stream.reactions);
  }
  if (streamState.state === 'closed') closedPromise.resolve();
  if (streamState.state === 'errored') {
    closedPromise.reject(streamState.storedError);
    void closedPromise.promise.chain(undefined, () => {}, stream.reactions);
  }
  writer.state = { closedPromise, closedPending, readyPromise, readyPending, stream, reactions: stream.reactions };
  streamState.writer = writer;
}

// SPEC_MISMATCH: WritableStreamDefaultWriterAbort(writer, reason) -> Promise<undefined>
export function writableStreamDefaultWriterAbort(
  writer: WritableStreamDefaultWriterImpl,
  reason: unknown,
): InternalPromise<void> {
  return writableStreamAbort(requireWriterStream(writer), reason);
}

// SPEC_MISMATCH: WritableStreamDefaultWriterClose(writer) -> Promise<undefined>
export function writableStreamDefaultWriterClose(
  writer: WritableStreamDefaultWriterImpl,
): InternalPromise<void> {
  return writableStreamClose(requireWriterStream(writer));
}

// SPEC_MISMATCH: WritableStreamDefaultWriterCloseWithErrorPropagation(writer) -> Promise<undefined>
export function writableStreamDefaultWriterCloseWithErrorPropagation(
  writer: WritableStreamDefaultWriterImpl,
): InternalPromise<void> {
  const stream = requireWriterStream(writer);
  const { state: streamState } = stream;
  if (writableStreamCloseQueuedOrInFlight(stream) ||
    streamState.state === 'closed') {
    return InternalPromise.resolve(undefined);
  }
  if (streamState.state === 'errored') {
    return InternalPromise.reject(streamState.storedError);
  }
  return writableStreamDefaultWriterClose(writer);
}

export function writableStreamDefaultWriterGetDesiredSize(
  writer: WritableStreamDefaultWriterImpl,
): number | null {
  const stream = requireWriterStream(writer);
  const { state } = stream;
  if (state.state === 'errored' || state.state === 'erroring') return null;
  if (state.state === 'closed') return 0;
  return writableStreamDefaultControllerGetDesiredSize(
    requireController(state),
  );
}

export function writableStreamDefaultWriterRelease(
  writer: WritableStreamDefaultWriterImpl,
): void {
  const writerState = writer.state;
  const stream = requireWriterStream(writer);
  const streamState = stream.state;
  if (streamState.writer !== writer) {
    throw new Error('Writable stream is locked by another writer');
  }

  const releasedError = new TypeError(
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

// SPEC_MISMATCH: WritableStreamDefaultWriterWrite(writer, chunk) -> Promise<undefined>
export function writableStreamDefaultWriterWrite(
  writer: WritableStreamDefaultWriterImpl,
  chunk: unknown,
): InternalPromise<void> {
  const stream = requireWriterStream(writer);
  const { state: streamState } = stream;
  const controller = requireController(streamState);
  const chunkSize = writableStreamDefaultControllerGetChunkSize(
    controller,
    chunk,
  );

  if (stream !== writer.state.stream) {
    return InternalPromise.reject(new TypeError(
      'Cannot write using a released writer',
    ));
  }
  if (streamState.state === 'errored') {
    return InternalPromise.reject(streamState.storedError);
  }
  if (writableStreamCloseQueuedOrInFlight(stream) ||
    streamState.state === 'closed') {
    return InternalPromise.reject(new TypeError(
      'The stream is closing or closed',
    ));
  }
  if (streamState.state === 'erroring') {
    return InternalPromise.reject(streamState.storedError);
  }

  const promise = InternalPromise.withResolvers<void>();
  streamState.writeRequests.push(promise);
  writableStreamDefaultControllerWrite(controller, chunk, chunkSize);
  return promise.promise;
}

// SPEC_MISMATCH: SetUpWritableStreamDefaultControllerFromUnderlyingSink(stream, underlyingSink, underlyingSinkDict, highWaterMark, sizeAlgorithm) -> void
export function setUpWritableStreamDefaultControllerFromUnderlyingSink(
  stream: WritableStreamImpl,
  controller: WritableStreamDefaultControllerImpl,
  sink: UnderlyingSink,
  sinkDict: UnderlyingSink,
  highWaterMark: number,
  sizeAlgorithm: QueuingStrategySize,
  abortController: StreamAbortController,
): void {
  const { start, write, close, abort } = sinkDict;
  const startAlgorithm = () => start && Reflect.apply(start, sink, [controller]);
  const writeAlgorithm = (chunk: unknown) => InternalPromise.try(() => write?.call(sink, chunk, controller));
  const closeAlgorithm = () => InternalPromise.try(() => close?.call(sink));
  const abortAlgorithm = (reason: unknown) => InternalPromise.try(() => abort?.call(sink, reason));

  setUpWritableStreamDefaultController(
    stream,
    controller,
    startAlgorithm,
    writeAlgorithm,
    closeAlgorithm,
    abortAlgorithm,
    highWaterMark,
    sizeAlgorithm,
    abortController,
  );
}

export function writableStreamDefaultControllerClearAlgorithms(
  controller: WritableStreamDefaultControllerImpl,
): void {
  const { state } = controller;
  state.writeAlgorithm = undefined;
  state.closeAlgorithm = undefined;
  state.abortAlgorithm = undefined;
  state.strategySizeAlgorithm = undefined;
}

export function writableStreamDefaultControllerError(
  controller: WritableStreamDefaultControllerImpl,
  error: unknown,
): void {
  const { state } = controller;
  if (state.stream.state.state !== 'writable') {
    throw new Error('Only a writable stream can start erroring');
  }
  writableStreamDefaultControllerClearAlgorithms(controller);
  writableStreamStartErroring(state.stream, error);
}

export function writableStreamDefaultControllerErrorIfNeeded(
  controller: WritableStreamDefaultControllerImpl,
  error: unknown,
): void {
  const { stream } = controller.state;
  if (stream.state.state === 'writable') {
    writableStreamDefaultControllerError(controller, error);
  }
}

// SPEC_MISMATCH: SetUpWritableStreamDefaultController(stream, controller, startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, highWaterMark, sizeAlgorithm) -> void
export function setUpWritableStreamDefaultController(
  stream: WritableStreamImpl,
  controller: WritableStreamDefaultControllerImpl,
  startAlgorithm: () => InternalPromise<unknown> | void,
  writeAlgorithm: (chunk: unknown) => InternalPromise<unknown>,
  closeAlgorithm: () => InternalPromise<unknown>,
  abortAlgorithm: (reason: unknown) => InternalPromise<unknown>,
  highWaterMark: number,
  sizeAlgorithm: QueuingStrategySize,
  abortController: StreamAbortController,
): void {
  const streamState = stream.state;
  if (streamState.controller) {
    throw new Error('WritableStream already has a controller');
  }
  const state: WritableStreamDefaultControllerState = {
    abortAlgorithm,
    abortController,
    closeAlgorithm,
    queue: [],
    queueTotalSize: 0,
    started: false,
    strategyHighWaterMark: highWaterMark,
    strategySizeAlgorithm: sizeAlgorithm,
    stream,
    writeAlgorithm,
  };
  controller.state = state;
  streamState.controller = controller;

  writableStreamUpdateBackpressure(
    stream,
    writableStreamDefaultControllerGetBackpressure(controller),
  );
  const startPromise = InternalPromise.resolve(startAlgorithm());
  void startPromise.chain(() => {
    state.started = true;
    writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
  }, (reason) => {
    state.started = true;
    writableStreamDealWithRejection(stream, reason);
  }, stream.reactions);
}

function writableStreamDefaultControllerAdvanceQueueIfNeeded(
  controller: WritableStreamDefaultControllerImpl,
): void {
  const controllerState = controller.state;
  if (!controllerState.started) return;

  const stream = controllerState.stream;
  const streamState = stream.state;
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
  const controllerState = controller.state;
  enqueueValueWithSize(
    controllerState,
    closeSentinel,
    0,
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
  const { state } = controller;
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
  const { state } = controller;
  return state.strategyHighWaterMark - state.queueTotalSize;
}

function writableStreamDefaultControllerProcessClose(
  controller: WritableStreamDefaultControllerImpl,
): void {
  const controllerState = controller.state;
  const stream = controllerState.stream;
  const streamState = stream.state;
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
  void closePromise.chain(() => writableStreamFinishInFlightClose(stream), (reason) =>
    writableStreamFinishInFlightCloseWithError(stream, reason), stream.reactions);
}

function writableStreamDefaultControllerProcessWrite(
  controller: WritableStreamDefaultControllerImpl,
  chunk: unknown,
): void {
  const controllerState = controller.state;
  const stream = controllerState.stream;
  const streamState = stream.state;
  if (streamState.inFlightWriteRequest ||
    streamState.writeRequests.length === 0) {
    throw new Error('Writable stream has no queued write request');
  }
  streamState.inFlightWriteRequest = streamState.writeRequests.shift();

  const writePromise = requireAlgorithm(
    controllerState.writeAlgorithm,
    'write',
  )(chunk);
  void writePromise.chain(() => {
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
  }, (reason) => {
    if (streamState.state === 'writable') {
      writableStreamDefaultControllerClearAlgorithms(controller);
    }
    writableStreamFinishInFlightWriteWithError(stream, reason);
  }, stream.reactions);
}

function writableStreamDefaultControllerWrite(
  controller: WritableStreamDefaultControllerImpl,
  chunk: unknown,
  chunkSize: number,
): void {
  const controllerState = controller.state;
  try {
    enqueueValueWithSize(
      controllerState,
      chunk,
      chunkSize,
    );
  } catch (error) {
    writableStreamDefaultControllerErrorIfNeeded(controller, error);
    return;
  }

  const stream = controllerState.stream;
  const streamState = stream.state;
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
  if (stream.state.state === 'writable') {
    writableStreamStartErroring(stream, error);
  } else {
    writableStreamFinishErroring(stream);
  }
}

function writableStreamFinishErroring(stream: WritableStreamImpl): void {
  const { state } = stream;
  if (state.state !== 'erroring' || writableStreamHasOperationInFlight(state)) {
    throw new Error('Writable stream cannot finish erroring yet');
  }
  state.state = 'errored';
  writableStreamDefaultControllerErrorSteps(requireController(state));

  for (const request of state.writeRequests) {
    request.reject(state.storedError);
  }
  state.writeRequests = [];

  const abortRequest = state.pendingAbortRequest;
  if (!abortRequest) {
    writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    return;
  }
  state.pendingAbortRequest = undefined;
  if (abortRequest.wasAlreadyErroring) {
    abortRequest.promise.reject(state.storedError);
    writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    return;
  }

  const abortPromise = writableStreamDefaultControllerAbortSteps(
    requireController(state),
    abortRequest.reason,
  );
  void abortPromise.chain(() => {
    abortRequest.promise.resolve(undefined);
    writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
  }, (reason) => {
    abortRequest.promise.reject(reason);
    writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
  }, stream.reactions);
}

function writableStreamFinishInFlightClose(stream: WritableStreamImpl): void {
  const { state } = stream;
  const request = state.inFlightCloseRequest;
  if (!request) throw new Error('Writable stream has no in-flight close');
  request.resolve(undefined);
  state.inFlightCloseRequest = undefined;

  if (state.state === 'erroring') {
    state.storedError = undefined;
    if (state.pendingAbortRequest) {
      state.pendingAbortRequest.promise.resolve(undefined);
      state.pendingAbortRequest = undefined;
    }
  }
  state.state = 'closed';
  if (state.writer) {
    state.writer.state.closedPromise.resolve();
    state.writer.state.closedPending = false;
  }
}

function writableStreamDefaultControllerAbortSteps(
  controller: WritableStreamDefaultControllerImpl,
  reason: unknown,
): InternalPromise<unknown> {
  const { state } = controller;
  const promise = requireAlgorithm(state.abortAlgorithm, 'abort')(reason);
  writableStreamDefaultControllerClearAlgorithms(controller);
  return promise;
}

function writableStreamDefaultControllerErrorSteps(
  controller: WritableStreamDefaultControllerImpl,
): void {
  const { state } = controller;
  state.queue = [];
  state.queueTotalSize = 0;
}

function writableStreamFinishInFlightCloseWithError(
  stream: WritableStreamImpl,
  error: unknown,
): void {
  const { state } = stream;
  const request = state.inFlightCloseRequest;
  if (!request) throw new Error('Writable stream has no in-flight close');
  request.reject(error);
  state.inFlightCloseRequest = undefined;
  if (state.pendingAbortRequest) {
    state.pendingAbortRequest.promise.reject(error);
    state.pendingAbortRequest = undefined;
  }
  writableStreamDealWithRejection(stream, error);
}

function writableStreamFinishInFlightWrite(stream: WritableStreamImpl): void {
  const { state } = stream;
  const request = state.inFlightWriteRequest;
  if (!request) throw new Error('Writable stream has no in-flight write');
  request.resolve(undefined);
  state.inFlightWriteRequest = undefined;
}

function writableStreamFinishInFlightWriteWithError(
  stream: WritableStreamImpl,
  error: unknown,
): void {
  const { state } = stream;
  const request = state.inFlightWriteRequest;
  if (!request) throw new Error('Writable stream has no in-flight write');
  request.reject(error);
  state.inFlightWriteRequest = undefined;
  writableStreamDealWithRejection(stream, error);
}

function writableStreamRejectCloseAndClosedPromiseIfNeeded(
  stream: WritableStreamImpl,
): void {
  const { state } = stream;
  if (state.closeRequest) {
    state.closeRequest.reject(state.storedError);
    state.closeRequest = undefined;
  }
  if (state.writer) {
    const { closedPromise } = state.writer.state;
    closedPromise.reject(state.storedError);
    state.writer.state.closedPending = false;
    void closedPromise.promise.chain(undefined, () => {}, stream.reactions);
  }
}

function writableStreamStartErroring(
  stream: WritableStreamImpl,
  reason: unknown,
): void {
  const { state } = stream;
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
    requireController(state).state.started) {
    writableStreamFinishErroring(stream);
  }
}

function writableStreamUpdateBackpressure(
  stream: WritableStreamImpl,
  backpressure: boolean,
): void {
  const { state } = stream;
  if (state.writer && backpressure !== state.backpressure) {
    const writerState = state.writer.state;
    if (backpressure) {
      writerState.readyPromise = InternalPromise.withResolvers<void>();
      writerState.readyPending = true;
    } else {
      writerState.readyPromise.resolve();
      writerState.readyPending = false;
    }
  }
  state.backpressure = backpressure;
}

function writableStreamDefaultWriterEnsureClosedPromiseRejected(
  writer: WritableStreamDefaultWriterImpl,
  error: unknown,
): void {
  const { state } = writer;
  if (!state.closedPending) state.closedPromise = InternalPromise.withResolvers<void>();
  state.closedPromise.reject(error);
  state.closedPending = false;
  void state.closedPromise.promise.chain(undefined, () => {}, writer.state.reactions);
}

function writableStreamDefaultWriterEnsureReadyPromiseRejected(
  writer: WritableStreamDefaultWriterImpl,
  error: unknown,
): void {
  const { state } = writer;
  if (!state.readyPending) state.readyPromise = InternalPromise.withResolvers<void>();
  state.readyPromise.reject(error);
  state.readyPending = false;
  void state.readyPromise.promise.chain(undefined, () => {}, writer.state.reactions);
}

// SPEC_MISMATCH: WritableStreamHasOperationMarkedInFlight(stream) -> boolean
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
  const { stream } = writer.state;
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
