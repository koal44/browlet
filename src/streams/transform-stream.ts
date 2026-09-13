import type { RuntimeContext } from '../js-engine/runtime-context';
import type { PromiseValue, PromiseValueCapability } from '../js-engine/promises';
import {
  arg, atArg, onError, callbackDictionary, ctor, defineCallbackFunction, defineDictionary,
  defineInterface, defineInterfaceMixin, dictMember, emptyDictionary, idlType, impl,
  nullable, op, promise, roAttr, reference, xattr,
} from '../web-idl/index';
import { RangeError, TypeError } from '../js-engine/simple-exception';
import {
  extractHighWaterMark, extractSizeAlgorithm,
  type QueuingStrategyRecord, type QueuingStrategySize,
} from './queuing-strategy';
import { ReadableStreamImpl, ReadableStreamDefaultControllerImpl } from './readable-stream';
import { WritableStreamImpl } from './writable-stream';

// =============================================================================
// TransformStream
// =============================================================================

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

  /** Streams §6.2.4, TransformStream(); null allocates for a later setUp call. */
  constructor(
    transformer: TransformerRecord | null = {},
    writableStrategy: QueuingStrategyRecord = {},
    readableStrategy: QueuingStrategyRecord = {},
    readonly runtime: RuntimeContext,
  ) {
    if (transformer === null) return;

    if (transformer.readableType !== undefined) {
      throw new RangeError('Invalid readableType specified');
    }
    if (transformer.writableType !== undefined) {
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
    controller.setUpFromTransformer(this, transformer);

    const startResult = transformer.start
      ? Reflect.apply(transformer.start, transformer, [controller])
      : undefined;
    runtime.promises.resolve(startResult).observe(start.resolve, start.reject);
  }

  /** Streams §9.3.1, creating an identity TransformStream. */
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
    const { controller } = this.readable.state;
    if (!ReadableStreamDefaultControllerImpl.is(controller)) {
      throw new Error('TransformStream has no readable default controller');
    }
    return controller;
  }

  /** Streams §9.3.1, set up a newly-created transform stream. */
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
    this.readableController.error(reason);
    this.errorWritableAndUnblockWrite(reason);
  }

  errorWritableAndUnblockWrite(reason: unknown): void {
    this.#controller.clearAlgorithms();
    this.#writableController.error(reason);
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
    this.state.writable = WritableStreamImpl.create(
      () => startPromise,
      (chunk) => this.#write(chunk),
      () => this.#close(),
      (reason) => this.#abort(reason),
      writableHighWaterMark,
      writableSizeAlgorithm,
      this.runtime,
    );
    this.state.readable = ReadableStreamImpl.create(
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

  /** Streams §6.4.3, TransformStreamDefaultSinkWriteAlgorithm. */
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

  /** Streams §6.4.3, TransformStreamDefaultSinkAbortAlgorithm. */
  #abort(reason: unknown): PromiseValue<void> {
    const controller = this.#controller;
    if (controller.state.finishPromise) return controller.state.finishPromise;

    const finish = this.runtime.promises.withResolvers<void>();
    controller.state.finishPromise = finish.promise;
    const cancelPromise = controller.cancel(reason);
    controller.clearAlgorithms();
    void cancelPromise.then(() => {
      const readable = this.readable.state;
      if (readable.state === 'errored') {
        finish.reject(readable.storedError);
      } else {
        this.readableController.error(reason);
        finish.resolve();
      }
    }, (error: unknown) => {
      this.readableController.error(error);
      finish.reject(error);
    });
    return finish.promise;
  }

  /** Streams §6.4.3, TransformStreamDefaultSinkCloseAlgorithm. */
  #close(): PromiseValue<void> {
    const controller = this.#controller;
    if (controller.state.finishPromise) return controller.state.finishPromise;

    const finish = this.runtime.promises.withResolvers<void>();
    controller.state.finishPromise = finish.promise;
    const flushPromise = controller.flush();
    controller.clearAlgorithms();
    void flushPromise.then(() => {
      const readable = this.readable.state;
      if (readable.state === 'errored') {
        finish.reject(readable.storedError);
      } else {
        this.readableController.closeInternal();
        finish.resolve();
      }
    }, (error: unknown) => {
      this.readableController.error(error);
      finish.reject(error);
    });
    return finish.promise;
  }

  /** Streams §6.4.4, TransformStreamDefaultSourcePullAlgorithm. */
  #pull(): PromiseValue<void> {
    if (!this.state.backpressure) {
      throw new Error('Transform stream source pulled without backpressure');
    }
    this.setBackpressure(false);
    return requireStateMember(this.state.backpressureChange, 'backpressure change').promise;
  }

  /** Streams §6.4.4, TransformStreamDefaultSourceCancelAlgorithm. */
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
        this.#writableController.error(reason);
        this.#unblockWrite();
        finish.resolve();
      }
    }, (error: unknown) => {
      this.#writableController.error(error);
      this.#unblockWrite();
      finish.reject(error);
    });
    return finish.promise;
  }
}

