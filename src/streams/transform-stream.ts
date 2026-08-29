// @rollup-cycle streams-transform
import {
  arg, callback, ctor, defineCallbackFunction, defineDictionary,
  defineInterface, dictMember, emptyDictionary, idlType, impl, promise,
  roAttr, reference, xattr,
} from '../web-idl/declaration/index';
import {
  bindingContext, type BindingContext,
} from '../web-idl/projection';
import type { StreamPromise } from './promise';
import {
  extractHighWaterMark, extractSizeAlgorithm, type QueuingStrategy,
} from './queuing-strategy';
import type { ReadableStreamImpl } from './readable-stream';
import {
  initializeTransformStream,
  setUpTransformStreamDefaultControllerFromAlgorithms,
  setUpTransformStreamDefaultControllerFromTransformer,
} from './transform-stream-operations';
import type { TransformStreamDefaultControllerImpl } from './transform-stream-default-controller';
import type { WritableStreamImpl } from './writable-stream';

export class TransformStreamImpl {
  readonly #context: BindingContext;
  readonly #state: TransformStreamState = {};

  constructor(
    context: BindingContext,
    transformer?: object,
    writableStrategy: QueuingStrategy = {},
    readableStrategy: QueuingStrategy = {},
    algorithms?: TransformStreamAlgorithms,
  ) {
    this.#context = context;
    const startPromise = context.createPromise(idlType.any);
    initializeTransformStream(
      this,
      startPromise,
      extractHighWaterMark(
        writableStrategy,
        1,
        context.realm.intrinsics.rangeError,
      ),
      extractSizeAlgorithm(writableStrategy),
      extractHighWaterMark(
        readableStrategy,
        0,
        context.realm.intrinsics.rangeError,
      ),
      extractSizeAlgorithm(readableStrategy),
    );
    if (algorithms) {
      setUpTransformStreamDefaultControllerFromAlgorithms(this, algorithms);
      context.resolvePromise(startPromise, undefined);
      return;
    }

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
    setUpTransformStreamDefaultControllerFromTransformer(
      this,
      transformerObject,
      transformerDictionary,
    );

    const controller = requireStateMember(this.#state.controller, 'controller');
    const startResult = transformerDictionary.start === undefined
      ? undefined
      : Reflect.apply(
        transformerDictionary.start,
        transformerObject,
        [controller],
      );
    context.resolvePromise(startPromise, startResult);
  }

  /** Set up a custom transform stream for another specification. */
  static fromAlgorithms(
    context: BindingContext,
    algorithms: TransformStreamAlgorithms,
  ): TransformStreamImpl {
    return context.construct(
      TransformStreamImpl,
      undefined,
      {},
      {},
      algorithms,
    );
  }

  get readable(): ReadableStreamImpl {
    return requireStateMember(this.#state.readable, 'readable');
  }

  get writable(): WritableStreamImpl {
    return requireStateMember(this.#state.writable, 'writable');
  }

  static getContext(stream: TransformStreamImpl): BindingContext {
    return stream.#context;
  }

  static getState(stream: TransformStreamImpl): TransformStreamState {
    return stream.#state;
  }
}

export type TransformStreamAlgorithms = {
  cancel?(reason: unknown): unknown;
  flush?(controller: TransformStreamDefaultControllerImpl): unknown;
  transform(
    chunk: unknown,
    controller: TransformStreamDefaultControllerImpl,
  ): unknown;
};

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
  exposed: ['Window', 'Worker', 'Worklet'],
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
