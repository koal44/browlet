import type { RuntimeContext } from '../js-engine/runtime-context';
import type { PromiseValue, PromiseValueCapability } from '../js-engine/promises';
import {
  arg, atArg, callback, ctor, defineCallbackFunction, defineDictionary,
  defineInterface, dictMember, emptyDictionary, idlType, impl, promise,
  roAttr, reference, xattr,
} from '../web-idl/declaration/index';
import { RangeError } from '../js-engine/simple-exception';
import { bind, runtimeContext } from '../web-idl/projection';
import { convertStreamCallbacks } from './integration';
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

  /** A null transformer allocates the implementation for a later setUp call. */
  // SPEC_MISMATCH: TransformStream(transformer?, writableStrategy = {}, readableStrategy = {}) -> TransformStream
  constructor(
    transformer: TransformerRecord | null = {},
    writableStrategy: QueuingStrategy = {},
    readableStrategy: QueuingStrategy = {},
    readonly runtime: RuntimeContext,
  ) {
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
    const start = runtime.promises.withResolvers<unknown>();
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
    runtime.promises.resolve(startResult).observe(start.resolve, start.reject);
  }

  /** Streams §9.3, create an identity transform stream. */
  // SPEC_MISMATCH: create an identity TransformStream() -> TransformStream
  static createIdentity(runtime: RuntimeContext): TransformStreamImpl {
    const stream = new TransformStreamImpl(null, {}, {}, runtime);
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
    transformAlgorithm: (chunk: unknown) => PromiseValue<unknown> | void,
    flushAlgorithm?: () => PromiseValue<unknown> | void,
    cancelAlgorithm?: (reason: unknown) => PromiseValue<unknown> | void,
  ): void {
    this.#initialize(
      this.runtime.promises.resolve(),
      1,
      () => 1,
      0,
      () => 1,
    );
    new TransformStreamDefaultControllerImpl().setUp(
      this,
      (chunk) => this.runtime.promises.try(() => transformAlgorithm(chunk)),
      () => this.runtime.promises.try(() => flushAlgorithm?.()),
      (reason) => this.runtime.promises.try(() => cancelAlgorithm?.(reason)),
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
    this.state.backpressureChange = this.runtime.promises.withResolvers<void>();
    this.state.backpressure = backpressure;
  }

  get #controller(): TransformStreamDefaultControllerImpl {
    return requireStateMember(this.state.controller, 'controller');
  }

  get #writableController() {
    return requireStateMember(this.writable.state.controller, 'writable controller');
  }

  #initialize(
    startPromise: PromiseValue<unknown>,
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
      this.runtime,
    );
    this.state.readable = createReadableStream(
      () => startPromise,
      () => this.#pull(),
      (reason) => this.#cancel(reason),
      readableHighWaterMark,
      readableSizeAlgorithm,
      this.runtime,
    );
    this.setBackpressure(true);
  }

  #unblockWrite(): void {
    if (this.state.backpressure) this.setBackpressure(false);
  }

  // SPEC_MISMATCH: TransformStreamDefaultSinkWriteAlgorithm(stream, chunk) -> Promise<undefined>
  #write(chunk: unknown): PromiseValue<unknown> {
    const { state } = this.writable;
    if (state.state !== 'writable') {
      throw new Error('Transform stream writable side is not writable');
    }
    if (!this.state.backpressure) return this.#controller.performTransform(chunk);

    return requireStateMember(this.state.backpressureChange, 'backpressure change')
      .promise.then(() => {
        if (state.state === 'erroring') throw state.storedError;
        return this.#controller.performTransform(chunk);
      });
  }

  // SPEC_MISMATCH: TransformStreamDefaultSinkAbortAlgorithm(stream, reason) -> Promise<undefined>
  #abort(reason: unknown): PromiseValue<void> {
    const controller = this.#controller;
    if (controller.state.finishPromise) return controller.state.finishPromise;

    const finish = this.runtime.promises.withResolvers<void>();
    controller.state.finishPromise = finish.promise;
    const cancelPromise = controller.cancel(reason);
    controller.clearAlgorithms();
    void cancelPromise.then(() => {
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
    });
    return finish.promise;
  }

  // SPEC_MISMATCH: TransformStreamDefaultSinkCloseAlgorithm(stream) -> Promise<undefined>
  #close(): PromiseValue<void> {
    const controller = this.#controller;
    if (controller.state.finishPromise) return controller.state.finishPromise;

    const finish = this.runtime.promises.withResolvers<void>();
    controller.state.finishPromise = finish.promise;
    const flushPromise = controller.flush();
    controller.clearAlgorithms();
    void flushPromise.then(() => {
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
    });
    return finish.promise;
  }

  // SPEC_MISMATCH: TransformStreamDefaultSourcePullAlgorithm(stream) -> Promise<undefined>
  #pull(): PromiseValue<void> {
    if (!this.state.backpressure) {
      throw new Error('Transform stream source pulled without backpressure');
    }
    this.setBackpressure(false);
    return requireStateMember(this.state.backpressureChange, 'backpressure change').promise;
  }

  // SPEC_MISMATCH: TransformStreamDefaultSourceCancelAlgorithm(stream, reason) -> Promise<undefined>
  #cancel(reason: unknown): PromiseValue<void> {
    const controller = this.#controller;
    if (controller.state.finishPromise) return controller.state.finishPromise;

    const finish = this.runtime.promises.withResolvers<void>();
    controller.state.finishPromise = finish.promise;
    const cancelPromise = controller.cancel(reason);
    controller.clearAlgorithms();
    void cancelPromise.then(() => {
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
    });
    return finish.promise;
  }
}

export type TransformStreamState = {
  backpressure?: boolean;
  backpressureChange?: PromiseValueCapability<void>;
  controller?: TransformStreamDefaultControllerImpl;
  readable?: ReadableStreamImpl;
  writable?: WritableStreamImpl;
};

/** Converted transformer members supplied before stream setup. */
export type TransformerRecord = {
  readonly cancel?: (reason: unknown) => PromiseValue<unknown> | void;
  readonly flush?: (
    controller: TransformStreamDefaultControllerImpl,
  ) => PromiseValue<unknown> | void;
  readonly readableType?: unknown;
  readonly start?: (
    controller: TransformStreamDefaultControllerImpl,
  ) => PromiseValue<unknown> | void;
  readonly transform?: (
    chunk: unknown,
    controller: TransformStreamDefaultControllerImpl,
  ) => PromiseValue<unknown> | void;
  readonly writableType?: unknown;
};

export const transformStreamIDL = defineInterface({
  name: 'TransformStream',
  exposed: '*',
  ...xattr('Transferable'),
  implementation: impl(TransformStreamImpl, {
    constructWith: [
      atArg(3, runtimeContext),
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
          context.getRuntime(),
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