type TransformStreamState = {
  backpressure?: boolean;
  backpressureChange?: PromiseValueCapability<void>;
  controller?: TransformStreamDefaultControllerImpl;
  readable?: ReadableStreamImpl;
  writable?: WritableStreamImpl;
};

/** Converted transformer members supplied before stream setup. */
/*
 * dictionary Transformer {
 *   TransformerStartCallback start;
 *   TransformerTransformCallback transform;
 *   TransformerFlushCallback flush;
 *   TransformerCancelCallback cancel;
 *   any readableType;
 *   any writableType;
 * };
 */
export type TransformerRecord = {
  readonly cancel?: (reason: unknown) => PromiseValue<unknown> | void;
  readonly flush?: (
    controller: TransformStreamDefaultControllerImpl,
  ) => PromiseValue<unknown> | void;
  readonly readableType?: unknown;
  readonly start?: (
    controller: TransformStreamDefaultControllerImpl,
  ) => unknown;
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
      atArg(3, (ctx) => ctx.getRuntime()),
    ],
  }),
  members: [
    ctor([
      arg('transformer', idlType.object, {
        optional: true,
        ...callbackDictionary('Transformer'),
      }),
      arg('writableStrategy', reference('QueuingStrategy'), {
        default: emptyDictionary,
        optional: true,
      }),
      arg('readableStrategy', reference('QueuingStrategy'), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
    roAttr('readable', reference('ReadableStream')),
    roAttr('writable', reference('WritableStream')),
  ],
});

/*
 * callback TransformerStartCallback = any (TransformStreamDefaultController controller);
 */
export const transformerStartCallbackIDL = defineCallbackFunction({
  name: 'TransformerStartCallback',
  returns: idlType.any,
  arguments: [arg(
    'controller',
    reference('TransformStreamDefaultController'),
  )],
});

/*
 * callback TransformerFlushCallback = Promise<undefined> (TransformStreamDefaultController controller);
 */
export const transformerFlushCallbackIDL = defineCallbackFunction({
  name: 'TransformerFlushCallback',
  returns: promise(idlType.undefined),
  arguments: [arg(
    'controller',
    reference('TransformStreamDefaultController'),
  )],
});

/*
 * callback TransformerTransformCallback = Promise<undefined> (any chunk, TransformStreamDefaultController controller);
 */
export const transformerTransformCallbackIDL = defineCallbackFunction({
  name: 'TransformerTransformCallback',
  returns: promise(idlType.undefined),
  arguments: [
    arg('chunk', idlType.any),
    arg('controller', reference('TransformStreamDefaultController')),
  ],
});

/*
 * callback TransformerCancelCallback = Promise<undefined> (any reason);
 */
export const transformerCancelCallbackIDL = defineCallbackFunction({
  name: 'TransformerCancelCallback',
  returns: promise(idlType.undefined),
  arguments: [arg('reason', idlType.any)],
});

export const transformerIDL = defineDictionary({
  name: 'Transformer',
  members: [
    dictMember('start', reference('TransformerStartCallback'),
      onError('rethrow')),
    dictMember('transform', reference('TransformerTransformCallback')),
    dictMember('flush', reference('TransformerFlushCallback')),
    dictMember('cancel', reference('TransformerCancelCallback')),
    dictMember('readableType', idlType.any),
    dictMember('writableType', idlType.any),
  ],
});

// =============================================================================
// TransformStreamDefaultController
// =============================================================================

/*
 * [Exposed=*]
 * interface TransformStreamDefaultController {
 *   readonly attribute unrestricted double? desiredSize;
 *
 *   undefined enqueue(optional any chunk);
 *   undefined error(optional any reason);
 *   undefined terminate();
 * };
 */
export class TransformStreamDefaultControllerImpl {
  state!: TransformStreamDefaultControllerState;

  get desiredSize(): number | null {
    return this.state.stream.readableController.desiredSize;
  }

  enqueue(chunk?: unknown): void {
    const { stream } = this.state;
    const controller = stream.readableController;
    if (!controller.canCloseOrEnqueue) {
      throw new TypeError('Readable side is not in a state that permits enqueue');
    }
    try {
      controller.enqueueInternal(chunk);
    } catch (error) {
      stream.errorWritableAndUnblockWrite(error);
      throw stream.readable.state.storedError;
    }
    const backpressure = controller.hasBackpressure;
    if (backpressure !== stream.state.backpressure) {
      if (!backpressure) throw new Error('Transform stream unexpectedly lost backpressure');
      stream.setBackpressure(true);
    }
  }

  error(reason?: unknown): void {
    this.state.stream.error(reason);
  }

  terminate(): void {
    const { stream } = this.state;
    stream.readableController.closeInternal();
    stream.errorWritableAndUnblockWrite(new TypeError('TransformStream terminated'));
  }

  setUp(
    stream: TransformStreamImpl,
    transformAlgorithm: (chunk: unknown) => PromiseValue<unknown>,
    flushAlgorithm: () => PromiseValue<unknown>,
    cancelAlgorithm: (reason: unknown) => PromiseValue<unknown>,
  ): void {
    if (stream.state.controller) throw new Error('TransformStream already has a controller');
    this.state = { stream, transformAlgorithm, flushAlgorithm, cancelAlgorithm };
    stream.state.controller = this;
  }

  /** Streams §6.4.2, SetUpTransformStreamDefaultControllerFromTransformer. */
  setUpFromTransformer(
    stream: TransformStreamImpl,
    transformer: TransformerRecord,
  ): void {
    const { transform, flush, cancel } = transformer;
    this.setUp(
      stream,
      (chunk) => stream.runtime.promises.try(() => transform ? transform.call(transformer, chunk, this) : this.enqueue(chunk)),
      () => stream.runtime.promises.try(() => flush?.call(transformer, this)),
      (reason) => stream.runtime.promises.try(() => cancel?.call(transformer, reason)),
    );
  }

  /** Streams §6.4.2, TransformStreamDefaultControllerPerformTransform. */
  performTransform(chunk: unknown): PromiseValue<unknown> {
    return requireAlgorithm(this.state.transformAlgorithm, 'transform')(chunk)
      .then(undefined, (reason: unknown) => {
        this.state.stream.error(reason);
        throw reason;
      });
  }

  flush(): PromiseValue<unknown> {
    return requireAlgorithm(this.state.flushAlgorithm, 'flush')();
  }

  cancel(reason: unknown): PromiseValue<unknown> {
    return requireAlgorithm(this.state.cancelAlgorithm, 'cancel')(reason);
  }

  clearAlgorithms(): void {
    this.state.transformAlgorithm = undefined;
    this.state.flushAlgorithm = undefined;
    this.state.cancelAlgorithm = undefined;
  }
}

type TransformStreamDefaultControllerState = {
  cancelAlgorithm?: (reason: unknown) => PromiseValue<unknown>;
  finishPromise?: PromiseValue<void>;
  flushAlgorithm?: () => PromiseValue<unknown>;
  stream: TransformStreamImpl;
  transformAlgorithm?: (chunk: unknown) => PromiseValue<unknown>;
};

export const transformStreamDefaultControllerIDL = defineInterface({
  name: 'TransformStreamDefaultController',
  exposed: '*',
  implementation: impl(TransformStreamDefaultControllerImpl),
  members: [
    roAttr('desiredSize', nullable(idlType.unrestrictedDouble)),
    op('enqueue', idlType.undefined, [
      arg('chunk', idlType.any, { optional: true }),
    ]),
    op('error', idlType.undefined, [
      arg('reason', idlType.any, { optional: true }),
    ]),
    op('terminate', idlType.undefined),
  ],
});

// =============================================================================
// GenericTransformStream
// =============================================================================

/**
 * Streams Standard, "Wrapping into a custom class".
 *
 * Other specifications compose this mixin when they expose a custom transform
 * stream with additional API surface.
 *
 * interface mixin GenericTransformStream {
 *   readonly attribute ReadableStream readable;
 *   readonly attribute WritableStream writable;
 * };
 */
export class GenericTransformStreamMixin {
  readonly #transform: TransformStreamImpl;

  constructor(transform: TransformStreamImpl) {
    this.#transform = transform;
  }

  get readable(): ReadableStreamImpl {
    return this.#transform.readable;
  }

  get writable(): WritableStreamImpl {
    return this.#transform.writable;
  }

  // -- Internal methods -------------------------------------------------

  getAssociatedTransform(): TransformStreamImpl {
    return this.#transform;
  }
}

export const genericTransformStreamIDL = defineInterfaceMixin({
  name: 'GenericTransformStream',
  members: [
    roAttr('readable', reference('ReadableStream')),
    roAttr('writable', reference('WritableStream')),
  ],
});

// =============================================================================
// Helpers
// =============================================================================

function requireAlgorithm<Algorithm>(
  algorithm: Algorithm | undefined,
  name: string,
): Algorithm {
  if (!algorithm) throw new Error(`Transform stream ${name} algorithm is gone`);
  return algorithm;
}

function requireStateMember<Value>(
  value: Value | undefined,
  name: string,
): Value {
  if (value === undefined) {
    throw new Error(`TransformStream has no ${name}`);
  }
  return value;
}

/** Streams §9.5, create a proxy for a readable stream. */
export function createReadableStreamProxy(
  stream: ReadableStreamImpl,
): ReadableStreamImpl {
  return stream.pipeThroughTransform(TransformStreamImpl.createIdentity(stream.runtime));
}
