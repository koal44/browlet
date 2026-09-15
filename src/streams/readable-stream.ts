import type {
  AbortAlgorithmHandle, AbortSignalCapability, RuntimeContext,
} from '../js-engine/runtime-context';
import type { PromiseValue, PromiseValueCapability, Promises } from '../js-engine/promises';
import {
  arg, atArg, asyncIter, asyncSequence, onError, cbDict, ctor,
  defineCallbackFunction, defineDictionary, defineEnumeration, defineInterface, defineTypedef,
  dictMember, emptyDictionary, idlType, impl, invokeWith, op, promise, roAttr, reference,
  sequence, staticOp, union, xattr, nullable, defineInterfaceMixin, defineIncludes, integer,
  endOfIteration, type AsyncSequenceValue,
} from '../web-idl/index';
import { RangeError, TypeError } from '../js-engine/exceptions';
import {
  extractHighWaterMark, extractSizeAlgorithm,
  type QueuingStrategyRecord, type QueuingStrategySize,
} from './queuing-strategy';
import type { WritableStreamImpl } from './writable-stream';
import { QueueWithSizes } from './queue-with-sizes';
import {
  getBufferSourceByteLength, getBufferSourceUnderlyingBuffer, type JSBufferViewName,
  getArrayBufferViewElementSize, getBufferTypeName, isBufferSourceDetached,
  getBufferSourceByteOffset, writeArrayBuffer, getBufferSourceCopy, writeArrayBufferView,
} from '../js-engine/index';
import type { TransformStreamImpl } from './transform-stream';

// =============================================================================
// ReadableStream
// =============================================================================

/*
 * [Exposed=*, Transferable]
 * interface ReadableStream {
 *   constructor(optional object underlyingSource, optional QueuingStrategy strategy = {});
 *
 *   static ReadableStream from(async_sequence<any> asyncIterable);
 *
 *   readonly attribute boolean locked;
 *
 *   Promise<undefined> cancel(optional any reason);
 *   ReadableStreamReader getReader(optional ReadableStreamGetReaderOptions options = {});
 *   ReadableStream pipeThrough(ReadableWritablePair transform, optional StreamPipeOptions options = {});
 *   Promise<undefined> pipeTo(WritableStream destination, optional StreamPipeOptions options = {});
 *   sequence<ReadableStream> tee();
 *
 *   async_iterable<any>(optional ReadableStreamIteratorOptions options = {});
 * };
 */
export class ReadableStreamImpl {
  readonly #state: ReadableStreamState;

  /**
   * Streams §4.2.4, ReadableStream(underlyingSource, strategy).
   * Internal null-source construction leaves controller setup to the caller.
   */
  constructor(
    underlyingSource: UnderlyingSource | null = {},
    strategy: QueuingStrategyRecord = {},
    readonly runtime: RuntimeContext,
  ) {
    this.#state = { disturbed: false, state: 'readable' };
    if (underlyingSource === null) return;

    if (underlyingSource.type === 'bytes') {
      if (strategy.size !== undefined) {
        throw new RangeError(
          'A byte stream strategy must not provide a size algorithm',
        );
      }
      const highWaterMark = extractHighWaterMark(strategy, 0);
      ReadableByteStreamControllerImpl.setUpFromUnderlyingSource(
        this,
        underlyingSource,
        highWaterMark,
      );
      return;
    }

    const sizeAlgorithm = extractSizeAlgorithm(strategy);
    const highWaterMark = extractHighWaterMark(strategy, 1);
    ReadableStreamDefaultControllerImpl.setUpFromUnderlyingSource(
      this,
      underlyingSource,
      highWaterMark,
      sizeAlgorithm,
    );
  }

  /** Streams §4.9.1, CreateReadableStream. */
  static create(
    startAlgorithm: () => unknown,
    pullAlgorithm: () => PromiseValue<unknown>,
    cancelAlgorithm: (reason: unknown) => PromiseValue<unknown>,
    highWaterMark = 1,
    sizeAlgorithm: QueuingStrategySize = () => 1,
    runtime: RuntimeContext,
  ): ReadableStreamImpl {
    const stream = new ReadableStreamImpl(null, {}, runtime);
    const controller = new ReadableStreamDefaultControllerImpl();
    controller.setUp(
      stream,
      startAlgorithm,
      pullAlgorithm,
      cancelAlgorithm,
      highWaterMark,
      sizeAlgorithm,
    );
    return stream;
  }

  /** Streams §4.9.1, ReadableStreamFromIterable; Binding supplies the opened iterator. */
  static from(
    iterator: AsyncSequenceValue<unknown>,
    runtime: RuntimeContext,
  ): ReadableStreamImpl {
    const { promises } = runtime;
    const stream = ReadableStreamImpl.create(
      () => undefined,
      () => promises.import(iterator.next()).then((result) => {
        const controller = stream.defaultController;
        if (result === endOfIteration) controller.closeInternal();
        else controller.enqueueInternal(result);
      }, (reason: unknown) => {
        stream.defaultController.error(reason);
      }),
      (reason) => promises.import(iterator.return(reason)),
      0,
      () => 1,
      runtime,
    );
    return stream;
  }

  /** Streams §4.9.1, CreateReadableByteStream. */
  static createByteStream(
    startAlgorithm: () => unknown,
    pullAlgorithm: () => PromiseValue<unknown>,
    cancelAlgorithm: (reason: unknown) => PromiseValue<unknown>,
    runtime: RuntimeContext,
  ): ReadableStreamImpl {
    const stream = new ReadableStreamImpl(null, {}, runtime);
    const controller = new ReadableByteStreamControllerImpl();
    controller.setUp(stream, startAlgorithm, pullAlgorithm, cancelAlgorithm, 0, undefined);
    return stream;
  }

  /** Streams §9.1.1, set up with byte reading support; also allocates the stream. */
  static createWithByteReadingSupport(
    pullAlgorithm: (() => PromiseValue<unknown> | void) | undefined,
    // Fetch needs the cancellation reason omitted by Streams' byte-setup wording.
    cancelAlgorithm: ((reason: unknown) => PromiseValue<unknown> | void) | undefined,
    highWaterMark = 0,
    runtime: RuntimeContext,
  ): ReadableStreamImpl {
    const stream = new ReadableStreamImpl(null, {}, runtime);
    const controller = new ReadableByteStreamControllerImpl();
    controller.setUp(
      stream,
      () => undefined,
      () => runtime.promises.try(() => pullAlgorithm?.()),
      (reason) => runtime.promises.try(() => cancelAlgorithm?.(reason)),
      highWaterMark,
      undefined,
    );
    return stream;
  }

  /** Streams §9.1.1, set up a ReadableStream; also allocates the stream. */
  static createDefault(
    pullAlgorithm: (() => PromiseValue<unknown> | void) | undefined,
    cancelAlgorithm: ((reason: unknown) => PromiseValue<unknown> | void) | undefined,
    highWaterMark = 1,
    sizeAlgorithm: QueuingStrategySize = () => 1,
    runtime: RuntimeContext,
  ): ReadableStreamImpl {
    return ReadableStreamImpl.create(
      () => undefined,
      () => runtime.promises.try(() => pullAlgorithm?.()),
      (reason) => runtime.promises.try(() => cancelAlgorithm?.(reason)),
      highWaterMark,
      sizeAlgorithm,
      runtime,
    );
  }

  /** IsReadableStreamLocked. */
  get locked(): boolean {
    return this.state.reader !== undefined;
  }

  /** Streams §4.2.4, cancel(reason). */
  cancel(reason?: unknown): PromiseValue<void> {
    if (this.locked) {
      return this.runtime.promises.reject(new TypeError(
        'Cannot cancel a stream that already has a reader',
      ));
    }
    return this.cancelInternal(reason);
  }

  getReader(
    options: { readonly mode: 'byob'; },
  ): ReadableStreamBYOBReaderImpl;

  getReader(
    options?: { readonly mode?: undefined; },
  ): ReadableStreamDefaultReaderImpl;

  getReader(
    options: ReadableStreamGetReaderOptions = {},
  ): ReadableStreamBYOBReaderImpl | ReadableStreamDefaultReaderImpl {
    return options.mode === 'byob'
      ? this.getBYOBReader()
      : this.getDefaultReader();
  }

  pipeThrough(
    transform: ReadableWritablePair,
    options: StreamPipeOptions,
  ): ReadableStreamImpl {
    if (this.locked) {
      throw new TypeError(
        'ReadableStream.prototype.pipeThrough cannot be used on a locked ReadableStream',
      );
    }
    if (transform.writable.locked) {
      throw new TypeError(
        'ReadableStream.prototype.pipeThrough cannot be used on a locked WritableStream',
      );
    }

    const promise = this.pipeToInternal(
      transform.writable,
      options.preventClose,
      options.preventAbort,
      options.preventCancel,
      options.signal,
    );
    void promise.then(undefined, () => {});
    return transform.readable;
  }

  /** Streams §4.2.4, pipeTo(destination, options). */
  pipeTo(
    destination: WritableStreamImpl,
    options: StreamPipeOptions,
  ): PromiseValue<void> {
    if (this.locked) {
      return this.runtime.promises.reject(new TypeError(
        'ReadableStream.prototype.pipeTo cannot be used on a locked ReadableStream',
      ));
    }
    if (destination.locked) {
      return this.runtime.promises.reject(new TypeError(
        'ReadableStream.prototype.pipeTo cannot be used on a locked WritableStream',
      ));
    }

    return this.pipeToInternal(
      destination,
      options.preventClose,
      options.preventAbort,
      options.preventCancel,
      options.signal,
    );
  }

  tee(): [ReadableStreamImpl, ReadableStreamImpl] {
    return ReadableByteStreamControllerImpl.is(
      this.controller,
    )
      ? this.teeBytes()
      : this.teeDefault(false);
  }

  // -- Internal algorithms ------------------------------------------------

  /** RequireDefaultController. */
  get defaultController(): ReadableStreamDefaultControllerImpl {
    const controller = this.controller;
    if (!ReadableStreamDefaultControllerImpl.is(controller)) {
      throw new Error('ReadableStream has no default controller');
    }
    return controller;
  }

  /** ReadableStreamGetNumReadIntoRequests. */
  get numReadIntoRequests(): number {
    const reader = this.state.reader;
    if (!ReadableStreamBYOBReaderImpl.is(reader)) {
      throw new Error('Readable stream has no BYOB reader');
    }
    return reader.readIntoRequests.length;
  }

  /** ReadableStreamGetNumReadRequests. */
  get numReadRequests(): number {
    const reader = this.state.reader;
    if (!ReadableStreamDefaultReaderImpl.is(reader)) {
      throw new Error('Readable stream has no default reader');
    }
    return reader.readRequests.length;
  }

  /** ReadableStreamHasBYOBReader. */
  get hasBYOBReader(): boolean {
    return ReadableStreamBYOBReaderImpl.is(
      this.state.reader,
    );
  }

  /** ReadableStreamHasDefaultReader. */
  get hasDefaultReader(): boolean {
    return ReadableStreamDefaultReaderImpl.is(
      this.state.reader,
    );
  }

  /** RequireByteController. */
  get byteController(): ReadableByteStreamControllerImpl {
    const controller = this.controller;
    if (!ReadableByteStreamControllerImpl.is(controller)) {
      throw new Error('ReadableStream has no byte controller');
    }
    return controller;
  }

  /** Streams §9.1, get the desired size of a specification-created stream. */
  get desiredSize(): number {
    const state = this.state;
    if (state.state !== 'readable') return 0;
    const controller = this.controller;
    const desiredSize = controller.desiredSize;
    if (desiredSize === null) {
      throw new Error('A readable stream has no desired size');
    }
    return desiredSize;
  }

  /** Streams §9.1, whether a specification-created stream needs more data. */
  get needsMoreData(): boolean {
    return this.desiredSize > 0;
  }

  /** Streams §9.1, get the current BYOB request view. */
  get byobRequestView(): object | null {
    const controller = this.controller;
    if (!ReadableByteStreamControllerImpl.is(controller)) {
      throw new Error('A default readable stream has no BYOB request view');
    }
    return controller.byobRequest?.view ?? null;
  }

  /** IsReadableStreamReadable. */
  get isReadable(): boolean {
    return this.state.state === 'readable';
  }

  /** IsReadableStreamClosed. */
  get isClosed(): boolean {
    return this.state.state === 'closed';
  }

  /** IsReadableStreamErrored. */
  get isErrored(): boolean {
    return this.state.state === 'errored';
  }

  /** IsReadableStreamDisturbed. */
  get disturbed(): boolean {
    return this.state.disturbed;
  }

