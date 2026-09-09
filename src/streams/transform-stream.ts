import {
  InternalPromise, createPromiseReactions, type InternalPromiseCapability, type PromiseReactions,
} from '../js-engine/internal-promise';
import {
  arg, atArg, callback, contextValue, ctor, defineCallbackFunction, defineDictionary,
  defineInterface, dictMember, emptyDictionary, idlType, impl, promise,
  roAttr, reference, xattr,
} from '../web-idl/declaration/index';
import { RangeError } from '../js-engine/simple-exception';
import { bind, type BindingContext } from '../web-idl/projection';
import type { StreamAbortController } from './abort';
import { convertStreamCallbacks, createStreamAbortController } from './integration';
import {
  extractHighWaterMark, extractSizeAlgorithm, type QueuingStrategy,
  type QueuingStrategySize,
} from './queuing-strategy';
import { ReadableStreamImpl } from './readable-stream';
import { ReadableStreamDefaultControllerImpl } from './readable-stream-default-controller';
import {
  createReadableStream, readableStreamDefaultControllerClose,
  readableStreamDefaultControllerError,
} from './readable-stream-operations';
import { TransformStreamDefaultControllerImpl } from './transform-stream-default-controller';
import { createWritableStream, type WritableStreamImpl } from './writable-stream';
import { writableStreamDefaultControllerErrorIfNeeded } from './writable-stream-operations';

/*
 * [Exposed=*, Transferable]
 * interface TransformStream {
 *   constructor(optional object transformer, optional QueuingStrategy writableStrategy = {}, optional QueuingStrategy readableStrategy = {});
 *   readonly attribute ReadableStream readable;
 *   readonly attribute WritableStream writable;
 * };
 */
export class TransformStreamImpl {
  readonly state: TransformStreamState = {};
  readonly #abortController: StreamAbortController;

  /** A null transformer allocates the implementation for a later setUp call. */
  // SPEC_MISMATCH: TransformStream(transformer?, writableStrategy = {}, readableStrategy = {}) -> TransformStream
  constructor(
    transformer: TransformerRecord | null = {},
    writableStrategy: QueuingStrategy = {},
    readableStrategy: QueuingStrategy = {},
    abortController: StreamAbortController,
    readonly reactions: PromiseReactions,
  ) {
    this.#abortController = abortController;
    if (transformer === null) return;

    const transformerDict = transformer;

    if (transformerDict.readableType !== undefined) {
      throw new RangeError('Invalid readableType specified');
    }
    if (transformerDict.writableType !== undefined) {
      throw new RangeError('Invalid writableType specified');
    }

    const readableHighWaterMark = extractHighWaterMark(readableStrategy, 0);
    const readableSizeAlgorithm = extractSizeAlgorithm(readableStrategy);
    const writableHighWaterMark = extractHighWaterMark(writableStrategy, 1);
    const writableSizeAlgorithm = extractSizeAlgorithm(writableStrategy);
    const start = InternalPromise.withResolvers<unknown>();
    this.#initialize(
      start.promise,
      writableHighWaterMark,
      writableSizeAlgorithm,
      readableHighWaterMark,
      readableSizeAlgorithm,
    );
    const controller = new TransformStreamDefaultControllerImpl();
    controller.setUpFromTransformer(this, transformer, transformerDict);

