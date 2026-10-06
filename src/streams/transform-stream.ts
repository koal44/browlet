import type { JSEnvironment } from '../js-engine/index';
import type { InternalPromise, InternalPromiseWithResolvers } from '../infra/promises';
import {
  arg, atArg, onError, cbDict, ctor, defineCallbackFunction, defineDictionary,
  defineInterface, defineInterfaceMixin, dictMember, emptyDictionary, idlType, impl, invokeWith,
  nullable, op, promise, roAttr, reference, xattr,
} from '../web-idl/index';
import { RangeError, TypeError } from '../infra/exceptions';
import {
  extractHighWaterMark, extractSizeAlgorithm,
  type QueuingStrategyRecord, type QueuingStrategySize,
} from './queuing-strategy';
import { ReadableStreamImpl, ReadableStreamDefaultControllerImpl } from './readable-stream';
import { WritableStreamImpl } from './writable-stream';
import { InternalError } from '../infra/internal-error';

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
  state: TransformStreamState = {};

  /** Streams §6.2.4, TransformStream(); null allocates for a later setUp call. */
  constructor(
    transformer: TransformerRecord | null = {},
    writableStrategy: QueuingStrategyRecord = {},
    readableStrategy: QueuingStrategyRecord = {},
    public env: JSEnvironment,
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
    const start = env.exec.Promise.withResolvers(idlType.any);
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
    env.exec.Promise.fromValue(startResult, env.exec.NativePromise, idlType.any).observe(start.resolve, start.reject);
  }

  /** Streams §9.3.1, creating an identity TransformStream. */
  static createIdentity(env: JSEnvironment): TransformStreamImpl {
    const stream = new TransformStreamImpl(null, {}, {}, env);
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
      throw new InternalError('TransformStream has no readable default controller');
    }
    return controller;
  }

  /** Streams §9.3.1, set up a newly-created transform stream. */
  setUp(
    transformAlgorithm: (chunk: unknown) => InternalPromise<void> | void,
    flushAlgorithm?: () => InternalPromise<void> | void,
    cancelAlgorithm?: (reason: unknown) => InternalPromise<void> | void,
  ): void {
    this.#initialize(
      this.env.exec.Promise.resolve(undefined, idlType.undefined),
      1,
      () => 1,
      0,
      () => 1,
    );
    new TransformStreamDefaultControllerImpl().setUp(
      this,
      (chunk) => this.env.exec.Promise.try(() => transformAlgorithm(chunk), idlType.undefined),
      () => this.env.exec.Promise.try(() => flushAlgorithm?.(), idlType.undefined),
      (reason) => this.env.exec.Promise.try(() => cancelAlgorithm?.(reason), idlType.undefined),
    );
  }

  /** Streams §9.3, enqueue into a stream initialized by setUp. */
  enqueue(chunk: unknown): void {
    this.#controller.enqueue(chunk, this.env);
  }

  /** Streams §9.3, terminate a stream initialized by setUp. */
  terminate(): void {
    this.#controller.terminate(this.env);
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
      throw new InternalError('Transform stream backpressure did not change');
    }
    this.state.backpressureChange?.resolve();
    this.state.backpressureChange = this.env.exec.Promise.withResolvers(idlType.undefined);
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
    this.state.writable = WritableStreamImpl.create(
      () => startPromise,
      (chunk) => this.#write(chunk),
      () => this.#close(),
      (reason) => this.#abort(reason),
      writableHighWaterMark,
      writableSizeAlgorithm,
      this.env,
    );
    this.state.readable = ReadableStreamImpl.create(
      () => startPromise,
      () => this.#pull(),
      (reason) => this.#cancel(reason),
      readableHighWaterMark,
      readableSizeAlgorithm,
      this.env,
    );
    this.setBackpressure(true);
  }

  #unblockWrite(): void {
    if (this.state.backpressure) this.setBackpressure(false);
  }

  /** Streams §6.4.3, TransformStreamDefaultSinkWriteAlgorithm. */
  #write(chunk: unknown): InternalPromise<void> {
    const { state } = this.writable;
    if (state.state !== 'writable') {
      throw new InternalError('Transform stream writable side is not writable');
    }
    if (!this.state.backpressure) return this.#controller.performTransform(chunk);

    return requireStateMember(this.state.backpressureChange, 'backpressure change')
      .promise.then(() => {
        if (state.state === 'erroring') throw state.storedError;
        return this.#controller.performTransform(chunk);
      });
  }

  /** Streams §6.4.3, TransformStreamDefaultSinkAbortAlgorithm. */
  #abort(reason: unknown): InternalPromise<void> {
    const controller = this.#controller;
    if (controller.state.finishPromise) return controller.state.finishPromise;

    const finish = this.env.exec.Promise.withResolvers(idlType.undefined);
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
  #close(): InternalPromise<void> {
    const controller = this.#controller;
    if (controller.state.finishPromise) return controller.state.finishPromise;

    const finish = this.env.exec.Promise.withResolvers(idlType.undefined);
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
  #pull(): InternalPromise<void> {
    if (!this.state.backpressure) {
      throw new InternalError('Transform stream source pulled without backpressure');
    }
    this.setBackpressure(false);
    return requireStateMember(this.state.backpressureChange, 'backpressure change').promise;
  }

  /** Streams §6.4.4, TransformStreamDefaultSourceCancelAlgorithm. */
  #cancel(reason: unknown): InternalPromise<void> {
    const controller = this.#controller;
    if (controller.state.finishPromise) return controller.state.finishPromise;

    const finish = this.env.exec.Promise.withResolvers(idlType.undefined);
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
  backpressureChange?: InternalPromiseWithResolvers<void>;
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
  cancel?: (reason: unknown) => InternalPromise<void> | void;
  flush?: (
    controller: TransformStreamDefaultControllerImpl,
  ) => InternalPromise<void> | void;
  readableType?: unknown;
  start?: (
    controller: TransformStreamDefaultControllerImpl,
  ) => unknown;
  transform?: (
    chunk: unknown,
    controller: TransformStreamDefaultControllerImpl,
  ) => InternalPromise<void> | void;
  writableType?: unknown;
};

