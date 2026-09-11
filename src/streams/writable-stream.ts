import type {
  AbortControllerCapability, AbortSignalCapability, RuntimeContext,
} from '../js-engine/runtime-context';
import type { PromiseValue, PromiseValueCapability, Promises } from '../js-engine/promises';
import {
  arg, atArg, callback, callbackDictionary, ctor, defineCallbackFunction, defineDictionary,
  defineInterface, dictMember, emptyDictionary, idlType, impl, nullable, op, promise,
  roAttr, reference, xattr,
} from '../web-idl/declaration/index';
import { RangeError, TypeError } from '../js-engine/simple-exception';
import { runtimeContext } from '../web-idl/projection';
import {
  extractHighWaterMark, extractSizeAlgorithm,
  type QueuingStrategyRecord, type QueuingStrategySize,
} from './queuing-strategy';
import { QueueWithSizes } from './queue-with-sizes';

// =============================================================================
// WritableStream
// =============================================================================

/*
 * [Exposed=*, Transferable]
 * interface WritableStream {
 *   constructor(optional object underlyingSink, optional QueuingStrategy strategy = {});
 *
 *   readonly attribute boolean locked;
 *
 *   Promise<undefined> abort(optional any reason);
 *   Promise<undefined> close();
 *   WritableStreamDefaultWriter getWriter();
 * };
 */
export class WritableStreamImpl {
  readonly state: WritableStreamState = {
    backpressure: false,
    state: 'writable',
    writeRequests: [],
  };

  /**
   * Streams §5.2.4, WritableStream(underlyingSink, strategy).
   * Internal null-sink construction leaves controller setup to the caller.
   */
  constructor(
    underlyingSink: UnderlyingSink | null = {},
    strategy: QueuingStrategyRecord = {},
    readonly runtime: RuntimeContext,
  ) {
    if (underlyingSink === null) return;
    if (underlyingSink.type !== undefined) {
      throw new RangeError(
        'Writable stream sinks cannot specify a type',
      );
    }

    const sizeAlgorithm = extractSizeAlgorithm(strategy);
    const highWaterMark = extractHighWaterMark(strategy, 1);
    const controller = new WritableStreamDefaultControllerImpl();
    controller.setUpFromUnderlyingSink(
      this,
      underlyingSink,
      highWaterMark,
      sizeAlgorithm,
    );
  }

  /** Streams §5.5.1, CreateWritableStream. */
  static create(
    startAlgorithm: () => unknown,
    writeAlgorithm: (chunk: unknown) => PromiseValue<unknown>,
    closeAlgorithm: () => PromiseValue<unknown>,
    abortAlgorithm: (reason: unknown) => PromiseValue<unknown>,
    highWaterMark: number,
    sizeAlgorithm: QueuingStrategySize,
    runtime: RuntimeContext,
  ): WritableStreamImpl {
    const stream = new WritableStreamImpl(null, {}, runtime);
    const controller = new WritableStreamDefaultControllerImpl();
    controller.setUp(
      stream,
      startAlgorithm,
      writeAlgorithm,
      closeAlgorithm,
      abortAlgorithm,
      highWaterMark,
      sizeAlgorithm,
    );
    return stream;
  }

  /** Streams §9.2.1, set up a WritableStream; also allocates the stream. */
  static createDefault(
    // Normalize synchronous completion to a promise; see whatwg/streams#1253.
    writeAlgorithm: (chunk: unknown) => PromiseValue<unknown> | void,
    closeAlgorithm: (() => PromiseValue<unknown> | void) | undefined,
    abortAlgorithm: ((reason: unknown) => PromiseValue<unknown> | void) | undefined,
    highWaterMark = 1,
    sizeAlgorithm: QueuingStrategySize = () => 1,
    runtime: RuntimeContext,
  ): WritableStreamImpl {
    return WritableStreamImpl.create(
      () => undefined,
      (chunk) => runtime.promises.try(() => writeAlgorithm(chunk)),
      () => runtime.promises.try(() => closeAlgorithm?.()),
      (reason) => runtime.promises.try(() => abortAlgorithm?.(reason)),
      highWaterMark,
      sizeAlgorithm,
      runtime,
    );
  }