    const startResult = transformerDict.start
      ? Reflect.apply(transformerDict.start, transformer, [controller])
      : undefined;
    InternalPromise.resolve(startResult).observe(start.resolve, start.reject, this.reactions);
  }

  /** Streams §9.3, create an identity transform stream. */
  // SPEC_MISMATCH: create an identity TransformStream() -> TransformStream
  static createIdentity(abortController: StreamAbortController, reactions: PromiseReactions): TransformStreamImpl {
    const stream = new TransformStreamImpl(null, {}, {}, abortController, reactions);
    stream.setUp((chunk) => stream.enqueue(chunk));
    return stream;
  }

  get readable(): ReadableStreamImpl {
    return requireStateMember(this.state.readable, 'readable');
  }

  get writable(): WritableStreamImpl {
    return requireStateMember(this.state.writable, 'writable');
  }

  get readableController(): ReadableStreamDefaultControllerImpl {
    const { controller } = ReadableStreamImpl.getState(this.readable);
    if (!ReadableStreamDefaultControllerImpl.is(controller)) {
      throw new Error('TransformStream has no readable default controller');
    }
    return controller;
  }

  /** Streams §9.3, set up a newly-created transform stream. */
  setUp(
    transformAlgorithm: (chunk: unknown) => InternalPromise<unknown> | void,
    flushAlgorithm?: () => InternalPromise<unknown> | void,
    cancelAlgorithm?: (reason: unknown) => InternalPromise<unknown> | void,
  ): void {
    this.#initialize(
      InternalPromise.resolve(),
      1,
      () => 1,
      0,
      () => 1,
    );
    new TransformStreamDefaultControllerImpl().setUp(
      this,
      (chunk) => InternalPromise.try(() => transformAlgorithm(chunk)),
      () => InternalPromise.try(() => flushAlgorithm?.()),
      (reason) => InternalPromise.try(() => cancelAlgorithm?.(reason)),
    );
  }

  /** Streams §9.3, enqueue into a stream initialized by setUp. */
  enqueue(chunk: unknown): void {
    this.#controller.enqueue(chunk);
  }

  /** Streams §9.3, terminate a stream initialized by setUp. */
  terminate(): void {
    this.#controller.terminate();
  }

  /** Streams §9.3, error a stream initialized by setUp. */
  error(reason: unknown): void {
    readableStreamDefaultControllerError(this.readableController, reason);
    this.errorWritableAndUnblockWrite(reason);
  }

  errorWritableAndUnblockWrite(reason: unknown): void {
    this.#controller.clearAlgorithms();
    writableStreamDefaultControllerErrorIfNeeded(this.#writableController, reason);
    this.#unblockWrite();
  }

  setBackpressure(backpressure: boolean): void {
    if (this.state.backpressure === backpressure) {
      throw new Error('Transform stream backpressure did not change');
    }
    this.state.backpressureChange?.resolve();
    this.state.backpressureChange = InternalPromise.withResolvers<void>();
    this.state.backpressure = backpressure;
  }

  get #controller(): TransformStreamDefaultControllerImpl {
    return requireStateMember(this.state.controller, 'controller');
  }

  get #writableController() {
    return requireStateMember(this.writable.state.controller, 'writable controller');
  }

  #initialize(
    startPromise: InternalPromise<unknown>,
    writableHighWaterMark: number,
    writableSizeAlgorithm: QueuingStrategySize,
    readableHighWaterMark: number,
    readableSizeAlgorithm: QueuingStrategySize,
  ): void {
    this.state.writable = createWritableStream(
      () => startPromise,
      (chunk) => this.#write(chunk),
      () => this.#close(),
      (reason) => this.#abort(reason),
      writableHighWaterMark,
      writableSizeAlgorithm,
      this.#abortController,
      this.reactions,
    );
    this.state.readable = createReadableStream(
      () => startPromise,
      () => this.#pull(),
      (reason) => this.#cancel(reason),
      readableHighWaterMark,
      readableSizeAlgorithm,
      this.reactions,
    );
    this.setBackpressure(true);
  }

  #unblockWrite(): void {
    if (this.state.backpressure) this.setBackpressure(false);
  }

  // SPEC_MISMATCH: TransformStreamDefaultSinkWriteAlgorithm(stream, chunk) -> Promise<undefined>
  #write(chunk: unknown): InternalPromise<unknown> {
    const { state } = this.writable;
    if (state.state !== 'writable') {
      throw new Error('Transform stream writable side is not writable');
    }
    if (!this.state.backpressure) return this.#controller.performTransform(chunk);

    return requireStateMember(this.state.backpressureChange, 'backpressure change')
      .promise.chain(() => {
        if (state.state === 'erroring') throw state.storedError;
        return this.#controller.performTransform(chunk);
      }, undefined, this.reactions);
  }

  // SPEC_MISMATCH: TransformStreamDefaultSinkAbortAlgorithm(stream, reason) -> Promise<undefined>
  #abort(reason: unknown): InternalPromise<void> {
    const controller = this.#controller;
    if (controller.state.finishPromise) return controller.state.finishPromise;

    const finish = InternalPromise.withResolvers<void>();
    controller.state.finishPromise = finish.promise;
    const cancelPromise = controller.cancel(reason);
    controller.clearAlgorithms();
    void cancelPromise.chain(() => {
      const readable = ReadableStreamImpl.getState(this.readable);
      if (readable.state === 'errored') {
        finish.reject(readable.storedError);
      } else {
        readableStreamDefaultControllerError(this.readableController, reason);
        finish.resolve();
      }
    }, (error: unknown) => {
      readableStreamDefaultControllerError(this.readableController, error);
      finish.reject(error);
    }, this.reactions);
    return finish.promise;
  }

  // SPEC_MISMATCH: TransformStreamDefaultSinkCloseAlgorithm(stream) -> Promise<undefined>
  #close(): InternalPromise<void> {
    const controller = this.#controller;
    if (controller.state.finishPromise) return controller.state.finishPromise;

    const finish = InternalPromise.withResolvers<void>();
    controller.state.finishPromise = finish.promise;
    const flushPromise = controller.flush();
    controller.clearAlgorithms();
    void flushPromise.chain(() => {
      const readable = ReadableStreamImpl.getState(this.readable);
      if (readable.state === 'errored') {
        finish.reject(readable.storedError);
      } else {
        readableStreamDefaultControllerClose(this.readableController);
        finish.resolve();
      }
    }, (error: unknown) => {
      readableStreamDefaultControllerError(this.readableController, error);
      finish.reject(error);
    }, this.reactions);
    return finish.promise;
  }

  // SPEC_MISMATCH: TransformStreamDefaultSourcePullAlgorithm(stream) -> Promise<undefined>
  #pull(): InternalPromise<void> {
    if (!this.state.backpressure) {
      throw new Error('Transform stream source pulled without backpressure');
    }
    this.setBackpressure(false);
    return requireStateMember(this.state.backpressureChange, 'backpressure change').promise;
  }

  // SPEC_MISMATCH: TransformStreamDefaultSourceCancelAlgorithm(stream, reason) -> Promise<undefined>
  #cancel(reason: unknown): InternalPromise<void> {
    const controller = this.#controller;
    if (controller.state.finishPromise) return controller.state.finishPromise;

    const finish = InternalPromise.withResolvers<void>();
    controller.state.finishPromise = finish.promise;
    const cancelPromise = controller.cancel(reason);
    controller.clearAlgorithms();
    void cancelPromise.chain(() => {
      const writable = this.writable.state;
      if (writable.state === 'errored') {
        finish.reject(writable.storedError);
      } else {
        writableStreamDefaultControllerErrorIfNeeded(this.#writableController, reason);
        this.#unblockWrite();
        finish.resolve();
      }
    }, (error: unknown) => {
      writableStreamDefaultControllerErrorIfNeeded(this.#writableController, error);
      this.#unblockWrite();
      finish.reject(error);
    }, this.reactions);
    return finish.promise;
  }
}

