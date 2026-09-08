import {
  arg, callback, ctor, defineCallbackFunction, defineDictionary,
  defineInterface, dictMember, emptyDictionary, idlType, impl, promise,
  roAttr, reference, xattr,
} from '../web-idl/declaration/index';
import {
  bindingContext, type BindingContext,
} from '../web-idl/projection';
import { runPromiseAlgorithm, type StreamPromise } from './promise';
import {
  extractHighWaterMark, extractSizeAlgorithm, type QueuingStrategy,
} from './queuing-strategy';
import type { ReadableStreamImpl } from './readable-stream';
import {
  initializeTransformStream,
  setUpTransformStreamDefaultController,
  setUpTransformStreamDefaultControllerFromTransformer,
  transformStreamDefaultControllerEnqueue,
  transformStreamDefaultControllerError,
  transformStreamDefaultControllerTerminate,
} from './transform-stream-operations';
import { TransformStreamDefaultControllerImpl } from './transform-stream-default-controller';
import type { WritableStreamImpl } from './writable-stream';
import { internalStreamSetup } from './internal-methods';

export class TransformStreamImpl {
  readonly state: TransformStreamState = {};

  // SPEC_MISMATCH: TransformStream(transformer?, writableStrategy = {}, readableStrategy = {}) -> TransformStream
  constructor(
    readonly context: BindingContext,
    transformer?: object | typeof internalStreamSetup,
    writableStrategy: QueuingStrategy = {},
    readableStrategy: QueuingStrategy = {},
  ) {
    if (transformer === internalStreamSetup) return;

    const transformerObject = transformer ?? null;
    const transformerDictionary = context.convert(
      transformerObject,
      reference('Transformer'),
    ) as Transformer;

    if ('readableType' in transformerDictionary) {
      throw new context.realm.intrinsics.rangeError(
        'Invalid readableType specified',
      );
    }
    if ('writableType' in transformerDictionary) {
      throw new context.realm.intrinsics.rangeError(
        'Invalid writableType specified',
      );
    }

    const readableHighWaterMark = extractHighWaterMark(
      readableStrategy,
      0,
      context.realm.intrinsics.rangeError,
    );
    const readableSizeAlgorithm = extractSizeAlgorithm(readableStrategy);
    const writableHighWaterMark = extractHighWaterMark(
      writableStrategy,
      1,
      context.realm.intrinsics.rangeError,
    );
    const writableSizeAlgorithm = extractSizeAlgorithm(writableStrategy);
    const startPromise = context.createPromise(idlType.any);
    initializeTransformStream(
      this,
      startPromise,
      writableHighWaterMark,
      writableSizeAlgorithm,
      readableHighWaterMark,
      readableSizeAlgorithm,
    );
    const controller = context.construct(
      TransformStreamDefaultControllerImpl,
    );
    setUpTransformStreamDefaultControllerFromTransformer(
      this,
      controller,
      transformerObject,
      transformerDictionary,
    );

    const startResult = transformerDictionary.start === undefined
      ? undefined
      : Reflect.apply(
        transformerDictionary.start,
        transformerObject,
        [controller],
      );
    context.resolvePromise(startPromise, startResult);
  }

  /** Streams §9.3, create an identity transform stream. */
  // SPEC_MISMATCH: create an identity TransformStream() -> TransformStream
  static createIdentity(context: BindingContext): TransformStreamImpl {
    const stream = new TransformStreamImpl(context, internalStreamSetup);
    stream.setUp((chunk) => stream.enqueue(chunk));
    return stream;
  }

  get readable(): ReadableStreamImpl {
    return requireStateMember(this.state.readable, 'readable');
  }

  get writable(): WritableStreamImpl {
    return requireStateMember(this.state.writable, 'writable');
  }

  /** Streams §9.3, set up a newly-created transform stream. */
  setUp(
    transformAlgorithm: (chunk: unknown) => unknown,
    flushAlgorithm?: () => unknown,
    cancelAlgorithm?: (reason: unknown) => unknown,
  ): void {
    const { context } = this;
    initializeTransformStream(
      this,
      context.createResolvedPromise(undefined, idlType.undefined),
      1,
      () => 1,
      0,
      () => 1,
    );
    setUpTransformStreamDefaultController(
      this,
      context.construct(TransformStreamDefaultControllerImpl),
      (chunk) => runPromiseAlgorithm(context, () => transformAlgorithm(chunk)),
      () => runPromiseAlgorithm(context, () => flushAlgorithm?.()),
      (reason) => runPromiseAlgorithm(context, () => cancelAlgorithm?.(reason)),
    );
  }

  /** Streams §9.3, enqueue into a stream initialized by setUp. */
  enqueue(chunk: unknown): void {
    transformStreamDefaultControllerEnqueue(
      requireStateMember(this.state.controller, 'controller'), chunk,
    );
  }

  /** Streams §9.3, terminate a stream initialized by setUp. */
  terminate(): void {
    transformStreamDefaultControllerTerminate(
      requireStateMember(this.state.controller, 'controller'),
    );
  }

  /** Streams §9.3, error a stream initialized by setUp. */
  error(reason: unknown): void {
    transformStreamDefaultControllerError(
      requireStateMember(this.state.controller, 'controller'), reason,
    );
  }
}

export type TransformStreamState = {
  backpressure?: boolean;
  backpressureChangePromise?: StreamPromise;
  controller?: TransformStreamDefaultControllerImpl;
  readable?: ReadableStreamImpl;
  writable?: WritableStreamImpl;
};

export type Transformer = {
  readonly cancel?: (reason: unknown) => StreamPromise;
  readonly flush?: (
    controller: TransformStreamDefaultControllerImpl,
  ) => StreamPromise;
  readonly readableType?: unknown;
  readonly start?: (
    controller: TransformStreamDefaultControllerImpl,
  ) => unknown;
  readonly transform?: (
    chunk: unknown,
    controller: TransformStreamDefaultControllerImpl,
  ) => StreamPromise;
  readonly writableType?: unknown;
};

export const transformStreamIDL = defineInterface({
  name: 'TransformStream',
  exposed: '*',
  ...xattr('Transferable'),
  implementation: impl(TransformStreamImpl, {
    constructWith: [bindingContext],
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
    ]),
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