  /** IsWritableStreamLocked. */
  get locked(): boolean {
    return this.state.writer !== undefined;
  }

  /** Streams §5.2.4, abort(reason). */
  abort(reason?: unknown): PromiseValue<void> {
    if (this.locked) {
      return this.runtime.promises.reject(new TypeError(
        'Cannot abort a stream that already has a writer',
      ));
    }
    return this.abortInternal(reason);
  }

  /** Streams §5.2.4, close(). */
  close(): PromiseValue<void> {
    if (this.locked) {
      return this.runtime.promises.reject(new TypeError(
        'Cannot close a stream that already has a writer',
      ));
    }
    if (this.closeQueuedOrInFlight) {
      return this.runtime.promises.reject(new TypeError(
        'Cannot close an already-closing stream',
      ));
    }
    return this.closeInternal();
  }

  /** AcquireWritableStreamDefaultWriter. */
  getWriter(): WritableStreamDefaultWriterImpl {
    return new WritableStreamDefaultWriterImpl(this);
  }

  // -- Internal algorithms ------------------------------------------------

  /** IsWritableStreamWritable. */
  get isWritable(): boolean {
    return this.state.state === 'writable';
  }

  /** WritableStreamCloseQueuedOrInFlight. */
  get closeQueuedOrInFlight(): boolean {
    const { state } = this;
    return state.closeRequest !== undefined ||
      state.inFlightCloseRequest !== undefined;
  }

  /** Streams §9.2, get a specification-created writable stream's signal. */
  get signal(): AbortSignalCapability {
    return this.controller.signal;
  }

  /** WritableStreamHasOperationMarkedInFlight. */
  get hasOperationInFlight(): boolean {
    return this.state.inFlightWriteRequest !== undefined ||
      this.state.inFlightCloseRequest !== undefined;
  }