export type TransformStreamState = {
  backpressure?: boolean;
  backpressureChange?: InternalPromiseCapability<void>;
  controller?: TransformStreamDefaultControllerImpl;
  readable?: ReadableStreamImpl;
  writable?: WritableStreamImpl;
};

/** Converted transformer members supplied before stream setup. */
export type TransformerRecord = {
  readonly cancel?: (reason: unknown) => InternalPromise<unknown> | void;
  readonly flush?: (
    controller: TransformStreamDefaultControllerImpl,
  ) => InternalPromise<unknown> | void;
  readonly readableType?: unknown;
  readonly start?: (
    controller: TransformStreamDefaultControllerImpl,
  ) => InternalPromise<unknown> | void;
  readonly transform?: (
    chunk: unknown,
    controller: TransformStreamDefaultControllerImpl,
  ) => InternalPromise<unknown> | void;
  readonly writableType?: unknown;
};

export const transformStreamIDL = defineInterface({
  name: 'TransformStream',
  exposed: '*',
  ...xattr('Transferable'),
  implementation: impl(TransformStreamImpl, {
    constructWith: [
      atArg(3, contextValue(createStreamAbortController)),
      atArg(4, contextValue((context: BindingContext) => createPromiseReactions(context.realm))),
    ],
  }),
  members: [
    ctor([
      arg('transformer', idlType.object, { optional: true }),
      arg('writableStrategy', reference('QueuingStrategy'), {
        default: emptyDictionary,
        optional: true,
      }),
      arg('readableStrategy', reference('QueuingStrategy'), {
        default: emptyDictionary,
        optional: true,
      }),
    ], bind({
      construct(context, transformer, writableStrategy, readableStrategy) {
        return new TransformStreamImpl(
          convertStreamCallbacks(context, transformer, 'Transformer', ['start', 'transform', 'flush', 'cancel']),
          writableStrategy as QueuingStrategy,
          readableStrategy as QueuingStrategy,
          createStreamAbortController(context),
          createPromiseReactions(context.realm),
        );
      },
    })),
    roAttr('readable', reference('ReadableStream')),
    roAttr('writable', reference('WritableStream')),
  ],
});

export const transformerStartCallbackIDL = defineCallbackFunction({
  name: 'TransformerStartCallback',
  returns: idlType.any,
  arguments: [arg(
    'controller',
    reference('TransformStreamDefaultController'),
  )],
});

export const transformerFlushCallbackIDL = defineCallbackFunction({
  name: 'TransformerFlushCallback',
  returns: promise(idlType.undefined),
  arguments: [arg(
    'controller',
    reference('TransformStreamDefaultController'),
  )],
});

export const transformerTransformCallbackIDL = defineCallbackFunction({
  name: 'TransformerTransformCallback',
  returns: promise(idlType.undefined),
  arguments: [
    arg('chunk', idlType.any),
    arg('controller', reference('TransformStreamDefaultController')),
  ],
});

export const transformerCancelCallbackIDL = defineCallbackFunction({
  name: 'TransformerCancelCallback',
  returns: promise(idlType.undefined),
  arguments: [arg('reason', idlType.any)],
});

export const transformerIDL = defineDictionary({
  name: 'Transformer',
  members: [
    dictMember('start', reference('TransformerStartCallback'),
      callback('rethrow')),
    dictMember('transform', reference('TransformerTransformCallback')),
    dictMember('flush', reference('TransformerFlushCallback')),
    dictMember('cancel', reference('TransformerCancelCallback')),
    dictMember('readableType', idlType.any),
    dictMember('writableType', idlType.any),
  ],
});

function requireStateMember<Value>(
  value: Value | undefined,
  name: string,
): Value {
  if (value === undefined) {
    throw new Error(`TransformStream has no ${name}`);
  }
  return value;
}