  get controller(): NonNullable<ReadableStreamState['controller']> {
    const controller = this.#state.controller;
    if (!controller) throw new Error('ReadableStream has no controller');
    return controller;
  }

  get state(): ReadableStreamState {
    return this.#state;
  }

  /** AcquireReadableStreamDefaultReader. */
  getDefaultReader(): ReadableStreamDefaultReaderImpl {
    return new ReadableStreamDefaultReaderImpl(this);
  }

  /** Streams §4.9.2, ReadableStreamCancel. */
  cancelInternal(reason: unknown): PromiseValue<void> {
    const state = this.state;
    state.disturbed = true;

    if (state.state === 'closed') {
      return this.runtime.promises.resolve(undefined);
    }
    if (state.state === 'errored') {
      return this.runtime.promises.reject(state.storedError);
    }

    this.closeInternal();
    const reader = state.reader;
    if (ReadableStreamBYOBReaderImpl.is(reader)) {
      const requests = reader.readIntoRequests;
      reader.resetReadIntoRequests();
      for (const request of requests) request.closeSteps(undefined);
    }
    const sourceCancelPromise = this.controller.cancel(reason);
    return sourceCancelPromise.then(() => undefined);
  }

  /** Streams §4.2.5, asynchronous iterator initialization steps. */
  createAsyncIterator(options: ReadableStreamIteratorOptions): ReadableStreamIterator {
    return new ReadableStreamIterator(this.getDefaultReader(), options.preventCancel);
  }

  /** Streams §4.9.1, ReadableStreamPipeTo. */
  pipeToInternal(
    destination: WritableStreamImpl,
    preventClose: boolean,
    preventAbort: boolean,
    preventCancel: boolean,
    signal?: AbortSignalCapability,
  ): PromiseValue<void> {
    const reader = this.getDefaultReader();
    const writer = destination.getWriter();
    const sourceState = this.state;
    const destinationState = destination.state;
    const readerState = reader.genericReaderMixin.state;
    const writerState = writer.state;

    sourceState.disturbed = true;

    let shuttingDown = false;
    let currentWrite = this.runtime.promises.resolve(undefined);
    const result = this.runtime.promises.withResolvers<void>();
    let abortAlgorithmHandle: AbortAlgorithmHandle | null | undefined;

    const pipeLoop = (): PromiseValue<void> => {
      const loop = this.runtime.promises.withResolvers<void>();
      const next = (done: unknown): void => {
        if (done) {
          loop.resolve(undefined);
          return;
        }
        void pipeStep().then(next, (reason) => loop.reject(reason));
      };
      next(false);
      return loop.promise;
    };

    const pipeStep = (): PromiseValue<boolean> => {
      if (shuttingDown) {
        return this.runtime.promises.resolve(true);
      }
      return this.runtime.promises.import(writerState.readyPromise.promise).then(() => {
        const read = this.runtime.promises.withResolvers<boolean>();
        reader.readChunk({
          chunkSteps: (chunk) => {
            const write = this.runtime.promises.resolve(undefined).then(() => writer.writeInternal(chunk));
            currentWrite = write.then(undefined, () => undefined);
            read.resolve(false);
          },
          closeSteps: () => read.resolve(true),
          errorSteps: (reason) => read.reject(reason),
        });
        return read.promise;
      });
    };

    const waitForWritesToFinish = (): PromiseValue<void> => {
      const oldCurrentWrite = currentWrite;
      return currentWrite.then(() => oldCurrentWrite !== currentWrite
        ? waitForWritesToFinish()
        : undefined);
    };

    const isOrBecomesErrored = (
      state: { readonly state: string; readonly storedError?: unknown; },
      promise: PromiseValue<unknown>,
      action: (reason: unknown) => void,
    ): void => {
      if (state.state === 'errored') {
        action(state.storedError);
      } else {
        void this.runtime.promises.import(promise).then(undefined, action);
      }
    };

    const isOrBecomesClosed = (
      state: { readonly state: string; },
      promise: PromiseValue<unknown>,
      action: () => void,
    ): void => {
      if (state.state === 'closed') {
        action();
      } else {
        void this.runtime.promises.import(promise).then(action, () => undefined);
      }
    };

    /** Streams §4.9.1, Shutdown with an action (within ReadableStreamPipeTo). */
    const shutdownWithAction = (
      action: () => PromiseValue<unknown>,
      originalError?: unknown,
      originalIsError = false,
    ): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      const doTheRest = (): void => {
        void this.runtime.promises.import(action()).then(
          () => finalize(originalError, originalIsError),
          (newError) => finalize(newError, true),
        );
      };
      if (destination.isWritable &&
        !destination.closeQueuedOrInFlight) {
        void waitForWritesToFinish().then(doTheRest);
      } else {
        doTheRest();
      }
    };

