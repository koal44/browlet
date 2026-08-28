// @rollup-cycle streams-transform
import {
  arg, callback, ctor, defineCallbackFunction, defineDictionary,
  defineInterface, dictMember, emptyDictionary, idlType, impl, promise,
  roAttr, reference, xattr,
} from '../web-idl/declaration/index';
import {
  streamEnvironment, type StreamEnvironment, type StreamPromise,
} from './environment';
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
  readonly #environment: StreamEnvironment;
  readonly #state: TransformStreamState = {};

  constructor(
    environment: StreamEnvironment,
    transformer?: object,
    writableStrategy: QueuingStrategy = {},
    readableStrategy: QueuingStrategy = {},
    algorithms?: TransformStreamAlgorithms,
  ) {
    this.#environment = environment;
    const startPromise = environment.promises.create(idlType.any);
    initializeTransformStream(
      this,
      startPromise,
      extractHighWaterMark(writableStrategy, 1),
      extractSizeAlgorithm(writableStrategy),
      extractHighWaterMark(readableStrategy, 0),
      extractSizeAlgorithm(readableStrategy),
    );
    if (algorithms) {
      setUpTransformStreamDefaultControllerFromAlgorithms(this, algorithms);
      environment.promises.resolve(startPromise, undefined);
      return;
    }

    const transformerObject = transformer ?? null;
    const transformerDictionary = environment.dictionaries.convert(
      transformerObject,
      reference('Transformer'),
    ) as Transformer;
    if ('readableType' in transformerDictionary) {
      throw new RangeError('Invalid readableType specified');
    }
    if ('writableType' in transformerDictionary) {
      throw new RangeError('Invalid writableType specified');
    }
    setUpTransformStreamDefaultControllerFromTransformer(
      this,
      transformerObject,
      transformerDictionary,
    );

    const controller = requireStateMember(this.#state.controller, 'controller');
    const startResult = transformerDictionary.start === undefined
      ? undefined
      : environment.callbacks.invoke(
        transformerDictionary.start,
        [controller],
        'rethrow',
        transformerObject,
      );
    environment.promises.resolve(startPromise, startResult);
  }

  /** Set up a custom transform stream for another specification. */
  static fromAlgorithms(
    environment: StreamEnvironment,
    algorithms: TransformStreamAlgorithms,
  ): TransformStreamImpl {
    return new TransformStreamImpl(
      environment,
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

  static getEnvironment(stream: TransformStreamImpl): StreamEnvironment {
    return stream.#environment;
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
    withArgs: [streamEnvironment],
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
    dictMember('transform', reference('TransformerTransformCallback'),
      callback('rethrow')),
    dictMember('flush', reference('TransformerFlushCallback'),
      callback('rethrow')),
    dictMember('cancel', reference('TransformerCancelCallback'),
      callback('rethrow')),
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