export const transformStreamIDL = defineInterface<JSEnvironment>({
  name: 'TransformStream',
  exposed: '*',
  ...xattr('Transferable'),
  implementation: impl(TransformStreamImpl, {
    constructWith: [
      atArg(3, (ctx) => ctx.getEnvironment()),
    ],
  }),
  members: [
    ctor([
      arg('transformer', idlType.object, {
        optional: true,
        ...cbDict('Transformer'),
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
  arguments: [arg('controller', reference('TransformStreamDefaultController'))],
});

/*
 * callback TransformerFlushCallback = Promise<undefined> (TransformStreamDefaultController controller);
 */
export const transformerFlushCallbackIDL = defineCallbackFunction({
  name: 'TransformerFlushCallback',
  returns: promise(idlType.undefined),
  arguments: [arg('controller', reference('TransformStreamDefaultController'))],
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

  enqueue(chunk: unknown, env: JSEnvironment): void {
    const { stream } = this.state;
    const controller = stream.readableController;
    if (!controller.canCloseOrEnqueue) {
      throw new TypeError('Readable side is not in a state that permits enqueue');
    }
    try {
      controller.enqueueInternal(chunk, env);
    } catch (error) {
      stream.errorWritableAndUnblockWrite(error);
      throw stream.readable.state.storedError;
    }
    const backpressure = controller.hasBackpressure;
    if (backpressure !== stream.state.backpressure) {
      if (!backpressure) throw new InternalError('Transform stream unexpectedly lost backpressure');
      stream.setBackpressure(true);
    }
  }

  error(reason?: unknown): void {
    this.state.stream.error(reason);
  }

  terminate(env: JSEnvironment): void {
    const { stream } = this.state;
    stream.readableController.closeInternal();
    stream.errorWritableAndUnblockWrite(new env.exec.TypeError('TransformStream terminated'));
  }

  setUp(
    stream: TransformStreamImpl,
    transformAlgorithm: (chunk: unknown) => InternalPromise<void>,
    flushAlgorithm: () => InternalPromise<void>,
    cancelAlgorithm: (reason: unknown) => InternalPromise<void>,
  ): void {
    if (stream.state.controller) throw new InternalError('TransformStream already has a controller');
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
      (chunk) => stream.env.exec.Promise.try(() => transform ? transform.call(transformer, chunk, this) : this.enqueue(chunk, stream.env), idlType.undefined),
      () => stream.env.exec.Promise.try(() => flush?.call(transformer, this), idlType.undefined),
      (reason) => stream.env.exec.Promise.try(() => cancel?.call(transformer, reason), idlType.undefined),
    );
  }

  /** Streams §6.4.2, TransformStreamDefaultControllerPerformTransform. */
  performTransform(chunk: unknown): InternalPromise<void> {
    return requireAlgorithm(this.state.transformAlgorithm, 'transform')(chunk)
      .then(undefined, (reason: unknown) => {
        this.state.stream.error(reason);
        throw reason;
      });
  }

  flush(): InternalPromise<void> {
    return requireAlgorithm(this.state.flushAlgorithm, 'flush')();
  }

  cancel(reason: unknown): InternalPromise<void> {
    return requireAlgorithm(this.state.cancelAlgorithm, 'cancel')(reason);
  }

  clearAlgorithms(): void {
    this.state.transformAlgorithm = undefined;
    this.state.flushAlgorithm = undefined;
    this.state.cancelAlgorithm = undefined;
  }
}

type TransformStreamDefaultControllerState = {
  cancelAlgorithm?: (reason: unknown) => InternalPromise<void>;
  finishPromise?: InternalPromise<void>;
  flushAlgorithm?: () => InternalPromise<void>;
  stream: TransformStreamImpl;
  transformAlgorithm?: (chunk: unknown) => InternalPromise<void>;
};

export const transformStreamDefaultControllerIDL = defineInterface<JSEnvironment>({
  name: 'TransformStreamDefaultController',
  exposed: '*',
  implementation: impl(TransformStreamDefaultControllerImpl),
  members: [
    roAttr('desiredSize', nullable(idlType.unrestrictedDouble)),
    op('enqueue', idlType.undefined,
      [arg('chunk', idlType.any, { optional: true })],
      invokeWith(atArg(1, (_receiver, method) => method.getEnvironment())),
    ),
    op('error', idlType.undefined, [
      arg('reason', idlType.any, { optional: true }),
    ]),
    op('terminate', idlType.undefined,
      [], invokeWith(atArg(0, (_receiver, method) => method.getEnvironment())),
    ),
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
  #transform: TransformStreamImpl;

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
  if (!algorithm) throw new InternalError(`Transform stream ${name} algorithm is gone`);
  return algorithm;
}

function requireStateMember<Value>(
  value: Value | undefined,
  name: string,
): Value {
  if (value === undefined) {
    throw new InternalError(`TransformStream has no ${name}`);
  }
  return value;
}

/** Streams §9.5, create a proxy for a readable stream. */
export function createReadableStreamProxy(
  stream: ReadableStreamImpl, env: JSEnvironment,
): ReadableStreamImpl {
  return stream.pipeThroughTransform(TransformStreamImpl.createIdentity(env));
}