  #isFinished(): boolean {
    return this.state.state === 'closed' || this.state.state === 'errored';
  }

  get controller(): WritableStreamDefaultControllerImpl {
    const controller = this.state.controller;
    if (!controller) throw new Error('WritableStream has no controller');
    return controller;
  }

  /** Streams §5.5.2, WritableStreamAbort. */
  abortInternal(reason: unknown): PromiseValue<void> {
    const { state } = this;
    if (this.#isFinished()) {
      return this.runtime.promises.resolve(undefined);
    }

    this.controller.state.abortController.abort(reason);
    if (this.#isFinished()) {
      return this.runtime.promises.resolve(undefined);
    }
    if (state.pendingAbortRequest) return state.pendingAbortRequest.promise.promise;

    const wasAlreadyErroring = state.state === 'erroring';
    const promise = this.runtime.promises.withResolvers<void>();
    state.pendingAbortRequest = {
      promise,
      reason: wasAlreadyErroring ? undefined : reason,
      wasAlreadyErroring,
    };
    if (!wasAlreadyErroring) this.startErroring(reason);
    return promise.promise;
  }

  /** Streams §5.5.2, WritableStreamClose. */
  closeInternal(): PromiseValue<void> {
    const { state } = this;
    if (state.state === 'closed' || state.state === 'errored') {
      return this.runtime.promises.reject(new TypeError(
        `A stream in the ${state.state} state cannot be closed`,
      ));
    }
    if (this.closeQueuedOrInFlight) {
      throw new Error('Writable stream already has a close operation');
    }

    const promise = this.runtime.promises.withResolvers<void>();
    state.closeRequest = promise;
    if (state.writer && state.backpressure && state.state === 'writable') {
      state.writer.state.readyPromise.resolve();
    }
    this.controller.close();
    return promise.promise;
  }

  /** WritableStreamDealWithRejection. */
  dealWithRejection(error: unknown): void {
    if (this.state.state === 'writable') {
      this.startErroring(error);
    } else {
      this.finishErroring();
    }
  }

  /** WritableStreamFinishErroring. */
  finishErroring(): void {
    const { state } = this;
    if (state.state !== 'erroring' || this.hasOperationInFlight) {
      throw new Error('Writable stream cannot finish erroring yet');
    }
    state.state = 'errored';
    this.controller.errorSteps();

    for (const request of state.writeRequests) {
      request.reject(state.storedError);
    }
    state.writeRequests = [];

    const abortRequest = state.pendingAbortRequest;
    if (!abortRequest) {
      this.rejectCloseAndClosedPromiseIfNeeded();
      return;
    }
    state.pendingAbortRequest = undefined;
    if (abortRequest.wasAlreadyErroring) {
      abortRequest.promise.reject(state.storedError);
      this.rejectCloseAndClosedPromiseIfNeeded();
      return;
    }

    const abortPromise = this.controller.abortSteps(abortRequest.reason);
    void abortPromise.then(() => {
      abortRequest.promise.resolve(undefined);
      this.rejectCloseAndClosedPromiseIfNeeded();
    }, (reason) => {
      abortRequest.promise.reject(reason);
      this.rejectCloseAndClosedPromiseIfNeeded();
    });
  }

  /** WritableStreamFinishInFlightClose. */
  finishInFlightClose(): void {
    const { state } = this;
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
    }
  }

  /** WritableStreamFinishInFlightCloseWithError. */
  finishInFlightCloseWithError(error: unknown): void {
    const { state } = this;
    const request = state.inFlightCloseRequest;
    if (!request) throw new Error('Writable stream has no in-flight close');
    request.reject(error);
    state.inFlightCloseRequest = undefined;
    if (state.pendingAbortRequest) {
      state.pendingAbortRequest.promise.reject(error);
      state.pendingAbortRequest = undefined;
    }
    this.dealWithRejection(error);
  }

  /** WritableStreamFinishInFlightWrite. */
  finishInFlightWrite(): void {
    const { state } = this;
    const request = state.inFlightWriteRequest;
    if (!request) throw new Error('Writable stream has no in-flight write');
    request.resolve(undefined);
    state.inFlightWriteRequest = undefined;
  }

  /** WritableStreamFinishInFlightWriteWithError. */
  finishInFlightWriteWithError(error: unknown): void {
    const { state } = this;
    const request = state.inFlightWriteRequest;
    if (!request) throw new Error('Writable stream has no in-flight write');
    request.reject(error);
    state.inFlightWriteRequest = undefined;
    this.dealWithRejection(error);
  }

  /** WritableStreamRejectCloseAndClosedPromiseIfNeeded. */
  rejectCloseAndClosedPromiseIfNeeded(): void {
    const { state } = this;
    if (state.closeRequest) {
      state.closeRequest.reject(state.storedError);
      state.closeRequest = undefined;
    }
    if (state.writer) {
      const { closedPromise } = state.writer.state;
      closedPromise.reject(state.storedError);
      void closedPromise.promise.then(undefined, () => {});
    }
  }

  /** WritableStreamStartErroring. */
  startErroring(reason: unknown): void {
    const { state } = this;
    if (state.state !== 'writable') {
      throw new Error('Only a writable stream can start erroring');
    }
    state.state = 'erroring';
    state.storedError = reason;
    if (state.writer) {
      state.writer.ensureReadyPromiseRejected(reason);
    }
    if (!this.hasOperationInFlight &&
      this.controller.state.started) {
      this.finishErroring();
    }
  }

  /** WritableStreamUpdateBackpressure. */
  updateBackpressure(backpressure: boolean): void {
    const { state } = this;
    if (state.writer && backpressure !== state.backpressure) {
      const writerState = state.writer.state;
      if (backpressure) {
        writerState.readyPromise = this.runtime.promises.withResolvers<void>();
      } else {
        writerState.readyPromise.resolve();
      }
    }
    state.backpressure = backpressure;
  }

  /** Streams §9.2, error a specification-created writable stream. */
  error(error: unknown): void {
    this.controller.error(error);
  }
}

type WritableStreamState = {
  backpressure: boolean;
  closeRequest?: PromiseValueCapability<void>;
  controller?: WritableStreamDefaultControllerImpl;
  inFlightCloseRequest?: PromiseValueCapability<void>;
  inFlightWriteRequest?: PromiseValueCapability<void>;
  pendingAbortRequest?: WritableStreamPendingAbortRequest;
  state: 'closed' | 'errored' | 'erroring' | 'writable';
  storedError?: unknown;
  writer?: WritableStreamDefaultWriterImpl;
  writeRequests: PromiseValueCapability<void>[];
};

