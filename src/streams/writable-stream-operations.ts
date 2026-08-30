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

export function writableStreamAbort(
  stream: WritableStreamImpl,
  reason: unknown,
): StreamPromise {
  const { context, state } = stream;
  if (isWritableStreamFinished(state)) {
    return context.createResolvedPromise(undefined, idlType.undefined);
  }

  requireController(state).state.abortController.abort(reason);
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
  const { context, state } = stream;
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
      state.writer.state.readyPromise,
      undefined,
    );
  }
  writableStreamDefaultControllerClose(requireController(state));
  return promise;
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
  const { context } = writer;
  if (isWritableStreamLocked(stream)) {
    throw new context.realm.intrinsics.typeError(
      'This stream has already been locked for exclusive writing',
    );
  }

  const streamState = stream.state;
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

  writer.state = {
    closedPromise,
    readyPromise,
    stream,
  };
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
  const { context, state: streamState } = stream;
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

  const { context } = writer;
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
  const { context, state: streamState } = stream;
  const controller = requireController(streamState);
  const chunkSize = writableStreamDefaultControllerGetChunkSize(
    controller,
    chunk,
  );

  if (stream !== writer.state.stream) {
    return context.createRejectedPromise(
      new context.realm.intrinsics.typeError(
        'Cannot write using a released writer',
      ),
      idlType.undefined,
    );
  }
  if (streamState.state === 'errored') {
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
  if (streamState.state === 'erroring') {
    return context.createRejectedPromise(
      streamState.storedError,
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
): void {
  const { context } = stream;
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

export function setUpWritableStreamDefaultController(
  stream: WritableStreamImpl,
  controller: WritableStreamDefaultControllerImpl,
  startAlgorithm: () => unknown,
  writeAlgorithm: (chunk: unknown) => StreamPromise,
  closeAlgorithm: () => StreamPromise,
  abortAlgorithm: (reason: unknown) => StreamPromise,
  highWaterMark: number,
  sizeAlgorithm: QueuingStrategySize,
): void {
  const streamState = stream.state;
  if (streamState.controller) {
    throw new Error('WritableStream already has a controller');
  }
  const { context } = stream;
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
  controller.state = state;
  streamState.controller = controller;

  writableStreamUpdateBackpressure(
    stream,
    writableStreamDefaultControllerGetBackpressure(controller),
  );
  const startPromise = context.createResolvedPromise(
    startAlgorithm(),
    idlType.any,
  );
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
    controllerState.stream.context.realm.intrinsics.rangeError,
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
  stream.context.reactToPromise(
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
  stream.context.reactToPromise(
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
  const controllerState = controller.state;
  try {
    enqueueValueWithSize(
      controllerState,
      chunk,
      chunkSize,
      controllerState.stream.context.realm.intrinsics.rangeError,
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

  const { context } = stream;
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
  const { context, state } = stream;
  const request = state.inFlightCloseRequest;
  if (!request) throw new Error('Writable stream has no in-flight close');
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
      state.writer.state.closedPromise,
      undefined,
    );
  }
}

function writableStreamDefaultControllerAbortSteps(
  controller: WritableStreamDefaultControllerImpl,
  reason: unknown,
): StreamPromise {
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
  const { context, state } = stream;
  const request = state.inFlightCloseRequest;
  if (!request) throw new Error('Writable stream has no in-flight close');
  context.rejectPromise(request, error);
  state.inFlightCloseRequest = undefined;
  if (state.pendingAbortRequest) {
    context.rejectPromise(state.pendingAbortRequest.promise, error);
    state.pendingAbortRequest = undefined;
  }
  writableStreamDealWithRejection(stream, error);
}

function writableStreamFinishInFlightWrite(stream: WritableStreamImpl): void {
  const { context, state } = stream;
  const request = state.inFlightWriteRequest;
  if (!request) throw new Error('Writable stream has no in-flight write');
  context.resolvePromise(request, undefined);
  state.inFlightWriteRequest = undefined;
}

function writableStreamFinishInFlightWriteWithError(
  stream: WritableStreamImpl,
  error: unknown,
): void {
  const { context, state } = stream;
  const request = state.inFlightWriteRequest;
  if (!request) throw new Error('Writable stream has no in-flight write');
  context.rejectPromise(request, error);
  state.inFlightWriteRequest = undefined;
  writableStreamDealWithRejection(stream, error);
}

function writableStreamRejectCloseAndClosedPromiseIfNeeded(
  stream: WritableStreamImpl,
): void {
  const { context, state } = stream;
  if (state.closeRequest) {
    context.rejectPromise(state.closeRequest, state.storedError);
    state.closeRequest = undefined;
  }
  if (state.writer) {
    const { closedPromise } = state.writer.state;
    context.rejectPromise(closedPromise, state.storedError);
    context.markPromiseHandled(closedPromise);
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
  const { context, state } = stream;
  if (state.writer && backpressure !== state.backpressure) {
    const writerState = state.writer.state;
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
  const { context, state } = writer;
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
  const { context, state } = writer;
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