    /** Streams §4.9.1, Shutdown (within ReadableStreamPipeTo). */
    const shutdown = (error?: unknown, isError = false): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      if (destination.isWritable &&
        !destination.closeQueuedOrInFlight) {
        void waitForWritesToFinish().then(() => finalize(error, isError));
      } else {
        finalize(error, isError);
      }
    };

    /** Streams §4.9.1, Finalize (within ReadableStreamPipeTo). */
    const finalize = (error: unknown, isError: boolean): void => {
      writer.release();
      reader.release();
      abortAlgorithmHandle?.remove();
      if (isError) result.reject(error);
      else result.resolve(undefined);
    };

    if (signal) {
      const abortAlgorithm = () => {
        const error = signal.reason;
        const actions: Array<() => PromiseValue<unknown>> = [];
        if (!preventAbort) {
          actions.push(() => destination.isWritable
            ? destination.abortInternal(error)
            : this.runtime.promises.resolve(undefined));
        }
        if (!preventCancel) {
          actions.push(() => sourceState.state === 'readable'
            ? this.cancelInternal(error)
            : this.runtime.promises.resolve(undefined));
        }
        shutdownWithAction(
          () => this.runtime.promises.all(actions.map((action) => action())).then(() => undefined),
          error,
          true,
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
            () => destination.abortInternal(storedError),
            storedError,
            true,
          );
        } else {
          shutdown(storedError, true);
        }
      },
    );

    isOrBecomesErrored(
      destinationState,
      writerState.closedPromise.promise,
      (storedError) => {
        if (!preventCancel) {
          shutdownWithAction(
            () => this.cancelInternal(storedError),
            storedError,
            true,
          );
        } else {
          shutdown(storedError, true);
        }
      },
    );

    isOrBecomesClosed(sourceState, readerState.closedPromise.promise, () => {
      if (!preventClose) {
        shutdownWithAction(
          () => writer.closeWithErrorPropagation(),
        );
      } else {
        shutdown();
      }
    });

    if (destination.closeQueuedOrInFlight ||
      destinationState.state === 'closed') {
      const error = new TypeError(
        'The destination WritableStream closed before all data could be piped to it',
      );
      if (!preventCancel) {
        shutdownWithAction(
          () => this.cancelInternal(error),
          error,
          true,
        );
      } else {
        shutdown(error, true);
      }
    }

    void pipeLoop().then(undefined, () => {});

    return result.promise;
  }

  /** ReadableStreamDefaultTee. */
  teeDefault(cloneForBranch2: boolean): [ReadableStreamImpl, ReadableStreamImpl] {
    const reader = this.getDefaultReader();
    const generic = reader.genericReaderMixin;
    let reading = false;
    let readAgain = false;
    let canceled1 = false;
    let canceled2 = false;
    let reason1: unknown = undefined;
    let reason2: unknown = undefined;
    const cancelPromise = this.runtime.promises.withResolvers<void>();

    const settleCancelPromise = (reason: readonly unknown[]): void => {
      void this.cancelInternal([...reason]).then(() => cancelPromise.resolve(undefined), (error) => cancelPromise.reject(error));
    };

    const pullAlgorithm = (): PromiseValue<unknown> => {
      if (reading) {
        readAgain = true;
        return this.runtime.promises.resolve(undefined);
      }
      reading = true;
      reader.readChunk({
        chunkSteps: (chunk) => {
          void this.runtime.promises.resolve().then(() => {
            readAgain = false;
            let chunk2 = chunk;
            if (cloneForBranch2 && !canceled2) {
              try {
                chunk2 = this.runtime.clone(chunk);
              } catch (error) {
                branch1.defaultController.error(error);
                branch2.defaultController.error(error);
                this.cancelInternal(error).observe(cancelPromise.resolve, cancelPromise.reject);
                return;
              }
            }
            if (!canceled1) {
              branch1.defaultController.enqueueInternal(chunk);
            }
            if (!canceled2) {
              branch2.defaultController.enqueueInternal(chunk2);
            }
            reading = false;
            // Enqueuing can synchronously reenter a branch pull algorithm.
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (readAgain) void pullAlgorithm();
          });
        },
        closeSteps: () => {
          reading = false;
          if (!canceled1) {
            branch1.defaultController.closeInternal();
          }
          if (!canceled2) {
            branch2.defaultController.closeInternal();
          }
          if (!canceled1 || !canceled2) {
            cancelPromise.resolve(undefined);
          }
        },
        errorSteps: () => {
          reading = false;
        },
      });
      return this.runtime.promises.resolve(undefined);
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

    const branch1 = ReadableStreamImpl.create(
      () => undefined,
      pullAlgorithm,
      cancel1Algorithm,
      1,
      () => 1,
      this.runtime,
    );

    const branch2 = ReadableStreamImpl.create(
      () => undefined,
      pullAlgorithm,
      cancel2Algorithm,
      1,
      () => 1,
      this.runtime,
    );

    void generic.state.closedPromise.promise.then(() => undefined, (reason) => {
      branch1.defaultController.error(reason);
      branch2.defaultController.error(reason);
      if (!canceled1 || !canceled2) {
        cancelPromise.resolve(undefined);
      }
    });

    return [branch1, branch2];
  }

  /** ReadableStreamClose. */
  closeInternal(): void {
    const state = this.state;
    if (state.state !== 'readable') {
      throw new Error('Only a readable stream can be closed');
    }
    state.state = 'closed';

    const reader = state.reader;
    if (!reader) return;

    const generic = reader.genericReaderMixin;
    generic.state.closedPromise.resolve(undefined);

    if (ReadableStreamDefaultReaderImpl.is(reader)) {
      const requests = reader.readRequests;
      reader.resetReadRequests();
      for (const request of requests) request.closeSteps();
    }
  }

  /** ReadableStreamError. */
  errorInternal(error: unknown): void {
    const state = this.state;
    if (state.state !== 'readable') {
      throw new Error('Only a readable stream can be errored');
    }
    state.state = 'errored';
    state.storedError = error;

    const reader = state.reader;
    if (!reader) return;

    const generic = reader.genericReaderMixin;
    const closedPromise = generic.state.closedPromise;
    closedPromise.reject(error);
    void closedPromise.promise.then(undefined, () => {});
    if (ReadableStreamDefaultReaderImpl.is(reader)) {
      reader.errorReadRequests(error);
    } else {
      const requests = reader.readIntoRequests;
      reader.resetReadIntoRequests();
      for (const request of requests) request.errorSteps(error);
    }
  }

  /** AcquireReadableStreamBYOBReader. */
  getBYOBReader(): ReadableStreamBYOBReaderImpl {
    return new ReadableStreamBYOBReaderImpl(this);
  }

  /** ReadableByteStreamTee. */
  teeBytes(): [ReadableStreamImpl, ReadableStreamImpl] {
    let reader: ReadableStreamDefaultReaderImpl | ReadableStreamBYOBReaderImpl =
      new ReadableStreamDefaultReaderImpl();

    const settleCancelPromise = (reason: unknown): void => {
      void this.cancelInternal(reason).then(() => cancelPromise.resolve(undefined), (error) => cancelPromise.reject(error));
    };

    reader.setUp(this);

    let readAgainForBranch1 = false;
    let readAgainForBranch2 = false;
    let reading = false;
    let canceled1 = false;
    let canceled2 = false;
    let reason1: unknown = undefined;
    let reason2: unknown = undefined;
    const cancelPromise = this.runtime.promises.withResolvers<void>();

    const forwardReaderError = (
      currentReader: ReadableStreamDefaultReaderImpl |
        ReadableStreamBYOBReaderImpl,
    ): void => {
      const generic = currentReader.genericReaderMixin;
      void generic.state.closedPromise.promise.then(() => undefined, (reason) => {
        if (currentReader !== reader) return;
        branch1.byteController.error(reason);
        branch2.byteController.error(reason);
        if (!canceled1 || !canceled2) {
          cancelPromise.resolve(undefined);
        }
      });
    };

    const pullWithDefaultReader = (): void => {
      if (ReadableStreamBYOBReaderImpl.is(reader)) {
        assert(reader.readIntoRequests.length === 0);
        reader.release();
        reader = new ReadableStreamDefaultReaderImpl();
        reader.setUp(this);
        forwardReaderError(reader);
      }
      reader.readChunk({
        chunkSteps: (chunk) => {
          const byteChunk = requireObject(chunk);
          void this.runtime.promises.resolve().then(() => {
            readAgainForBranch1 = false;
            readAgainForBranch2 = false;
            let chunk2 = byteChunk;
            if (!canceled1 && !canceled2) {
              try {
                chunk2 = cloneAsUint8Array(byteChunk, this.runtime);
              } catch (error) {
                branch1.byteController.error(error);
                branch2.byteController.error(error);
                settleCancelPromise(error);
                return;
              }
            }
            if (!canceled1) {
              branch1.byteController.enqueueInternal(byteChunk);
            }
            if (!canceled2) {
              branch2.byteController.enqueueInternal(chunk2);
            }
            reading = false;
            // Enqueuing can synchronously reenter a branch pull algorithm.
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (readAgainForBranch1) void pull1Algorithm();
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            else if (readAgainForBranch2) void pull2Algorithm();
          });
        },
        closeSteps: () => {
          reading = false;
          const controller1 = branch1.byteController;
          const controller2 = branch2.byteController;
          if (!canceled1) controller1.closeInternal();
          if (!canceled2) controller2.closeInternal();
          if (controller1.state.pendingPullIntos.length > 0) {
            controller1.respond(0);
          }
          if (controller2.state.pendingPullIntos.length > 0) {
            controller2.respond(0);
          }
          if (!canceled1 || !canceled2) {
            cancelPromise.resolve(undefined);
          }
        },
        errorSteps: () => {
          reading = false;
        },
      });
    };

    const pullWithBYOBReader = (
      view: object,
      forBranch2: boolean,
    ): void => {
      if (ReadableStreamDefaultReaderImpl.is(reader)) {
        assert(reader.readRequests.length === 0);
        reader.release();
        reader = this.getBYOBReader();
        forwardReaderError(reader);
      }
      const byobBranch = forBranch2 ? branch2 : branch1;
      const otherBranch = forBranch2 ? branch1 : branch2;
      reader.readInto(
        view,
        1,
        {
          chunkSteps: (chunk) => {
            void this.runtime.promises.resolve().then(() => {
              readAgainForBranch1 = false;
              readAgainForBranch2 = false;
              const byobCanceled = forBranch2 ? canceled2 : canceled1;
              const otherCanceled = forBranch2 ? canceled1 : canceled2;
              if (!otherCanceled) {
                let clonedChunk: object;
                try {
                  clonedChunk = cloneAsUint8Array(chunk, this.runtime);
                } catch (error) {
                  byobBranch.byteController.error(error);
                  otherBranch.byteController.error(error);
                  settleCancelPromise(error);
                  return;
                }
                if (!byobCanceled) {
                  byobBranch.byteController.respondWithNewView(chunk);
                }
                otherBranch.byteController.enqueueInternal(clonedChunk);
              } else if (!byobCanceled) {
                byobBranch.byteController.respondWithNewView(chunk);
              }
              reading = false;
              // Enqueuing can synchronously reenter a branch pull algorithm.
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
              if (readAgainForBranch1) void pull1Algorithm();
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
              else if (readAgainForBranch2) void pull2Algorithm();
            });
          },
          closeSteps: (chunk) => {
            reading = false;
            const byobCanceled = forBranch2 ? canceled2 : canceled1;
            const otherCanceled = forBranch2 ? canceled1 : canceled2;
            const byobController = byobBranch.byteController;
            const otherController = otherBranch.byteController;
            if (!byobCanceled) byobController.closeInternal();
            if (!otherCanceled) otherController.closeInternal();
            if (chunk !== undefined) {
              assert(getBufferSourceByteLength(chunk) === 0);
              if (!byobCanceled) {
                byobController.respondWithNewView(chunk);
              }
              if (!otherCanceled && otherController.state.pendingPullIntos.length > 0) {
                otherController.respond(0);
              }
            }
            if (!byobCanceled || !otherCanceled) {
              cancelPromise.resolve(undefined);
            }
          },
          errorSteps: () => {
            reading = false;
          },
        },
      );
    };

    const pull1Algorithm = (): PromiseValue<unknown> => {
      if (reading) {
        readAgainForBranch1 = true;
        return this.runtime.promises.resolve();
      }
      reading = true;
      const request = branch1.byteController.byobRequest;
      const view = request?.view;
      if (view) pullWithBYOBReader(view, false);
      else pullWithDefaultReader();
      return this.runtime.promises.resolve();
    };

    const pull2Algorithm = (): PromiseValue<unknown> => {
      if (reading) {
        readAgainForBranch2 = true;
        return this.runtime.promises.resolve();
      }
      reading = true;
      const request = branch2.byteController.byobRequest;
      const view = request?.view;
      if (view) pullWithBYOBReader(view, true);
      else pullWithDefaultReader();
      return this.runtime.promises.resolve();
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

    const branch1 = ReadableStreamImpl.createByteStream(
      () => undefined,
      pull1Algorithm,
      cancel1Algorithm,
      this.runtime,
    );

    const branch2 = ReadableStreamImpl.createByteStream(
      () => undefined,
      pull2Algorithm,
      cancel2Algorithm,
      this.runtime,
    );

    forwardReaderError(reader);

    return [branch1, branch2];
  }

  /** ReadableStreamAddReadIntoRequest. */
  addReadIntoRequest(request: ReadIntoRequest): void {
    const reader = this.state.reader;
    if (!ReadableStreamBYOBReaderImpl.is(reader)) {
      throw new Error('Readable stream has no BYOB reader');
    }
    reader.readIntoRequests.push(request);
  }

  /** ReadableStreamAddReadRequest. */
  addReadRequest(request: ReadRequest): void {
    const reader = this.state.reader;
    if (!ReadableStreamDefaultReaderImpl.is(reader)) {
      throw new Error('Readable stream has no default reader');
    }
    reader.readRequests.push(request);
  }

  /** CommitPullIntoDescriptor. */
  commitPullIntoDescriptor(descriptor: PullIntoDescriptor): void {
    const streamState = this.state;
    assert(streamState.state !== 'errored');
    assert(descriptor.readerType !== 'none');
    const done = streamState.state === 'closed';
    const controller = streamState.controller;
    assert(ReadableByteStreamControllerImpl.is(controller));
    const view = convertPullIntoDescriptor(descriptor, this.runtime);
    if (descriptor.readerType === 'default') {
      this.fulfillReadRequest(view, done);
    } else {
      this.fulfillReadIntoRequest(view, done);
    }
  }

  /** FulfillReadIntoRequest. */
  fulfillReadIntoRequest(chunk: object, done: boolean): void {
    const reader = this.state.reader;
    assert(ReadableStreamBYOBReaderImpl.is(reader));
    const request = reader.readIntoRequests.shift();
    assert(request !== undefined);
    if (done) request.closeSteps(chunk);
    else request.chunkSteps(chunk);
  }

  /** FulfillReadRequest. */
  fulfillReadRequest(chunk: unknown, done: boolean): void {
    const reader = this.state.reader;
    assert(ReadableStreamDefaultReaderImpl.is(reader));
    const request = reader.readRequests.shift();
    assert(request !== undefined);
    if (done) request.closeSteps();
    else request.chunkSteps(chunk);
  }

  /** Streams §9.1, close a ReadableStream from another specification. */
  close(): void {
    const controller = this.controller;
    controller.closeInternal();
    if (ReadableByteStreamControllerImpl.is(controller) &&
      controller.state.pendingPullIntos.length > 0) {
      controller.respond(0);
    }
  }

  /** Streams §9.1, error a ReadableStream from another specification. */
  error(error: unknown): void {
    this.controller.error(error);
  }

  /** Streams §9.1, enqueue a chunk from another specification. */
  enqueueChunk(chunk: unknown): void {
    const controller = this.controller;
    if (ReadableByteStreamControllerImpl.is(controller)) {
      if (
        typeof chunk !== 'object' || chunk === null ||
        !isArrayBufferView(chunk)
      ) {
        throw new Error('A byte stream chunk must be an ArrayBufferView');
      }
      const byobView = this.byobRequestView;
      if (
        byobView !== null &&
        getBufferSourceUnderlyingBuffer(chunk) ===
        getBufferSourceUnderlyingBuffer(byobView)
      ) {
        if (
          getBufferSourceByteOffset(chunk) !==
          getBufferSourceByteOffset(byobView) ||
          getBufferSourceByteLength(chunk) >
          getBufferSourceByteLength(byobView)
        ) {
          throw new Error('A byte stream chunk exceeds its BYOB request view');
        }
        controller.respond(getBufferSourceByteLength(chunk));
        return;
      }
      controller.enqueueInternal(chunk);
    } else {
      controller.enqueueInternal(chunk);
    }
  }

  /**
   * Streams §9.1.1, pull from bytes.
   *
   * The returned offset represents removing the consumed prefix from `bytes`
   * without copying the remainder.
   */
  pullFromBytes(bytes: Uint8Array, offset = 0): number {
    if (!Number.isInteger(offset) || offset < 0 || offset > bytes.length) {
      throw new Error('Byte sequence offset is out of range');
    }
    const available = bytes.length - offset;
    const byobView = this.byobRequestView;
    const pullSize = Math.min(
      available,
      byobView === null
        ? available
        : getBufferSourceByteLength(byobView),
    );
    const pulled = bytes.subarray(offset, offset + pullSize);
    if (byobView === null) {
      this.byteController.enqueueInternal(this.runtime.buffers.copyUint8Array(pulled));
    } else {
      writeArrayBufferView(byobView, pulled);
      this.byteController.respond(pullSize);
    }
    return offset + pullSize;
  }

  /** Streams §9.1.2, tee a stream with cloning enabled for the second branch. */
  teeWithCloning(): [ReadableStreamImpl, ReadableStreamImpl] {
    return ReadableByteStreamControllerImpl.is(this.controller)
      ? this.teeBytes()
      : this.teeDefault(true);
  }

  /** Streams §9.5, pipe to; options are grouped in one record. */
  pipeToStream(
    writable: WritableStreamImpl,
    options: Partial<StreamPipeOptions> = {},
  ): PromiseValue<void> {
    if (this.locked || writable.locked) {
      throw new Error('Streams must be unlocked before piping');
    }
    return this.pipeToInternal(
      writable,
      options.preventClose ?? false,
      options.preventAbort ?? false,
      options.preventCancel ?? false,
      options.signal,
    );
  }

  /** Streams §9.5, pipe through; options are grouped in one record. */
  pipeThroughTransform(
    transform: TransformStreamImpl,
    options: Partial<StreamPipeOptions> = {},
  ): ReadableStreamImpl {
    const promise = this.pipeToStream(transform.writable, options);
    void promise.then(undefined, () => {});
    return transform.readable;
  }
}

type ReadableStreamState = {
  controller?: ReadableByteStreamControllerImpl |
    ReadableStreamDefaultControllerImpl;
  disturbed: boolean;
  reader?: ReadableStreamBYOBReaderImpl | ReadableStreamDefaultReaderImpl;
  state: 'readable' | 'closed' | 'errored';
  storedError?: unknown;
};

/*
 * dictionary ReadableStreamGetReaderOptions {
 *   ReadableStreamReaderMode mode;
 * };
 */
export type ReadableStreamGetReaderOptions = {
  readonly mode?: 'byob';
};

/*
 * dictionary ReadableStreamIteratorOptions {
 *   boolean preventCancel = false;
 * };
 */
export type ReadableStreamIteratorOptions = {
  readonly preventCancel: boolean;
};

/*
 * dictionary ReadableWritablePair {
 *   required ReadableStream readable;
 *   required WritableStream writable;
 * };
 */
export type ReadableWritablePair = {
  readonly readable: ReadableStreamImpl;
  readonly writable: WritableStreamImpl;
};

/*
 * dictionary StreamPipeOptions {
 *   boolean preventClose = false;
 *   boolean preventAbort = false;
 *   boolean preventCancel = false;
 *   AbortSignal signal;
 * };
 */
export type StreamPipeOptions = {
  readonly preventAbort: boolean;
  readonly preventCancel: boolean;
  readonly preventClose: boolean;
  readonly signal?: AbortSignalCapability;
};

/*
 * dictionary UnderlyingSource {
 *   UnderlyingSourceStartCallback start;
 *   UnderlyingSourcePullCallback pull;
 *   UnderlyingSourceCancelCallback cancel;
 *   ReadableStreamType type;
 *   [EnforceRange] unsigned long long autoAllocateChunkSize;
 * };
 */
export type UnderlyingSource = UnderlyingDefaultSource | UnderlyingByteSource;

export type UnderlyingDefaultSource = UnderlyingSourceSteps<ReadableStreamDefaultControllerImpl> & {
  readonly autoAllocateChunkSize?: number;
  readonly type?: undefined;
};

export type UnderlyingByteSource = UnderlyingSourceSteps<ReadableByteStreamControllerImpl> & {
  readonly autoAllocateChunkSize?: number;
  readonly type: 'bytes';
};

type UnderlyingSourceSteps<Controller> = {
  readonly cancel?: (reason?: unknown) => PromiseValue<unknown> | void;
  readonly pull?: (controller: Controller) => PromiseValue<unknown> | void;
  readonly start?: (controller: Controller) => unknown;
};

// -- Web IDL ------------------------------------------------------------

export const readableStreamIDL = defineInterface({
  name: 'ReadableStream',
  exposed: '*',
  ...xattr('Transferable'),
  implementation: impl(ReadableStreamImpl, {
    constructWith: [atArg(2, (ctx) => ctx.getRuntime())],
  }),
  members: [
    ctor([
      arg('underlyingSource', idlType.object, {
        optional: true,
        ...cbDict('UnderlyingSource'),
      }),
      arg('strategy', reference('QueuingStrategy'), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
    staticOp('from', reference('ReadableStream'),
      [arg('asyncIterable', asyncSequence(idlType.any))],
      invokeWith(atArg(1, (ctx) => ctx.getRuntime())),
    ),
    roAttr('locked', idlType.boolean),
    op('cancel', promise(idlType.undefined), [
      arg('reason', idlType.any, { optional: true }),
    ]),
    op('getReader', reference('ReadableStreamReader'), [
      arg('options', reference('ReadableStreamGetReaderOptions'), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
    op('pipeThrough', reference('ReadableStream'), [
      arg('transform', reference('ReadableWritablePair')),
      arg('options', reference('StreamPipeOptions'), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
    op('pipeTo', promise(idlType.undefined), [
      arg('destination', reference('WritableStream')),
      arg('options', reference('StreamPipeOptions'), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
    op('tee', sequence(reference('ReadableStream'))),
    asyncIter(idlType.any, {
      arguments: [arg(
        'options',
        reference('ReadableStreamIteratorOptions'),
        { default: emptyDictionary, optional: true },
      )],
      create: 'createAsyncIterator',
      return: true,
    }),
  ],
});

/*
 * typedef (ReadableStreamDefaultReader or ReadableStreamBYOBReader) ReadableStreamReader;
 */
export const readableStreamReaderIDL = defineTypedef({
  name: 'ReadableStreamReader',
  type: union(
    reference('ReadableStreamDefaultReader'),
    reference('ReadableStreamBYOBReader'),
  ),
});

/*
 * enum ReadableStreamReaderMode { "byob" };
 */
export const readableStreamReaderModeIDL = defineEnumeration({
  name: 'ReadableStreamReaderMode',
  values: ['byob'],
});

export const readableStreamGetReaderOptionsIDL = defineDictionary({
  name: 'ReadableStreamGetReaderOptions',
  members: [dictMember('mode', reference('ReadableStreamReaderMode'))],
});

export const readableStreamIteratorOptionsIDL = defineDictionary({
  name: 'ReadableStreamIteratorOptions',
  members: [dictMember('preventCancel', idlType.boolean, { default: false })],
});

export const readableWritablePairIDL = defineDictionary({
  name: 'ReadableWritablePair',
  members: [
    dictMember('readable', reference('ReadableStream'), { required: true }),
    dictMember('writable', reference('WritableStream'), { required: true }),
  ],
});

export const streamPipeOptionsIDL = defineDictionary({
  name: 'StreamPipeOptions',
  members: [
    dictMember('preventClose', idlType.boolean, { default: false }),
    dictMember('preventAbort', idlType.boolean, { default: false }),
    dictMember('preventCancel', idlType.boolean, { default: false }),
    dictMember('signal', reference('AbortSignal')),
  ],
});

/*
 * callback UnderlyingSourceStartCallback = any (ReadableStreamController controller);
 */
export const underlyingSourceStartCallbackIDL = defineCallbackFunction({
  name: 'UnderlyingSourceStartCallback',
  returns: idlType.any,
  arguments: [arg('controller', reference('ReadableStreamController'))],
});

/*
 * callback UnderlyingSourcePullCallback = Promise<undefined> (ReadableStreamController controller);
 */
export const underlyingSourcePullCallbackIDL = defineCallbackFunction({
  name: 'UnderlyingSourcePullCallback',
  returns: promise(idlType.undefined),
  arguments: [arg('controller', reference('ReadableStreamController'))],
});

/*
 * callback UnderlyingSourceCancelCallback = Promise<undefined> (optional any reason);
 */
export const underlyingSourceCancelCallbackIDL = defineCallbackFunction({
  name: 'UnderlyingSourceCancelCallback',
  returns: promise(idlType.undefined),
  arguments: [arg('reason', idlType.any, { optional: true })],
});

/*
 * enum ReadableStreamType { "bytes" };
 */
export const readableStreamTypeIDL = defineEnumeration({
  name: 'ReadableStreamType',
  values: ['bytes'],
});

/*
 * typedef (ReadableStreamDefaultController or ReadableByteStreamController) ReadableStreamController;
 */
export const readableStreamControllerIDL = defineTypedef({
  name: 'ReadableStreamController',
  type: union(
    reference('ReadableStreamDefaultController'),
    reference('ReadableByteStreamController'),
  ),
});

export const underlyingSourceIDL = defineDictionary({
  name: 'UnderlyingSource',
  members: [
    dictMember('start', reference('UnderlyingSourceStartCallback'),
      onError('rethrow')),
    dictMember('pull', reference('UnderlyingSourcePullCallback')),
    dictMember('cancel', reference('UnderlyingSourceCancelCallback')),
    dictMember('type', reference('ReadableStreamType')),
    dictMember('autoAllocateChunkSize', idlType.unsignedLongLong, {
      ...xattr('EnforceRange'),
    }),
  ],
});

// =============================================================================
// ReadableStreamIterator
// =============================================================================

class ReadableStreamIterator {
  readonly #reader: ReadableStreamDefaultReaderImpl;
  readonly #preventCancel: boolean;

  constructor(reader: ReadableStreamDefaultReaderImpl, preventCancel: boolean) {
    this.#reader = reader;
    this.#preventCancel = preventCancel;
  }

  /** Streams §4.2.5, get the next iteration result. */
  next(): PromiseValue<unknown> {
    const reader = this.#reader;
    const promises = reader.genericReaderMixin.state.promises;
    const promise = promises.withResolvers<unknown>();
    reader.readChunk({
      chunkSteps: (chunk) => promises.resolve(chunk).observe(promise.resolve, promise.reject),
      closeSteps() {
        reader.release();
        promise.resolve(endOfIteration);
      },
      errorSteps(reason) {
        reader.release();
        promise.reject(reason);
      },
    });
    return promise.promise;
  }

  /** Streams §4.2.5, asynchronous iterator return. */
  return(value: unknown): PromiseValue<void> {
    const reader = this.#reader;
    const generic = reader.genericReaderMixin;
    const result = this.#preventCancel
      ? generic.state.promises.resolve(undefined)
      : generic.cancelInternal(value);
    reader.release();
    return result;
  }
}

// =============================================================================
// ReadableStreamDefaultController
// =============================================================================

/*
 * [Exposed=*]
 * interface ReadableStreamDefaultController {
 *   readonly attribute unrestricted double? desiredSize;
 *
 *   undefined close();
 *   undefined enqueue(optional any chunk);
 *   undefined error(optional any e);
 * };
 */
export class ReadableStreamDefaultControllerImpl {
  #state?: ReadableStreamDefaultControllerState;

  static is(value: unknown): value is ReadableStreamDefaultControllerImpl {
    return typeof value === 'object' && value !== null && #state in value;
  }

  /** Streams §4.9.4, SetUpReadableStreamDefaultControllerFromUnderlyingSource. */
  static setUpFromUnderlyingSource(
    stream: ReadableStreamImpl,
    source: UnderlyingDefaultSource,
    highWaterMark: number,
    sizeAlgorithm: QueuingStrategySize,
  ): void {
    const controller = new ReadableStreamDefaultControllerImpl();
    const { start, pull, cancel } = source;
    const startAlgorithm = () => start && Reflect.apply(start, source, [controller]);
    const pullAlgorithm = () => stream.runtime.promises.try(() => pull?.call(source, controller));
    const cancelAlgorithm = (reason: unknown) => stream.runtime.promises.try(() => cancel?.call(source, reason));

    controller.setUp(
      stream,
      startAlgorithm,
      pullAlgorithm,
      cancelAlgorithm,
      highWaterMark,
      sizeAlgorithm,
    );
  }

  /** ReadableStreamDefaultControllerGetDesiredSize. */
  get desiredSize(): number | null {
    const state = this.state;
    const streamState = state.stream.state.state;
    if (streamState === 'errored') return null;
    if (streamState === 'closed') return 0;
    return state.strategyHighWaterMark - state.queue.totalSize;
  }

  close(): void {
    if (!this.canCloseOrEnqueue) {
      throw new TypeError(
        'The stream is not in a state that permits close',
      );
    }
    this.closeInternal();
  }

  enqueue(chunk?: unknown): void {
    if (!this.canCloseOrEnqueue) {
      throw new TypeError(
        'The stream is not in a state that permits enqueue',
      );
    }
    this.enqueueInternal(chunk);
  }

  /** ReadableStreamDefaultControllerError. */
  error(error?: unknown): void {
    const state = this.state;
    if (state.stream.state.state !== 'readable') return;
    state.queue.reset();
    this.clearAlgorithms();
    state.stream.errorInternal(error);
  }

  // -- Internal algorithms ------------------------------------------------

  /** ReadableStreamDefaultControllerHasBackpressure. */
  get hasBackpressure(): boolean {
    return !this.shouldCallPull;
  }

  /** ReadableStreamDefaultControllerCanCloseOrEnqueue. */
  get canCloseOrEnqueue(): boolean {
    const state = this.state;
    return !state.closeRequested &&
      state.stream.state.state === 'readable';
  }

  /** ReadableStreamDefaultControllerShouldCallPull. */
  get shouldCallPull(): boolean {
    const state = this.state;
    if (!this.canCloseOrEnqueue) {
      return false;
    }
    if (!state.started) return false;

    const reader = state.stream.state.reader;
    if (ReadableStreamDefaultReaderImpl.is(reader) &&
      reader.readRequests.length) {
      return true;
    }

    const desiredSize = this.desiredSize;
    return desiredSize !== null && desiredSize > 0;
  }

  get state(): ReadableStreamDefaultControllerState {
    if (!this.#state) {
      throw new Error('ReadableStreamDefaultController is not set up');
    }
    return this.#state;
  }

  set state(state: ReadableStreamDefaultControllerState) {
    this.#state = state;
  }

  /** ReadableStreamDefaultControllerCallPullIfNeeded. */
  callPullIfNeeded(): void {
    if (!this.shouldCallPull) return;

    const state = this.state;
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
        this.callPullIfNeeded();
      }
    }, (error) => {
      this.error(error);
    });
  }

  /** ReadableStreamDefaultControllerClearAlgorithms. */
  clearAlgorithms(): void {
    const state = this.state;
    state.pullAlgorithm = undefined;
    state.cancelAlgorithm = undefined;
    state.strategySizeAlgorithm = undefined;
  }

  /** ReadableStreamDefaultControllerClose. */
  closeInternal(): void {
    if (!this.canCloseOrEnqueue) return;
    const state = this.state;
    state.closeRequested = true;
    if (state.queue.length === 0) {
      this.clearAlgorithms();
      state.stream.closeInternal();
    }
  }

  /** ReadableStreamDefaultControllerEnqueue. */
  enqueueInternal(chunk: unknown): void {
    if (!this.canCloseOrEnqueue) return;
    const state = this.state;
    const streamState = state.stream.state;
    const reader = streamState.reader;
    if (ReadableStreamDefaultReaderImpl.is(reader) &&
      reader.readRequests.length) {
      state.stream.fulfillReadRequest(chunk, false);
    } else {
      let chunkSize: number;
      try {
        chunkSize = requireAlgorithm(
          state.strategySizeAlgorithm,
          'size',
        )(chunk);
      } catch (error) {
        this.error(error);
        throw error;
      }

      try {
        state.queue.enqueue(chunk, chunkSize);
      } catch (error) {
        this.error(error);
        throw error;
      }
    }

    this.callPullIfNeeded();
  }

  /** [[CancelSteps]](reason). */
  cancel(reason: unknown): PromiseValue<unknown> {
    const state = this.state;
    state.queue.reset();
    const result = requireAlgorithm(state.cancelAlgorithm, 'cancel')(reason);
    this.clearAlgorithms();
    return result;
  }

  /** [[PullSteps]](readRequest). */
  pull(request: ReadRequest): void {
    const state = this.state;
    if (state.queue.length > 0) {
      const chunk = state.queue.dequeue();
      if (state.closeRequested && state.queue.length === 0) {
        this.clearAlgorithms();
        state.stream.closeInternal();
      } else {
        this.callPullIfNeeded();
      }
      request.chunkSteps(chunk);
      return;
    }

    const reader = state.stream.state.reader;
    if (!ReadableStreamDefaultReaderImpl.is(reader)) {
      throw new Error('Default controller requires a default reader');
    }
    reader.readRequests.push(request);
    this.callPullIfNeeded();
  }

  /** [[ReleaseSteps]](). */
  release(): void {}

  /** SetUpReadableStreamDefaultController. */
  setUp(
    stream: ReadableStreamImpl,
    startAlgorithm: () => unknown,
    pullAlgorithm: () => PromiseValue<unknown>,
    cancelAlgorithm: (reason: unknown) => PromiseValue<unknown>,
    highWaterMark: number,
    sizeAlgorithm: QueuingStrategySize,
  ): void {
    const streamState = stream.state;
    if (streamState.controller) {
      throw new Error('ReadableStream already has a controller');
    }

    const state: ReadableStreamDefaultControllerState = {
      cancelAlgorithm,
      closeRequested: false,
      pullAgain: false,
      pullAlgorithm,
      pulling: false,
      queue: new QueueWithSizes(),
      started: false,
      strategyHighWaterMark: highWaterMark,
      strategySizeAlgorithm: sizeAlgorithm,
      stream,
    };
    this.state = state;
    streamState.controller = this;

    const startPromise = stream.runtime.promises.resolve(startAlgorithm());
    void startPromise.then(() => {
      state.started = true;
      this.callPullIfNeeded();
    }, (reason) => {
      this.error(reason);
    });
  }
}

type ReadableStreamDefaultControllerState = {
  readonly queue: QueueWithSizes<unknown>;
  cancelAlgorithm?: (reason: unknown) => PromiseValue<unknown>;
  closeRequested: boolean;
  pullAgain: boolean;
  pullAlgorithm?: () => PromiseValue<unknown>;
  pulling: boolean;
  started: boolean;
  strategyHighWaterMark: number;
  strategySizeAlgorithm?: QueuingStrategySize;
  stream: ReadableStreamImpl;
};

// -- Web IDL ------------------------------------------------------------

export const readableStreamDefaultControllerIDL = defineInterface({
  name: 'ReadableStreamDefaultController',
  exposed: '*',
  implementation: impl(ReadableStreamDefaultControllerImpl),
  members: [
    roAttr('desiredSize', nullable(idlType.unrestrictedDouble)),
    op('close', idlType.undefined),
    op('enqueue', idlType.undefined, [
      arg('chunk', idlType.any, { optional: true }),
    ]),
    op('error', idlType.undefined, [
      arg('e', idlType.any, { optional: true }),
    ]),
  ],
});

// =============================================================================
// ReadableByteStreamController
// =============================================================================

/*
 * [Exposed=*]
 * interface ReadableByteStreamController {
 *   readonly attribute ReadableStreamBYOBRequest? byobRequest;
 *   readonly attribute unrestricted double? desiredSize;
 *
 *   undefined close();
 *   undefined enqueue(ArrayBufferView chunk);
 *   undefined error(optional any e);
 * };
 */
export class ReadableByteStreamControllerImpl {
  #state?: ReadableByteStreamControllerState;

  static is(value: unknown): value is ReadableByteStreamControllerImpl {
    return typeof value === 'object' && value !== null && #state in value;
  }

  /** Streams §4.9.5, SetUpReadableByteStreamControllerFromUnderlyingSource. */
  static setUpFromUnderlyingSource(
    stream: ReadableStreamImpl,
    source: UnderlyingByteSource,
    highWaterMark: number,
  ): void {
    const controller = new ReadableByteStreamControllerImpl();
    const { start, pull, cancel } = source;
    const startAlgorithm = () => start && Reflect.apply(start, source, [controller]);
    const pullAlgorithm = () => stream.runtime.promises.try(() => pull?.call(source, controller));
    const cancelAlgorithm = (reason: unknown) => stream.runtime.promises.try(() => cancel?.call(source, reason));
    const autoAllocateChunkSize = source.autoAllocateChunkSize;
    if (autoAllocateChunkSize === 0) {
      throw new TypeError(
        'autoAllocateChunkSize must be greater than 0',
      );
    }
    controller.setUp(
      stream,
      startAlgorithm,
      pullAlgorithm,
      cancelAlgorithm,
      highWaterMark,
      autoAllocateChunkSize,
    );
  }

  /** ReadableByteStreamControllerGetBYOBRequest. */
  get byobRequest(): ReadableStreamBYOBRequestImpl | null {
    const state = this.state;
    if (!state.byobRequest && state.pendingPullIntos.length > 0) {
      const first = state.pendingPullIntos[0];
      assert(first !== undefined);
      const view = state.stream.runtime.buffers.createView(
        'Uint8Array',
        first.buffer,
        first.byteOffset + first.bytesFilled,
        first.byteLength - first.bytesFilled,
      );
      const request = new ReadableStreamBYOBRequestImpl();
      request.initialize(this, view);
      state.byobRequest = request;
    }
    return state.byobRequest;
  }

  /** ReadableByteStreamControllerGetDesiredSize. */
  get desiredSize(): number | null {
    const state = this.state;
    const streamState = state.stream.state.state;
    if (streamState === 'errored') return null;
    if (streamState === 'closed') return 0;
    return state.strategyHighWaterMark - state.queueTotalSize;
  }

  close(): void {
    const state = this.state;
    if (state.closeRequested) {
      throw new TypeError(
        'The stream has already been closed',
      );
    }
    const streamState = state.stream.state.state;
    if (streamState !== 'readable') {
      throw new TypeError(
        `A stream in the ${streamState} state cannot be closed`,
      );
    }
    this.closeInternal();
  }

  enqueue(chunk: object): void {
    if (getBufferSourceByteLength(chunk) === 0) {
      throw new TypeError(
        'chunk must have non-zero byteLength',
      );
    }
    if (getBufferSourceByteLength(
      getBufferSourceUnderlyingBuffer(chunk),
    ) === 0) {
      throw new TypeError(
        'chunk\'s buffer must have non-zero byteLength',
      );
    }

    const state = this.state;
    if (state.closeRequested) {
      throw new TypeError(
        'The stream is closed or draining',
      );
    }
    const streamState = state.stream.state.state;
    if (streamState !== 'readable') {
      throw new TypeError(
        `A stream in the ${streamState} state cannot be enqueued to`,
      );
    }
    this.enqueueInternal(chunk);
  }

  /** ReadableByteStreamControllerError. */
  error(error?: unknown): void {
    const state = this.state;
    if (state.stream.state.state !== 'readable') return;
    this.clearPendingPullIntos();
    state.queue = [];
    state.queueTotalSize = 0;
    this.clearAlgorithms();
    state.stream.errorInternal(error);
  }

  // -- Internal algorithms ------------------------------------------------

  /** ShouldCallPull. */
  get shouldCallPull(): boolean {
    const state = this.state;
    const streamState = state.stream.state;
    if (streamState.state !== 'readable' || state.closeRequested ||
      !state.started) {
      return false;
    }
    if (state.stream.hasDefaultReader &&
      state.stream.numReadRequests > 0) {
      return true;
    }
    if (state.stream.hasBYOBReader &&
      state.stream.numReadIntoRequests > 0) {
      return true;
    }
    return (this.desiredSize ?? 0) > 0;
  }

  get state(): ReadableByteStreamControllerState {
    if (!this.#state) {
      throw new Error('ReadableByteStreamController is not set up');
    }
    return this.#state;
  }

  set state(state: ReadableByteStreamControllerState) {
    this.#state = state;
  }

  /** [[CancelSteps]](reason). */
  cancel(reason: unknown): PromiseValue<unknown> {
    const state = this.state;
    this.clearPendingPullIntos();
    state.queue = [];
    state.queueTotalSize = 0;
    const result = requireAlgorithm(state.cancelAlgorithm, 'cancel')(reason);
    this.clearAlgorithms();
    return result;
  }

  /** [[PullSteps]](readRequest). */
  pull(request: ReadRequest): void {
    const state = this.state;
    if (!state.stream.hasDefaultReader) {
      throw new Error('Byte-stream default pull requires a default reader');
    }

    if (state.queueTotalSize > 0) {
      if (state.stream.numReadRequests !== 0) {
        throw new Error('Queued bytes cannot coexist with read requests');
      }
      this.fillReadRequestFromQueue(request);
      return;
    }

    const autoAllocateChunkSize = state.autoAllocateChunkSize;
    if (autoAllocateChunkSize !== undefined) {
      let buffer: ArrayBuffer;
      try {
        buffer = state.stream.runtime.buffers.allocateArrayBuffer(autoAllocateChunkSize);
      } catch (error) {
        request.errorSteps(error);
        return;
      }
      state.pendingPullIntos.push({
        buffer,
        bufferByteLength: autoAllocateChunkSize,
        byteLength: autoAllocateChunkSize,
        byteOffset: 0,
        bytesFilled: 0,
        elementSize: 1,
        minimumFill: 1,
        readerType: 'default',
        viewType: 'Uint8Array',
      });
    }

    state.stream.addReadRequest(request);
    this.callPullIfNeeded();
  }

  /** [[ReleaseSteps]](). */
  release(): void {
    const state = this.state;
    if (state.pendingPullIntos.length === 0) return;
    const first = state.pendingPullIntos[0];
    if (!first) return;
    first.readerType = 'none';
    state.pendingPullIntos = [first];
  }

  /** SetUpReadableByteStreamController. */
  setUp(
    stream: ReadableStreamImpl,
    startAlgorithm: () => unknown,
    pullAlgorithm: () => PromiseValue<unknown>,
    cancelAlgorithm: (reason: unknown) => PromiseValue<unknown>,
    highWaterMark: number,
    autoAllocateChunkSize: number | undefined,
  ): void {
    if (stream.state.controller) {
      throw new Error('ReadableStream already has a controller');
    }
    const state: ReadableByteStreamControllerState = {
      autoAllocateChunkSize,
      byobRequest: null,
      cancelAlgorithm,
      closeRequested: false,
      pendingPullIntos: [],
      pullAgain: false,
      pullAlgorithm,
      pulling: false,
      queue: [],
      queueTotalSize: 0,
      started: false,
      strategyHighWaterMark: highWaterMark,
      stream,
    };
    this.state = state;
    stream.state.controller = this;

    void stream.runtime.promises.resolve(startAlgorithm()).then(() => {
      state.started = true;
      this.callPullIfNeeded();
    }, (error) => {
      this.error(error);
    });
  }

  /** ReadableByteStreamControllerCallPullIfNeeded. */
  callPullIfNeeded(): void {
    if (!this.shouldCallPull) return;
    const state = this.state;
    if (state.pulling) {
      state.pullAgain = true;
      return;
    }

    state.pulling = true;
    const promise = requireAlgorithm(state.pullAlgorithm, 'pull')();
    void promise.then(() => {
      state.pulling = false;
      if (state.pullAgain) {
        state.pullAgain = false;
        this.callPullIfNeeded();
      }
    }, (error) => {
      this.error(error);
    });
  }

  /** ReadableByteStreamControllerClearAlgorithms. */
  clearAlgorithms(): void {
    const state = this.state;
    state.pullAlgorithm = undefined;
    state.cancelAlgorithm = undefined;
  }

  /** ReadableByteStreamControllerClearPendingPullIntos. */
  clearPendingPullIntos(): void {
    this.invalidateBYOBRequest();
    this.state.pendingPullIntos = [];
  }

  /** ReadableByteStreamControllerClose. */
  closeInternal(): void {
    const state = this.state;
    const streamState = state.stream.state;
    if (state.closeRequested || streamState.state !== 'readable') return;
    if (state.queueTotalSize > 0) {
      state.closeRequested = true;
      return;
    }

    const first = state.pendingPullIntos[0];
    if (first && first.bytesFilled % first.elementSize !== 0) {
      const error = new TypeError(
        'Insufficient bytes to fill elements in the supplied buffer',
      );
      this.error(error);
      throw error;
    }
    this.clearAlgorithms();
    state.stream.closeInternal();
  }

  /** ReadableByteStreamControllerEnqueue. */
  enqueueInternal(chunk: object): void {
    const state = this.state;
    const streamState = state.stream.state;
    if (state.closeRequested || streamState.state !== 'readable') return;

    const buffer = getBufferSourceUnderlyingBuffer(chunk);
    const byteOffset = getBufferSourceByteOffset(chunk);
    const byteLength = getBufferSourceByteLength(chunk);
    if (isBufferSourceDetached(buffer)) {
      throw new TypeError(
        'chunk\'s buffer is detached',
      );
    }
    const transferredBuffer = state.stream.runtime.buffers.transferArrayBuffer(buffer as ArrayBuffer);
    const first = state.pendingPullIntos[0];
    if (first) {
      if (isBufferSourceDetached(first.buffer)) {
        throw new TypeError(
          'The BYOB request\'s buffer is detached',
        );
      }
      this.invalidateBYOBRequest();
      first.buffer = state.stream.runtime.buffers.transferArrayBuffer(first.buffer);
      if (first.readerType === 'none') {
        this.enqueueDetachedPullIntoToQueue(first);
      }
    }

    if (state.stream.hasDefaultReader) {
      this.processReadRequestsUsingQueue();
      if (state.stream.numReadRequests === 0) {
        assert(state.pendingPullIntos.length === 0);
        this.enqueueChunkToQueue(transferredBuffer, byteOffset, byteLength);
      } else {
        assert(state.queue.length === 0);
        if (state.pendingPullIntos.length > 0) this.shiftPendingPullInto();
        const view = state.stream.runtime.buffers.createView(
          'Uint8Array',
          transferredBuffer,
          byteOffset,
          byteLength,
        );
        state.stream.fulfillReadRequest(view, false);
      }
    } else if (state.stream.hasBYOBReader) {
      this.enqueueChunkToQueue(transferredBuffer, byteOffset, byteLength);
      for (const descriptor of this.processPullIntosUsingQueue()) {
        state.stream.commitPullIntoDescriptor(descriptor);
      }
    } else {
      this.enqueueChunkToQueue(transferredBuffer, byteOffset, byteLength);
    }
    this.callPullIfNeeded();
  }

  /** ReadableByteStreamControllerFillReadRequestFromQueue. */
  fillReadRequestFromQueue(request: ReadRequest): void {
    const state = this.state;
    assert(state.queueTotalSize > 0);
    const entry = state.queue.shift();
    assert(entry !== undefined);
    state.queueTotalSize -= entry.byteLength;
    this.handleQueueDrain();

    const view = state.stream.runtime.buffers.createView(
      'Uint8Array',
      entry.buffer,
      entry.byteOffset,
      entry.byteLength,
    );
    request.chunkSteps(view);
  }

  /** ReadableByteStreamControllerPullInto. */
  pullInto(view: object, minimum: number, request: ReadIntoRequest): void {
    const state = this.state;
    const viewType = requireBufferViewType(view);
    const elementSize = getArrayBufferViewElementSize(viewType);
    const minimumFill = minimum * elementSize;
    const byteOffset = getBufferSourceByteOffset(view);
    const byteLength = getBufferSourceByteLength(view);
    const originalBuffer = getBufferSourceUnderlyingBuffer(view);
    const bufferByteLength = getBufferSourceByteLength(originalBuffer);
    let buffer: ArrayBuffer;
    try {
      buffer = state.stream.runtime.buffers.transferArrayBuffer(originalBuffer as ArrayBuffer);
    } catch (error) {
      request.errorSteps(error);
      return;
    }
    const descriptor: PullIntoDescriptor = {
      buffer,
      bufferByteLength,
      byteLength,
      byteOffset,
      bytesFilled: 0,
      elementSize,
      minimumFill,
      readerType: 'byob',
      viewType,
    };

    if (state.pendingPullIntos.length > 0) {
      state.pendingPullIntos.push(descriptor);
      state.stream.addReadIntoRequest(request);
      return;
    }
    if (state.stream.state.state === 'closed') {
      request.closeSteps(state.stream.runtime.buffers.createView(viewType, buffer, byteOffset, 0));
      return;
    }
    if (state.queueTotalSize > 0) {
      if (this.fillPullIntoFromQueue(descriptor)) {
        const filled = convertPullIntoDescriptor(descriptor, state.stream.runtime);
        this.handleQueueDrain();
        request.chunkSteps(filled);
        return;
      }
      if (state.closeRequested) {
        const error = new TypeError(
          'Insufficient bytes to fill elements in the supplied buffer',
        );
        this.error(error);
        request.errorSteps(error);
        return;
      }
    }

    state.pendingPullIntos.push(descriptor);
    state.stream.addReadIntoRequest(request);
    this.callPullIfNeeded();
  }

  /** ReadableByteStreamControllerRespond. */
  respond(bytesWritten: number): void {
    const state = this.state;
    const first = state.pendingPullIntos[0];
    assert(first !== undefined);
    const streamState = state.stream.state.state;
    if (streamState === 'closed') {
      if (bytesWritten !== 0) {
        throw new TypeError(
          'bytesWritten must be 0 for a closed stream',
        );
      }
    } else {
      assert(streamState === 'readable');
      if (bytesWritten === 0) {
        throw new TypeError(
          'bytesWritten must be greater than 0',
        );
      }
      if (first.bytesFilled + bytesWritten > first.byteLength) {
        throw new RangeError(
          'bytesWritten is out of range',
        );
      }
    }
    first.buffer = state.stream.runtime.buffers.transferArrayBuffer(first.buffer);
    this.respondInternal(bytesWritten);
  }

  /** ReadableByteStreamControllerRespondWithNewView. */
  respondWithNewView(view: object): void {
    const state = this.state;
    const first = state.pendingPullIntos[0];
    assert(first !== undefined);
    assert(!isBufferSourceDetached(getBufferSourceUnderlyingBuffer(view)));
    const viewByteLength = getBufferSourceByteLength(view);
    const streamState = state.stream.state.state;
    if (streamState === 'closed') {
      if (viewByteLength !== 0) {
        throw new TypeError(
          'The view must be empty for a closed stream',
        );
      }
    } else {
      assert(streamState === 'readable');
      if (viewByteLength === 0) {
        throw new TypeError(
          'The view must not be empty',
        );
      }
    }
    if (first.byteOffset + first.bytesFilled !==
      getBufferSourceByteOffset(view)) {
      throw new RangeError(
        'The view region does not match the BYOB request',
      );
    }
    const viewBuffer = getBufferSourceUnderlyingBuffer(view);
    if (first.bufferByteLength !== getBufferSourceByteLength(viewBuffer)) {
      throw new RangeError(
        'The view buffer has a different capacity',
      );
    }
    if (first.bytesFilled + viewByteLength > first.byteLength) {
      throw new RangeError(
        'The view region is larger than the BYOB request',
      );
    }
    first.buffer = state.stream.runtime.buffers.transferArrayBuffer(viewBuffer as ArrayBuffer);
    this.respondInternal(viewByteLength);
  }

  /** EnqueueChunkToQueue. */
  enqueueChunkToQueue(buffer: ArrayBuffer, byteOffset: number, byteLength: number): void {
    const state = this.state;
    state.queue.push({ buffer, byteLength, byteOffset });
    state.queueTotalSize += byteLength;
  }

  /** EnqueueClonedChunkToQueue. */
  enqueueClonedChunkToQueue(buffer: ArrayBuffer, byteOffset: number, byteLength: number): void {
    const { runtime } = this.state.stream;
    let clone: ArrayBuffer;
    try {
      const bytes = runtime.buffers.createView('Uint8Array', buffer, byteOffset, byteLength);
      clone = runtime.buffers.copyArrayBuffer(bytes);
    } catch (error) {
      this.error(error);
      throw error;
    }
    this.enqueueChunkToQueue(clone, 0, byteLength);
  }

  /** EnqueueDetachedPullIntoToQueue. */
  enqueueDetachedPullIntoToQueue(descriptor: PullIntoDescriptor): void {
    assert(descriptor.readerType === 'none');
    if (descriptor.bytesFilled > 0) {
      this.enqueueClonedChunkToQueue(
        descriptor.buffer,
        descriptor.byteOffset,
        descriptor.bytesFilled,
      );
    }
    this.shiftPendingPullInto();
  }

  /** FillPullIntoFromQueue. */
  fillPullIntoFromQueue(descriptor: PullIntoDescriptor): boolean {
    const state = this.state;
    const maxToCopy = Math.min(
      state.queueTotalSize,
      descriptor.byteLength - descriptor.bytesFilled,
    );
    const maxFilled = descriptor.bytesFilled + maxToCopy;
    let remaining = maxToCopy;
    const remainder = maxFilled % descriptor.elementSize;
    const maxAligned = maxFilled - remainder;
    let ready = false;
    if (maxAligned >= descriptor.minimumFill) {
      remaining = maxAligned - descriptor.bytesFilled;
      ready = true;
    }

    while (remaining > 0) {
      const head = state.queue[0];
      assert(head !== undefined);
      const count = Math.min(remaining, head.byteLength);
      assert(canCopyDataBlockBytes(
        descriptor.buffer,
        descriptor.byteOffset + descriptor.bytesFilled,
        head.buffer,
        head.byteOffset,
        count,
      ));
      copyDataBlockBytes(
        descriptor.buffer,
        descriptor.byteOffset + descriptor.bytesFilled,
        head.buffer,
        head.byteOffset,
        count,
      );
      if (head.byteLength === count) {
        state.queue.shift();
      } else {
        head.byteOffset += count;
        head.byteLength -= count;
      }
      state.queueTotalSize -= count;
      this.#fillHeadPullInto(count, descriptor);
      remaining -= count;
    }
    return ready;
  }

  /** HandleQueueDrain. */
  handleQueueDrain(): void {
    const state = this.state;
    if (state.queueTotalSize === 0 && state.closeRequested) {
      this.clearAlgorithms();
      state.stream.closeInternal();
    } else {
      this.callPullIfNeeded();
    }
  }

  /** InvalidateBYOBRequest. */
  invalidateBYOBRequest(): void {
    const state = this.state;
    if (!state.byobRequest) return;
    state.byobRequest.invalidate();
    state.byobRequest = null;
  }

  /** ProcessPullIntosUsingQueue. */
  processPullIntosUsingQueue(): PullIntoDescriptor[] {
    const state = this.state;
    const filled: PullIntoDescriptor[] = [];
    while (state.pendingPullIntos.length > 0 && state.queueTotalSize > 0) {
      const descriptor = state.pendingPullIntos[0];
      assert(descriptor !== undefined && descriptor.readerType !== 'none');
      if (!this.fillPullIntoFromQueue(descriptor)) break;
      this.shiftPendingPullInto();
      filled.push(descriptor);
    }
    return filled;
  }

  /** ProcessReadRequestsUsingQueue. */
  processReadRequestsUsingQueue(): void {
    const state = this.state;
    const reader = state.stream.state.reader;
    assert(ReadableStreamDefaultReaderImpl.is(reader));
    while (reader.readRequests.length > 0) {
      if (state.queueTotalSize === 0) return;
      const request = reader.readRequests.shift();
      assert(request !== undefined);
      this.fillReadRequestFromQueue(request);
    }
  }

  /** RespondInternal. */
  respondInternal(bytesWritten: number): void {
    const state = this.state;
    const first = state.pendingPullIntos[0];
    assert(first !== undefined);
    assert(!isBufferSourceDetached(first.buffer));
    this.invalidateBYOBRequest();
    const streamState = state.stream.state.state;
    if (streamState === 'closed') {
      this.respondInClosedState(first);
    } else {
      assert(streamState === 'readable' && bytesWritten > 0);
      this.respondInReadableState(bytesWritten, first);
    }
    this.callPullIfNeeded();
  }

  /** RespondInClosedState. */
  respondInClosedState(first: PullIntoDescriptor): void {
    const state = this.state;
    assert(first.bytesFilled % first.elementSize === 0);
    if (first.readerType === 'none') this.shiftPendingPullInto();
    if (!state.stream.hasBYOBReader) return;

    const filled: PullIntoDescriptor[] = [];
    while (filled.length < state.stream.numReadIntoRequests) {
      filled.push(this.shiftPendingPullInto());
    }
    for (const descriptor of filled) {
      state.stream.commitPullIntoDescriptor(descriptor);
    }
  }

  /** RespondInReadableState. */
  respondInReadableState(bytesWritten: number, descriptor: PullIntoDescriptor): void {
    const state = this.state;
    this.#fillHeadPullInto(bytesWritten, descriptor);
    if (descriptor.readerType === 'none') {
      this.enqueueDetachedPullIntoToQueue(descriptor);
      for (const filled of this.processPullIntosUsingQueue()) {
        state.stream.commitPullIntoDescriptor(filled);
      }
      return;
    }
    if (descriptor.bytesFilled < descriptor.minimumFill) return;

    this.shiftPendingPullInto();
    const remainder = descriptor.bytesFilled % descriptor.elementSize;
    if (remainder > 0) {
      const end = descriptor.byteOffset + descriptor.bytesFilled;
      this.enqueueClonedChunkToQueue(descriptor.buffer, end - remainder, remainder);
    }
    descriptor.bytesFilled -= remainder;
    const filled = this.processPullIntosUsingQueue();
    state.stream.commitPullIntoDescriptor(descriptor);
    for (const pending of filled) {
      state.stream.commitPullIntoDescriptor(pending);
    }
  }

  /** ShiftPendingPullInto. */
  shiftPendingPullInto(): PullIntoDescriptor {
    const state = this.state;
    assert(state.byobRequest === null);
    const descriptor = state.pendingPullIntos.shift();
    assert(descriptor !== undefined);
    return descriptor;
  }

  /** ReadableByteStreamControllerFillHeadPullIntoDescriptor. */
  #fillHeadPullInto(size: number, descriptor: PullIntoDescriptor): void {
    const state = this.state;
    assert(state.pendingPullIntos.length === 0 || state.pendingPullIntos[0] === descriptor);
    assert(state.byobRequest === null);
    descriptor.bytesFilled += size;
  }
}

type ReadableByteStreamControllerState = {
  autoAllocateChunkSize?: number;
  byobRequest: ReadableStreamBYOBRequestImpl | null;
  cancelAlgorithm?: (reason: unknown) => PromiseValue<unknown>;
  closeRequested: boolean;
  pendingPullIntos: PullIntoDescriptor[];
  pullAgain: boolean;
  pullAlgorithm?: () => PromiseValue<unknown>;
  pulling: boolean;
  queue: ByteQueueEntry[];
  queueTotalSize: number;
  started: boolean;
  strategyHighWaterMark: number;
  stream: ReadableStreamImpl;
};

type ByteQueueEntry = {
  buffer: ArrayBuffer;
  byteLength: number;
  byteOffset: number;
};

type PullIntoDescriptor = {
  buffer: ArrayBuffer;
  bufferByteLength: number;
  byteLength: number;
  byteOffset: number;
  bytesFilled: number;
  elementSize: number;
  minimumFill: number;
  readerType: 'byob' | 'default' | 'none';
  viewType: JSBufferViewName;
};

export const readableByteStreamControllerIDL = defineInterface({
  name: 'ReadableByteStreamController',
  exposed: '*',
  implementation: impl(ReadableByteStreamControllerImpl),
  members: [
    roAttr('byobRequest', nullable(reference('ReadableStreamBYOBRequest'))),
    roAttr('desiredSize', nullable(idlType.unrestrictedDouble)),
    op('close', idlType.undefined),
    op('enqueue', idlType.undefined, [
      arg('chunk', reference('ArrayBufferView')),
    ]),
    op('error', idlType.undefined, [
      arg('e', idlType.any, { optional: true }),
    ]),
  ],
});

// =============================================================================
// ReadableStreamGenericReaderMixin
// =============================================================================

/*
 * interface mixin ReadableStreamGenericReader {
 *   readonly attribute Promise<undefined> closed;
 *
 *   Promise<undefined> cancel(optional any reason);
 * };
 */
export class ReadableStreamGenericReaderMixin {
  #state?: ReadableStreamGenericReaderState;

  /** Streams §4.3.3, closed getter. */
  get closed(): PromiseValue<void> {
    return this.state.closedPromise.promise;
  }

  /** Streams §4.3.3, cancel(reason). */
  cancel(reason?: unknown): PromiseValue<void> {
    const state = this.state;
    if (!state.stream) {
      return state.promises.reject(new TypeError(
        'Cannot cancel a stream using a released reader',
      ));
    }
    return this.cancelInternal(reason);
  }

  // -- Internal algorithms ------------------------------------------------

  get state(): ReadableStreamGenericReaderState {
    if (!this.#state) {
      throw new Error('ReadableStreamGenericReader is not set up');
    }
    return this.#state;
  }

  set state(state: ReadableStreamGenericReaderState) {
    this.#state = state;
  }

  /** Streams §4.9.3, ReadableStreamReaderGenericCancel. */
  cancelInternal(reason: unknown): PromiseValue<void> {
    const stream = this.state.stream;
    if (!stream) throw new Error('Cannot cancel through a released reader');
    return stream.cancelInternal(reason);
  }

  /** ReadableStreamReaderGenericInitialize. */
  initialize(
    reader: NonNullable<ReadableStreamState['reader']>,
    stream: ReadableStreamImpl,
  ): void {
    const streamState = stream.state;
    const closedPromise = stream.runtime.promises.withResolvers<void>();
    if (streamState.state === 'closed') closedPromise.resolve();
    if (streamState.state === 'errored') {
      closedPromise.reject(streamState.storedError);
      void closedPromise.promise.then(undefined, () => {});
    }

    this.state = { closedPromise, stream, promises: stream.runtime.promises };
    streamState.reader = reader;
  }

  /** ReadableStreamReaderGenericRelease. */
  release(reader: NonNullable<ReadableStreamState['reader']>): void {
    const genericState = this.state;
    const stream = genericState.stream;
    if (!stream) throw new Error('Cannot release an already released reader');

    const streamState = stream.state;
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

    stream.controller.release();
    streamState.reader = undefined;
    genericState.stream = undefined;
  }
}

type ReadableStreamGenericReaderState = {
  readonly promises: Promises;
  closedPromise: PromiseValueCapability<void>;
  stream?: ReadableStreamImpl;
};

// -- Web IDL ------------------------------------------------------------

export const readableStreamGenericReaderIDL = defineInterfaceMixin({
  name: 'ReadableStreamGenericReader',
  members: [
    roAttr('closed', promise(idlType.undefined)),
    op('cancel', promise(idlType.undefined), [
      arg('reason', idlType.any, { optional: true }),
    ]),
  ],
});

// =============================================================================
// ReadableStreamDefaultReader
// =============================================================================

/*
 * [Exposed=*]
 * interface ReadableStreamDefaultReader {
 *   constructor(ReadableStream stream);
 *
 *   Promise<ReadableStreamReadResult> read();
 *   undefined releaseLock();
 * };
 * ReadableStreamDefaultReader includes ReadableStreamGenericReader;
 */
export class ReadableStreamDefaultReaderImpl {
  readonly #genericReader: ReadableStreamGenericReaderMixin;
  #readRequests: ReadRequest[] = [];

  /**
   * Streams §4.4.3, ReadableStreamDefaultReader(stream).
   * Internal allocation may omit the stream and call setUp separately.
   */
  constructor(
    stream?: ReadableStreamImpl,
  ) {
    this.#genericReader = new ReadableStreamGenericReaderMixin();
    if (stream) this.setUp(stream);
  }

  static is(value: unknown): value is ReadableStreamDefaultReaderImpl {
    return typeof value === 'object' && value !== null && #genericReader in value;
  }

  /** Streams §4.3.3, closed getter (ReadableStreamGenericReader). */
  get closed(): PromiseValue<void> {
    return this.genericReaderMixin.closed;
  }

  /** Streams §4.3.3, cancel(reason) (ReadableStreamGenericReader). */
  cancel(reason?: unknown): PromiseValue<void> {
    return this.genericReaderMixin.cancel(reason);
  }

  /** Streams §4.4.3, read(). */
  read(): PromiseValue<ReadableStreamReadResult> {
    const generic = this.genericReaderMixin;
    const state = generic.state;
    const promise = state.promises.withResolvers<ReadableStreamReadResult>();
    if (!state.stream) {
      promise.reject(new TypeError(
        'Cannot read from a stream using a released reader',
      ));
      return promise.promise;
    }

    this.readChunk({
      chunkSteps(chunk) {
        promise.resolve({ value: chunk, done: false });
      },
      closeSteps() {
        promise.resolve({ value: undefined, done: true });
      },
      errorSteps(reason) {
        promise.reject(reason);
      },
    });
    return promise.promise;
  }

  releaseLock(): void {
    const generic = this.genericReaderMixin;
    if (!generic.state.stream) return;
    this.release();
  }

  // -- Internal algorithms ------------------------------------------------

  get genericReaderMixin(): ReadableStreamGenericReaderMixin {
    return this.#genericReader;
  }

  get readRequests(): ReadRequest[] {
    return this.#readRequests;
  }

  /** SetUpReadableStreamDefaultReader. */
  setUp(stream: ReadableStreamImpl): void {
    if (stream.locked) {
      throw new TypeError(
        'This stream has already been locked for exclusive reading by another reader',
      );
    }

    const generic = this.genericReaderMixin;
    generic.initialize(this, stream);
    this.resetReadRequests();
  }

  /** ReadableStreamDefaultReaderRead. */
  readChunk(request: ReadRequest): void {
    const generic = this.genericReaderMixin;
    const stream = generic.state.stream;
    if (!stream) throw new Error('Cannot read through a released reader');

    const streamState = stream.state;
    streamState.disturbed = true;
    if (streamState.state === 'closed') {
      request.closeSteps();
    } else if (streamState.state === 'errored') {
      request.errorSteps(streamState.storedError);
    } else {
      stream.controller.pull(request);
    }
  }

  /** ReadableStreamDefaultReaderRelease. */
  release(): void {
    const generic = this.genericReaderMixin;
    generic.release(this);

    this.errorReadRequests(new TypeError('Reader was released'));
  }

  /** ReadableStreamDefaultReaderErrorReadRequests. */
  errorReadRequests(error: unknown): void {
    const requests = this.readRequests;
    this.resetReadRequests();
    for (const request of requests) request.errorSteps(error);
  }

  /** Streams §9.1.2, read all bytes from a default reader. */
  readAllBytes(
    successSteps: (bytes: Uint8Array) => void,
    failureSteps: (reason: unknown) => void,
  ): void {
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    let reading = false;
    let readAgain = false;

    const request = {
      chunkSteps: (chunk: unknown) => {
        let bytes: Uint8Array;
        try {
          if (
            typeof chunk !== 'object' || chunk === null ||
            getBufferTypeName(chunk) !== 'Uint8Array'
          ) {
            failureSteps(new TypeError(
              'A byte stream produced a non-Uint8Array chunk',
            ));
            return;
          }
          bytes = getBufferSourceCopy(chunk);
          if (bytes.length > Number.MAX_SAFE_INTEGER - byteLength) {
            throw new RangeError(
              'Readable stream byte length is too large',
            );
          }
        } catch (error) {
          failureSteps(error);
          return;
        }
        chunks.push(bytes);
        byteLength += bytes.length;
        readLoop();
      },
      closeSteps: () => {
        const bytes = new Uint8Array(byteLength);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        successSteps(bytes);
      },
      errorSteps: failureSteps,
    };

    /** Streams §9.1.2, read-loop; its arguments are retained by this closure. */
    const readLoop = (): void => {
      readAgain = true;
      if (reading) return;
      reading = true;
      try {
        // The Streams note permits an iterative drain to avoid stack growth.
        // A synchronous chunk requests another pass; a later chunk restarts it.
        while (readAgain) {
          readAgain = false;
          this.readChunk(request);
        }
      } finally {
        reading = false;
      }
    };

    readLoop();
  }

  /** Streams §9.1.2, cancel through a default reader. */
  cancelInternal(reason: unknown): PromiseValue<void> {
    return this.genericReaderMixin.cancelInternal(reason);
  }

  resetReadRequests(): void {
    this.#readRequests = [];
  }
}

/*
 * dictionary ReadableStreamReadResult {
 *   any value;
 *   boolean done;
 * };
 */
export type ReadableStreamReadResult = {
  value: unknown;
  done: boolean;
};

export type ReadRequest = {
  chunkSteps(chunk: unknown): void;
  closeSteps(): void;
  errorSteps(reason: unknown): void;
};

// -- Web IDL ------------------------------------------------------------

export const readableStreamDefaultReaderIDL = defineInterface({
  name: 'ReadableStreamDefaultReader',
  exposed: '*',
  implementation: impl(ReadableStreamDefaultReaderImpl),
  members: [
    ctor([arg('stream', reference('ReadableStream'))]),
    op('read', promise(reference('ReadableStreamReadResult'))),
    op('releaseLock', idlType.undefined),
  ],
});

export const readableStreamDefaultReaderIncludesGenericReaderIDL =
  defineIncludes({
    interface: 'ReadableStreamDefaultReader',
    mixin: 'ReadableStreamGenericReader',
  });

export const readableStreamReadResultIDL = defineDictionary({
  name: 'ReadableStreamReadResult',
  members: [
    dictMember('value', idlType.any),
    dictMember('done', idlType.boolean),
  ],
});

// =============================================================================
// ReadableStreamBYOBReader
// =============================================================================

/*
 * [Exposed=*]
 * interface ReadableStreamBYOBReader {
 *   constructor(ReadableStream stream);
 *
 *   Promise<ReadableStreamReadResult> read(ArrayBufferView view, optional ReadableStreamBYOBReaderReadOptions options = {});
 *   undefined releaseLock();
 * };
 * ReadableStreamBYOBReader includes ReadableStreamGenericReader;
 */
export class ReadableStreamBYOBReaderImpl {
  readonly #genericReader: ReadableStreamGenericReaderMixin;
  #readIntoRequests: ReadIntoRequest[] = [];

  /**
   * Streams §4.5.3, ReadableStreamBYOBReader(stream).
   * Internal allocation may omit the stream and call setUp separately.
   */
  constructor(stream?: ReadableStreamImpl) {
    this.#genericReader = new ReadableStreamGenericReaderMixin();
    if (stream) this.setUp(stream);
  }

  static is(value: unknown): value is ReadableStreamBYOBReaderImpl {
    return typeof value === 'object' && value !== null && #genericReader in value;
  }

  /** Streams §4.3.3, closed getter (ReadableStreamGenericReader). */
  get closed(): PromiseValue<void> {
    return this.genericReaderMixin.closed;
  }

  /** Streams §4.3.3, cancel(reason) (ReadableStreamGenericReader). */
  cancel(reason?: unknown): PromiseValue<void> {
    return this.genericReaderMixin.cancel(reason);
  }

  /** Streams §4.5.3, read(view, options). */
  read(
    view: ArrayBufferView,
    options: ReadableStreamBYOBReaderReadOptions,
  ): PromiseValue<ReadableStreamReadResult> {
    const generic = this.genericReaderMixin;
    const state = generic.state;
    const viewByteLength = getBufferSourceByteLength(view);
    const buffer = getBufferSourceUnderlyingBuffer(view);
    if (viewByteLength === 0) {
      return state.promises.reject(new TypeError('view must have non-zero byteLength'));
    }
    if (getBufferSourceByteLength(buffer) === 0) {
      return state.promises.reject(new TypeError(
        'view\'s buffer must have non-zero byteLength',
      ));
    }
    if (isBufferSourceDetached(buffer)) {
      return state.promises.reject(new TypeError('view\'s buffer is detached'));
    }
    if (options.min === 0) {
      return state.promises.reject(new TypeError('options.min must be greater than 0'));
    }

    const type = requireBufferViewType(view);
    const elementSize = getArrayBufferViewElementSize(type);
    const viewLength = type === 'DataView'
      ? viewByteLength
      : viewByteLength / elementSize;
    if (options.min > viewLength) {
      return state.promises.reject(new RangeError(
        `options.min must not exceed the view's ${
            type === 'DataView' ? 'byteLength' : 'length'
        }`,
      ));
    }
    if (!state.stream) {
      return state.promises.reject(new TypeError(
        'Cannot read from a stream using a released reader',
      ));
    }

    const promise = state.promises.withResolvers<ReadableStreamReadResult>();
    this.readInto(
      view,
      options.min,
      {
        chunkSteps: (chunk) => promise.resolve({ value: chunk, done: false }),
        closeSteps: (chunk) => promise.resolve({ value: chunk, done: true }),
        errorSteps: (reason) => promise.reject(reason),
      },
    );
    return promise.promise;
  }

  releaseLock(): void {
    const generic = this.genericReaderMixin;
    if (!generic.state.stream) return;
    this.release();
  }

  // -- Internal algorithms ------------------------------------------------

  get genericReaderMixin(): ReadableStreamGenericReaderMixin {
    return this.#genericReader;
  }

  get readIntoRequests(): ReadIntoRequest[] {
    return this.#readIntoRequests;
  }

  /** SetUpReadableStreamBYOBReader. */
  setUp(stream: ReadableStreamImpl): void {
    if (stream.locked) {
      throw new TypeError(
        'This stream has already been locked for exclusive reading',
      );
    }
    if (!ReadableByteStreamControllerImpl.is(
      stream.state.controller,
    )) {
      throw new TypeError(
        'A BYOB reader requires a stream constructed with a byte source',
      );
    }

    const generic = this.genericReaderMixin;
    generic.initialize(this, stream);
    this.resetReadIntoRequests();
  }

  /** ReadableStreamBYOBReaderRead. */
  readInto(view: object, minimum: number, request: ReadIntoRequest): void {
    const generic = this.genericReaderMixin;
    const stream = generic.state.stream;
    if (!stream) throw new Error('Cannot read through a released BYOB reader');

    const streamState = stream.state;
    streamState.disturbed = true;
    if (streamState.state === 'errored') {
      request.errorSteps(streamState.storedError);
      return;
    }
    const controller = streamState.controller;
    if (!ReadableByteStreamControllerImpl.is(controller)) {
      throw new Error('BYOB reader is attached to a non-byte stream');
    }
    controller.pullInto(view, minimum, request);
  }

  /** ReadableStreamBYOBReaderRelease. */
  release(): void {
    const generic = this.genericReaderMixin;
    generic.release(this);
    this.errorReadIntoRequests(new TypeError('Reader was released'));
  }

  /** ErrorReadIntoRequests. */
  errorReadIntoRequests(error: unknown): void {
    const requests = this.readIntoRequests;
    this.resetReadIntoRequests();
    for (const request of requests) request.errorSteps(error);
  }

  resetReadIntoRequests(): void {
    this.#readIntoRequests = [];
  }
}

export type ReadIntoRequest = {
  chunkSteps(chunk: object): void;
  closeSteps(chunk: object | undefined): void;
  errorSteps(reason: unknown): void;
};

/*
 * dictionary ReadableStreamBYOBReaderReadOptions {
 *   [EnforceRange] unsigned long long min = 1;
 * };
 */
export type ReadableStreamBYOBReaderReadOptions = {
  readonly min: number;
};

export const readableStreamBYOBReaderIDL = defineInterface({
  name: 'ReadableStreamBYOBReader',
  exposed: '*',
  implementation: impl(ReadableStreamBYOBReaderImpl),
  members: [
    ctor([arg('stream', reference('ReadableStream'))]),
    op('read', promise(reference('ReadableStreamReadResult')), [
      arg('view', reference('ArrayBufferView')),
      arg('options', reference('ReadableStreamBYOBReaderReadOptions'), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
    op('releaseLock', idlType.undefined),
  ],
});

export const readableStreamBYOBReaderIncludesGenericReaderIDL =
  defineIncludes({
    interface: 'ReadableStreamBYOBReader',
    mixin: 'ReadableStreamGenericReader',
  });

export const readableStreamBYOBReaderReadOptionsIDL = defineDictionary({
  name: 'ReadableStreamBYOBReaderReadOptions',
  members: [dictMember('min', idlType.unsignedLongLong, {
    default: integer(1),
    ...xattr('EnforceRange'),
  })],
});

// =============================================================================
// ReadableStreamBYOBRequest
// =============================================================================

/*
 * [Exposed=*]
 * interface ReadableStreamBYOBRequest {
 *   readonly attribute Uint8Array? view;
 *
 *   undefined respond([EnforceRange] unsigned long long bytesWritten);
 *   undefined respondWithNewView(ArrayBufferView view);
 * };
 */
export class ReadableStreamBYOBRequestImpl {
  #controller?: ReadableByteStreamControllerImpl;
  #view?: object;

  get view(): object | null {
    return this.#view ?? null;
  }

  respond(bytesWritten: number): void {
    if (!this.#controller || !this.#view) {
      throw new TypeError(
        'This BYOB request has been invalidated',
      );
    }
    if (isBufferSourceDetached(this.#view)) {
      throw new TypeError(
        'The BYOB request\'s buffer has been detached and cannot be used',
      );
    }
    this.#controller.respond(bytesWritten);
  }

  respondWithNewView(view: object): void {
    if (!this.#controller) {
      throw new TypeError(
        'This BYOB request has been invalidated',
      );
    }
    if (isBufferSourceDetached(view)) {
      throw new TypeError(
        'The supplied view has a detached buffer',
      );
    }
    this.#controller.respondWithNewView(view);
  }

  // -- Internal algorithms ------------------------------------------------

  initialize(controller: ReadableByteStreamControllerImpl, view: object): void {
    this.#controller = controller;
    this.#view = view;
  }

  invalidate(): void {
    this.#controller = undefined;
    this.#view = undefined;
  }
}

export const readableStreamBYOBRequestIDL = defineInterface({
  name: 'ReadableStreamBYOBRequest',
  exposed: '*',
  implementation: impl(ReadableStreamBYOBRequestImpl),
  members: [
    roAttr('view', nullable(idlType.Uint8Array)),
    op('respond', idlType.undefined, [
      arg('bytesWritten', idlType.unsignedLongLong, xattr('EnforceRange')),
    ]),
    op('respondWithNewView', idlType.undefined, [
      arg('view', reference('ArrayBufferView')),
    ]),
  ],
});

// =============================================================================
// Shared helpers
// =============================================================================

function requireAlgorithm<Algorithm>(
  algorithm: Algorithm | undefined,
  name: string,
): Algorithm {
  if (!algorithm) throw new Error(`Readable stream ${name} algorithm is gone`);
  return algorithm;
}

function requireBufferViewType(view: object): JSBufferViewName {
  const type = getBufferTypeName(view);
  if (!type || type === 'ArrayBuffer' || type === 'SharedArrayBuffer') {
    throw new Error('ArrayBuffer view has no recognized view type');
  }
  return type;
}

function convertPullIntoDescriptor(
  descriptor: PullIntoDescriptor,
  runtime: RuntimeContext,
): ArrayBufferView {
  assert(descriptor.bytesFilled <= descriptor.byteLength);
  assert(descriptor.bytesFilled % descriptor.elementSize === 0);
  descriptor.buffer = runtime.buffers.transferArrayBuffer(descriptor.buffer);
  return runtime.buffers.createView(
    descriptor.viewType,
    descriptor.buffer,
    descriptor.byteOffset,
    descriptor.bytesFilled / descriptor.elementSize,
  );
}

/** ECMAScript §6.2.9.3, CopyDataBlockBytes; copies between ArrayBuffer backing stores. */
function copyDataBlockBytes(
  destination: ArrayBuffer,
  destinationOffset: number,
  source: ArrayBuffer,
  sourceOffset: number,
  byteLength: number,
): void {
  writeArrayBuffer(
    destination,
    new Uint8Array(source, sourceOffset, byteLength),
    destinationOffset,
  );
}

function requireObject(value: unknown): object {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Readable byte stream produced a non-object chunk');
  }
  return value;
}

function assert(condition: unknown): asserts condition {
  if (!condition) throw new Error('Streams implementation invariant failed');
}

function isArrayBufferView(value: object): boolean {
  const name = getBufferTypeName(value);
  return name !== undefined &&
    name !== 'ArrayBuffer' &&
    name !== 'SharedArrayBuffer';
}

function cloneAsUint8Array(value: object, runtime: RuntimeContext): Uint8Array<ArrayBuffer> {
  const bytes = runtime.buffers.createView(
    'Uint8Array', getBufferSourceUnderlyingBuffer(value),
    getBufferSourceByteOffset(value), getBufferSourceByteLength(value),
  );
  return runtime.buffers.copyUint8Array(bytes);
}

function canCopyDataBlockBytes(
  destination: object,
  destinationOffset: number,
  source: object,
  sourceOffset: number,
  count: number,
): boolean {
  return destination !== source &&
    !isBufferSourceDetached(destination) &&
    !isBufferSourceDetached(source) &&
    destinationOffset + count <= getBufferSourceByteLength(destination) &&
    sourceOffset + count <= getBufferSourceByteLength(source);
}