type WritableStreamPendingAbortRequest = {
  readonly promise: PromiseValueCapability<void>;
  readonly reason: unknown;
  readonly wasAlreadyErroring: boolean;
};

/*
 * dictionary UnderlyingSink {
 *   UnderlyingSinkStartCallback start;
 *   UnderlyingSinkWriteCallback write;
 *   UnderlyingSinkCloseCallback close;
 *   UnderlyingSinkAbortCallback abort;
 *   any type;
 * };
 */
export type UnderlyingSink = {
  readonly abort?: (reason?: unknown) => PromiseValue<unknown> | void;
  readonly close?: () => PromiseValue<unknown> | void;
  readonly start?: (controller: WritableStreamDefaultControllerImpl) => unknown;
  readonly type?: unknown;
  readonly write?: (
    chunk: unknown,
    controller: WritableStreamDefaultControllerImpl,
  ) => PromiseValue<unknown> | void;
};

// -- Web IDL ------------------------------------------------------------

export const writableStreamIDL = defineInterface({
  name: 'WritableStream',
  exposed: '*',
  ...xattr('Transferable'),
  implementation: impl(WritableStreamImpl, {
    constructWith: [
      atArg(2, runtimeContext),
    ],
  }),
  members: [
    ctor([
      arg('underlyingSink', idlType.object, {
        optional: true,
        ...callbackDictionary('UnderlyingSink'),
      }),
      arg('strategy', reference('QueuingStrategy'), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
    roAttr('locked', idlType.boolean),
    op('abort', promise(idlType.undefined), [
      arg('reason', idlType.any, { optional: true }),
    ]),
    op('close', promise(idlType.undefined)),
    op('getWriter', reference('WritableStreamDefaultWriter')),
  ],
});

/*
 * callback UnderlyingSinkStartCallback = any (WritableStreamDefaultController controller);
 */
export const underlyingSinkStartCallbackIDL = defineCallbackFunction({
  name: 'UnderlyingSinkStartCallback',
  returns: idlType.any,
  arguments: [
    arg('controller', reference('WritableStreamDefaultController')),
  ],
});

/*
 * callback UnderlyingSinkWriteCallback = Promise<undefined> (any chunk, WritableStreamDefaultController controller);
 */
export const underlyingSinkWriteCallbackIDL = defineCallbackFunction({
  name: 'UnderlyingSinkWriteCallback',
  returns: promise(idlType.undefined),
  arguments: [
    arg('chunk', idlType.any),
    arg('controller', reference('WritableStreamDefaultController')),
  ],
});

/*
 * callback UnderlyingSinkCloseCallback = Promise<undefined> ();
 */
export const underlyingSinkCloseCallbackIDL = defineCallbackFunction({
  name: 'UnderlyingSinkCloseCallback',
  returns: promise(idlType.undefined),
  arguments: [],
});

/*
 * callback UnderlyingSinkAbortCallback = Promise<undefined> (optional any reason);
 */
export const underlyingSinkAbortCallbackIDL = defineCallbackFunction({
  name: 'UnderlyingSinkAbortCallback',
  returns: promise(idlType.undefined),
  arguments: [arg('reason', idlType.any, { optional: true })],
});

export const underlyingSinkIDL = defineDictionary({
  name: 'UnderlyingSink',
  members: [
    dictMember('start', reference('UnderlyingSinkStartCallback'),
      callback('rethrow')),
    dictMember('write', reference('UnderlyingSinkWriteCallback')),
    dictMember('close', reference('UnderlyingSinkCloseCallback')),
    dictMember('abort', reference('UnderlyingSinkAbortCallback')),
    dictMember('type', idlType.any),
  ],
});

// =============================================================================
// WritableStreamDefaultController
// =============================================================================

/*
 * [Exposed=*]
 * interface WritableStreamDefaultController {
 *   readonly attribute AbortSignal signal;
 *   undefined error(optional any e);
 * };
 */
export class WritableStreamDefaultControllerImpl {
  state!: WritableStreamDefaultControllerState;

  get signal(): AbortSignalCapability {
    return this.state.abortController.signal;
  }

  /** WritableStreamDefaultControllerErrorIfNeeded. */
  error(error?: unknown): void {
    const { stream } = this.state;
    if (stream.state.state === 'writable') {
      this.errorInternal(error);
    }
  }

  // -- Internal algorithms ------------------------------------------------

  /** WritableStreamDefaultControllerGetBackpressure. */
  get backpressure(): boolean {
    return this.desiredSize <= 0;
  }

  /** WritableStreamDefaultControllerGetDesiredSize. */
  get desiredSize(): number {
    const { state } = this;
    return state.strategyHighWaterMark - state.queue.totalSize;
  }

  /** Streams §5.5.4, SetUpWritableStreamDefaultControllerFromUnderlyingSink. */
  setUpFromUnderlyingSink(
    stream: WritableStreamImpl,
    sink: UnderlyingSink,
    highWaterMark: number,
    sizeAlgorithm: QueuingStrategySize,
  ): void {
    const { start, write, close, abort } = sink;
    const startAlgorithm = () => start && Reflect.apply(start, sink, [this]);
    const writeAlgorithm = (chunk: unknown) => stream.runtime.promises.try(() => write?.call(sink, chunk, this));
    const closeAlgorithm = () => stream.runtime.promises.try(() => close?.call(sink));
    const abortAlgorithm = (reason: unknown) => stream.runtime.promises.try(() => abort?.call(sink, reason));

    this.setUp(
      stream,
      startAlgorithm,
      writeAlgorithm,
      closeAlgorithm,
      abortAlgorithm,
      highWaterMark,
      sizeAlgorithm,
    );
  }

  /** WritableStreamDefaultControllerClearAlgorithms. */
  clearAlgorithms(): void {
    const { state } = this;
    state.writeAlgorithm = undefined;
    state.closeAlgorithm = undefined;
    state.abortAlgorithm = undefined;
    state.strategySizeAlgorithm = undefined;
  }

  /** WritableStreamDefaultControllerError. */
  errorInternal(error: unknown): void {
    const { state } = this;
    if (state.stream.state.state !== 'writable') {
      throw new Error('Only a writable stream can start erroring');
    }
    this.clearAlgorithms();
    state.stream.startErroring(error);
  }

  /** Streams §5.5.4, SetUpWritableStreamDefaultController. */
  setUp(
    stream: WritableStreamImpl,
    startAlgorithm: () => unknown,
    writeAlgorithm: (chunk: unknown) => PromiseValue<unknown>,
    closeAlgorithm: () => PromiseValue<unknown>,
    abortAlgorithm: (reason: unknown) => PromiseValue<unknown>,
    highWaterMark: number,
    sizeAlgorithm: QueuingStrategySize,
  ): void {
    const streamState = stream.state;
    if (streamState.controller) {
      throw new Error('WritableStream already has a controller');
    }
    const state: WritableStreamDefaultControllerState = {
      abortAlgorithm,
      abortController: stream.runtime.createAbortController(),
      closeAlgorithm,
      queue: new QueueWithSizes(),
      started: false,
      strategyHighWaterMark: highWaterMark,
      strategySizeAlgorithm: sizeAlgorithm,
      stream,
      writeAlgorithm,
    };
    this.state = state;
    streamState.controller = this;

    stream.updateBackpressure(this.backpressure);
    const startPromise = stream.runtime.promises.resolve(startAlgorithm());
    void startPromise.then(() => {
      state.started = true;
      this.advanceQueueIfNeeded();
    }, (reason) => {
      state.started = true;
      stream.dealWithRejection(reason);
    });
  }

  /** WritableStreamDefaultControllerAdvanceQueueIfNeeded. */
  advanceQueueIfNeeded(): void {
    const controllerState = this.state;
    if (!controllerState.started) return;

    const stream = controllerState.stream;
    const streamState = stream.state;
    if (streamState.inFlightWriteRequest) return;
    if (streamState.state === 'erroring') {
      stream.finishErroring();
      return;
    }
    if (controllerState.queue.length === 0) return;

    const value = controllerState.queue.peek();
    if (value === closeSentinel) {
      this.processClose();
    } else {
      this.processWrite(value);
    }
  }

  /** WritableStreamDefaultControllerClose. */
  close(): void {
    const controllerState = this.state;
    controllerState.queue.enqueue(closeSentinel, 0);
    this.advanceQueueIfNeeded();
  }

  /** WritableStreamDefaultControllerGetChunkSize. */
  getChunkSize(chunk: unknown): number {
    const { state } = this;
    if (!state.strategySizeAlgorithm) return 1;
    try {
      return state.strategySizeAlgorithm(chunk);
    } catch (error) {
      this.error(error);
      return 1;
    }
  }

  /** WritableStreamDefaultControllerProcessClose. */
  processClose(): void {
    const controllerState = this.state;
    const stream = controllerState.stream;
    const streamState = stream.state;
    if (!streamState.closeRequest || streamState.inFlightCloseRequest) {
      throw new Error('Writable stream has no pending close request');
    }
    streamState.inFlightCloseRequest = streamState.closeRequest;
    streamState.closeRequest = undefined;
    controllerState.queue.dequeue();
    if (controllerState.queue.length !== 0) {
      throw new Error('Writable stream close sentinel was not last');
    }

    const closePromise = requireAlgorithm(
      controllerState.closeAlgorithm,
      'close',
    )();
    this.clearAlgorithms();
    void closePromise.then(() => stream.finishInFlightClose(), (reason) =>
      stream.finishInFlightCloseWithError(reason));
  }

  /** WritableStreamDefaultControllerProcessWrite. */
  processWrite(chunk: unknown): void {
    const controllerState = this.state;
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
    void writePromise.then(() => {
      stream.finishInFlightWrite();
      controllerState.queue.dequeue();
      if (!stream.closeQueuedOrInFlight &&
        streamState.state === 'writable') {
        stream.updateBackpressure(this.backpressure);
      }
      this.advanceQueueIfNeeded();
    }, (reason) => {
      if (streamState.state === 'writable') {
        this.clearAlgorithms();
      }
      stream.finishInFlightWriteWithError(reason);
    });
  }

  /** WritableStreamDefaultControllerWrite. */
  write(chunk: unknown, chunkSize: number): void {
    const controllerState = this.state;
    try {
      controllerState.queue.enqueue(chunk, chunkSize);
    } catch (error) {
      this.error(error);
      return;
    }

    const stream = controllerState.stream;
    const streamState = stream.state;
    if (!stream.closeQueuedOrInFlight &&
      streamState.state === 'writable') {
      stream.updateBackpressure(this.backpressure);
    }
    this.advanceQueueIfNeeded();
  }

  /** WritableStreamDefaultControllerAbortSteps. */
  abortSteps(reason: unknown): PromiseValue<unknown> {
    const { state } = this;
    const promise = requireAlgorithm(state.abortAlgorithm, 'abort')(reason);
    this.clearAlgorithms();
    return promise;
  }

  /** WritableStreamDefaultControllerErrorSteps. */
  errorSteps(): void {
    const { state } = this;
    state.queue.reset();
  }
}

type WritableStreamDefaultControllerState = {
  readonly queue: QueueWithSizes<unknown>;
  abortAlgorithm?: (reason: unknown) => PromiseValue<unknown>;
  abortController: AbortControllerCapability;
  closeAlgorithm?: () => PromiseValue<unknown>;
  started: boolean;
  strategyHighWaterMark: number;
  strategySizeAlgorithm?: QueuingStrategySize;
  stream: WritableStreamImpl;
  writeAlgorithm?: (chunk: unknown) => PromiseValue<unknown>;
};

// -- Web IDL ------------------------------------------------------------

export const writableStreamDefaultControllerIDL = defineInterface({
  name: 'WritableStreamDefaultController',
  exposed: '*',
  implementation: impl(WritableStreamDefaultControllerImpl),
  members: [
    roAttr('signal', reference('AbortSignal')),
    op('error', idlType.undefined, [
      arg('e', idlType.any, { optional: true }),
    ]),
  ],
});

// =============================================================================
// WritableStreamDefaultWriter
// =============================================================================

/*
 * [Exposed=*]
 * interface WritableStreamDefaultWriter {
 *   constructor(WritableStream stream);
 *
 *   readonly attribute Promise<undefined> closed;
 *   readonly attribute unrestricted double? desiredSize;
 *   readonly attribute Promise<undefined> ready;
 *
 *   Promise<undefined> abort(optional any reason);
 *   Promise<undefined> close();
 *   undefined releaseLock();
 *   Promise<undefined> write(optional any chunk);
 * };
 */
export class WritableStreamDefaultWriterImpl {
  state!: WritableStreamDefaultWriterState;

  /**
   * Streams §5.3.3, WritableStreamDefaultWriter(stream).
   * Internal allocation may omit the stream and call setUp separately.
   */
  constructor(
    stream?: WritableStreamImpl,
  ) {
    if (stream) this.setUp(stream);
  }

  /** Streams §5.3.3, closed getter. */
  get closed(): PromiseValue<void> {
    return this.state.closedPromise.promise;
  }

  get desiredSize(): number | null {
    if (!this.state.stream) {
      throw defaultWriterLockException('get the desired size of');
    }
    return this.getDesiredSize();
  }

  /** Streams §5.3.3, ready getter. */
  get ready(): PromiseValue<void> {
    return this.state.readyPromise.promise;
  }

  /** Streams §5.3.3, abort(reason). */
  abort(reason?: unknown): PromiseValue<void> {
    if (!this.state.stream) {
      return this.state.promises.reject(defaultWriterLockException('abort'));
    }
    return this.abortInternal(reason);
  }

  /** Streams §5.3.3, close(). */
  close(): PromiseValue<void> {
    const stream = this.state.stream;
    if (!stream) {
      return this.state.promises.reject(defaultWriterLockException('close'));
    }
    if (stream.closeQueuedOrInFlight) {
      return this.state.promises.reject(new TypeError(
        'Cannot close an already-closing stream',
      ));
    }
    return this.closeInternal();
  }

  releaseLock(): void {
    if (!this.state.stream) return;
    this.release();
  }

  /** Streams §5.3.3, write(chunk). */
  write(chunk?: unknown): PromiseValue<void> {
    if (!this.state.stream) {
      return this.state.promises.reject(defaultWriterLockException('write to'));
    }
    return this.writeInternal(chunk);
  }

  // -- Internal algorithms ------------------------------------------------

  /** RequireWriterStream. */
  get stream(): WritableStreamImpl {
    const { stream } = this.state;
    if (!stream) throw new Error('WritableStream writer has been released');
    return stream;
  }

  /** SetUpWritableStreamDefaultWriter. */
  setUp(stream: WritableStreamImpl): void {
    if (stream.locked) {
      throw new TypeError(
        'This stream has already been locked for exclusive writing',
      );
    }

    const streamState = stream.state;
    const readyPromise = stream.runtime.promises.withResolvers<void>();
    const closedPromise = stream.runtime.promises.withResolvers<void>();
    if (streamState.state === 'writable' || streamState.state === 'closed') {
      if (streamState.state === 'closed' ||
        stream.closeQueuedOrInFlight || !streamState.backpressure) {
        readyPromise.resolve();
      }
    } else {
      readyPromise.reject(streamState.storedError);
      void readyPromise.promise.then(undefined, () => {});
    }
    if (streamState.state === 'closed') closedPromise.resolve();
    if (streamState.state === 'errored') {
      closedPromise.reject(streamState.storedError);
      void closedPromise.promise.then(undefined, () => {});
    }
    this.state = { closedPromise, readyPromise, stream, promises: stream.runtime.promises };
    streamState.writer = this;
  }

  /** Streams §5.5.3, WritableStreamDefaultWriterAbort. */
  abortInternal(reason: unknown): PromiseValue<void> {
    return this.stream.abortInternal(reason);
  }

  /** Streams §5.5.3, WritableStreamDefaultWriterClose. */
  closeInternal(): PromiseValue<void> {
    return this.stream.closeInternal();
  }

  /** Streams §5.5.3, WritableStreamDefaultWriterCloseWithErrorPropagation. */
  closeWithErrorPropagation(): PromiseValue<void> {
    const stream = this.stream;
    const { state: streamState } = stream;
    if (stream.closeQueuedOrInFlight ||
      streamState.state === 'closed') {
      return this.state.promises.resolve(undefined);
    }
    if (streamState.state === 'errored') {
      return this.state.promises.reject(streamState.storedError);
    }
    return this.closeInternal();
  }

  /** WritableStreamDefaultWriterGetDesiredSize. */
  getDesiredSize(): number | null {
    const stream = this.stream;
    const { state } = stream;
    if (state.state === 'errored' || state.state === 'erroring') return null;
    if (state.state === 'closed') return 0;
    return stream.controller.desiredSize;
  }

  /** WritableStreamDefaultWriterRelease. */
  release(): void {
    const writerState = this.state;
    const stream = this.stream;
    const streamState = stream.state;
    if (streamState.writer !== this) {
      throw new Error('Writable stream is locked by another writer');
    }

    const releasedError = new TypeError(
      'Writer was released and can no longer monitor the stream',
    );
    this.ensureReadyPromiseRejected(releasedError);
    this.ensureClosedPromiseRejected(releasedError);
    streamState.writer = undefined;
    writerState.stream = undefined;
  }

  /** Streams §5.5.3, WritableStreamDefaultWriterWrite. */
  writeInternal(chunk: unknown): PromiseValue<void> {
    const stream = this.stream;
    const { state: streamState } = stream;
    const controller = stream.controller;
    const chunkSize = controller.getChunkSize(chunk);

    if (stream !== this.state.stream) {
      return this.state.promises.reject(new TypeError(
        'Cannot write using a released writer',
      ));
    }
    if (streamState.state === 'errored') {
      return this.state.promises.reject(streamState.storedError);
    }
    if (stream.closeQueuedOrInFlight ||
      streamState.state === 'closed') {
      return this.state.promises.reject(new TypeError(
        'The stream is closing or closed',
      ));
    }
    if (streamState.state === 'erroring') {
      return this.state.promises.reject(streamState.storedError);
    }

    const promise = this.state.promises.withResolvers<void>();
    streamState.writeRequests.push(promise);
    controller.write(chunk, chunkSize);
    return promise.promise;
  }

  /** WritableStreamDefaultWriterEnsureClosedPromiseRejected. */
  ensureClosedPromiseRejected(error: unknown): void {
    const { state } = this;
    if (!state.closedPromise.pending) state.closedPromise = state.promises.withResolvers<void>();
    state.closedPromise.reject(error);
    void state.closedPromise.promise.then(undefined, () => {});
  }

  /** WritableStreamDefaultWriterEnsureReadyPromiseRejected. */
  ensureReadyPromiseRejected(error: unknown): void {
    const { state } = this;
    if (!state.readyPromise.pending) state.readyPromise = state.promises.withResolvers<void>();
    state.readyPromise.reject(error);
    void state.readyPromise.promise.then(undefined, () => {});
  }
}

type WritableStreamDefaultWriterState = {
  readonly promises: Promises;
  closedPromise: PromiseValueCapability<void>;
  readyPromise: PromiseValueCapability<void>;
  stream?: WritableStreamImpl;
};

// -- Web IDL ------------------------------------------------------------

export const writableStreamDefaultWriterIDL = defineInterface({
  name: 'WritableStreamDefaultWriter',
  exposed: '*',
  implementation: impl(WritableStreamDefaultWriterImpl),
  members: [
    ctor([arg('stream', reference('WritableStream'))]),
    roAttr('closed', promise(idlType.undefined)),
    roAttr('desiredSize', nullable(idlType.unrestrictedDouble)),
    roAttr('ready', promise(idlType.undefined)),
    op('abort', promise(idlType.undefined), [
      arg('reason', idlType.any, { optional: true }),
    ]),
    op('close', promise(idlType.undefined)),
    op('releaseLock', idlType.undefined),
    op('write', promise(idlType.undefined), [
      arg('chunk', idlType.any, { optional: true }),
    ]),
  ],
});

// =============================================================================
// Internal records
// =============================================================================

const closeSentinel = Symbol('WritableStream close sentinel');

// =============================================================================
// Shared helpers
// =============================================================================

function defaultWriterLockException(
  operation: string,
): TypeError {
  return new TypeError(
    `Cannot ${operation} a stream using a released writer`,
  );
}

function requireAlgorithm<Algorithm>(
  algorithm: Algorithm | undefined,
  name: string,
): Algorithm {
  if (!algorithm) throw new Error(`Writable stream ${name} algorithm is gone`);
  return algorithm;
}
