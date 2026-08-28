import {
  contextValue, type BufferViewTypeName, type WebIDLType,
} from '../web-idl/declaration/index';
import {
  createArrayBuffer, getBufferSourceByteLength,
  getBufferSourceByteOffset, getBufferSourceCopy,
  getBufferSourceUnderlyingBuffer, getBufferTypeName,
  isBufferSourceDetached, transferArrayBuffer, writeArrayBuffer,
} from '../web-idl/buffer-source';
import {
  closeAsyncIterator, endOfIteration, getAsyncIteratorNextValue,
  openAsyncSequence, type IDLAsyncIterator, type IDLAsyncSequence,
} from '../web-idl/async-sequence';
import { defineCapability } from '../web-idl/capability';
import type { InterfaceBindingContext } from '../web-idl/projection';

export const streamStructuredData = defineCapability<StreamStructuredData>(
  'Streams structured data',
);

export type StreamStructuredData = {
  clone(global: object, value: unknown): unknown;
};

export type StreamEnvironment = {
  readonly abort: {
    createController(): StreamAbortController;
  };
  readonly buffers: {
    clone(
      buffer: object,
      byteOffset: number,
      byteLength: number,
    ): object;
    copy(
      destination: object,
      destinationOffset: number,
      source: object,
      sourceOffset: number,
      byteLength: number,
    ): void;
    copyBytes(value: object): Uint8Array;
    create(byteLength: number): object;
    createView(
      type: BufferViewTypeName,
      buffer: object,
      byteOffset: number,
      length: number,
    ): object;
    getBuffer(view: object): object;
    getByteLength(value: object): number;
    getByteOffset(view: object): number;
    getViewType(view: object): BufferViewTypeName;
    isDetached(value: object): boolean;
    transfer(buffer: object): object;
  };
  readonly callbacks: {
    createFunction(
      steps: StreamFunctionSteps,
      options: StreamFunctionOptions,
    ): CallableFunction;
    invoke(
      value: unknown,
      argumentsList: readonly unknown[],
      exceptionBehavior?: 'report' | 'rethrow',
      thisArgument?: unknown,
    ): unknown;
  };
  readonly dictionaries: {
    convert(value: unknown, type: WebIDLType): unknown;
    create(entries: readonly (readonly [string, unknown])[]): unknown;
  };
  readonly exceptions: {
    createTypeError(message: string): TypeError;
  };
  readonly structuredData: {
    clone(value: unknown): unknown;
  };
  readonly iteration: {
    readonly end: unknown;
    close(iterator: object, reason: unknown): StreamPromise;
    getNext(iterator: object): StreamPromise;
    open(iterable: object): object;
  };
  readonly objects: {
    construct<Value extends object>(
      implementation: StreamImplementationConstructor<Value>,
      argumentsList: readonly unknown[],
    ): Value;
    create<Value extends object>(
      implementation: StreamImplementationConstructor<Value>,
    ): Value;
  };
  readonly promises: {
    create(type: WebIDLType): StreamPromise;
    createRejected(reason: unknown, type: WebIDLType): StreamPromise;
    createResolved(value: unknown, type: WebIDLType): StreamPromise;
    isPending(value: StreamPromise): boolean;
    markHandled(value: StreamPromise): void;
    react(
      value: StreamPromise,
      resultType: WebIDLType,
      steps: StreamPromiseReactionSteps,
    ): StreamPromise;
    reject(value: StreamPromise, reason: unknown): void;
    resolve(value: StreamPromise, result: unknown): void;
    waitForAll(
      values: readonly StreamPromise[],
      type: WebIDLType,
    ): StreamPromise;
  };
  queueMicrotask(steps: () => void): void;
};

export type StreamAbortController = {
  abort(reason?: unknown): void;
  readonly signal: object;
};

export type StreamPromise = object;

export type StreamPromiseReactionSteps = {
  fulfilled?(value: unknown): unknown;
  rejected?(reason: unknown): unknown;
};

export function getStreamEnvironment(
  context: StreamBindingContext,
): StreamEnvironment {
  let environment = environments.get(context.callbacks);
  if (!environment) {
    const global = context.interfaces.resolve(context.realm.global);
    const structuredData = global && context.interfaces.getCapability(
      global.primaryInterface,
      streamStructuredData,
    );
    environment = {
      abort: {
        createController: () =>
          context.objects.createForInterface<StreamAbortController>(
            'AbortController',
          ),
      },
      buffers: {
        clone(buffer, byteOffset, byteLength) {
          return createArrayBuffer(
            getBufferSourceCopy(buffer).slice(
              byteOffset,
              byteOffset + byteLength,
            ),
            context.realm,
          );
        },
        copy(
          destination,
          destinationOffset,
          source,
          sourceOffset,
          byteLength,
        ) {
          writeArrayBuffer(
            destination,
            getBufferSourceCopy(source).slice(
              sourceOffset,
              sourceOffset + byteLength,
            ),
            destinationOffset,
          );
        },
        copyBytes: getBufferSourceCopy,
        create: (byteLength) => createArrayBuffer(
          new Uint8Array(byteLength),
          context.realm,
        ),
        createView(type, buffer, byteOffset, length) {
          const constructor = context.realm.intrinsics.bufferSource.views[
            type
          ];
          if (!constructor) {
            throw new Error(`The relevant realm has no ${type} intrinsic`);
          }
          return Reflect.construct(
            constructor,
            [buffer, byteOffset, length],
          ) as object;
        },
        getBuffer: getBufferSourceUnderlyingBuffer,
        getByteLength: getBufferSourceByteLength,
        getByteOffset: getBufferSourceByteOffset,
        getViewType(view) {
          const type = getBufferTypeName(view);
          if (!type || type === 'ArrayBuffer' ||
            type === 'SharedArrayBuffer') {
            throw new TypeError('Value is not an ArrayBuffer view');
          }
          return type;
        },
        isDetached: isBufferSourceDetached,
        transfer: (buffer) => transferArrayBuffer(buffer, context.realm),
      },
      callbacks: {
        createFunction: (steps, options) =>
          context.realm.createFunction(steps, options),
        invoke: (value, argumentsList, exceptionBehavior, thisArgument) =>
          context.callbacks.invokeFunction(
            value,
            argumentsList,
            exceptionBehavior,
            thisArgument,
          ),
      },
      dictionaries: {
        convert: (value, type) => context.conversions.convert(value, type),
        create: (entries) => new Map(entries),
      },
      exceptions: {
        createTypeError: (message) =>
          new context.realm.intrinsics.typeError(message),
      },
      structuredData: {
        clone(value) {
          if (!global || !structuredData) {
            throw new Error(
              'The stream realm has no structured-data capability',
            );
          }
          try {
            return structuredData.clone(global.implementation, value);
          } catch (exception) {
            throw context.exceptions.realize(exception);
          }
        },
      },
      iteration: {
        end: endOfIteration,
        close: (iterator, reason) => closeAsyncIterator(
          iterator as IDLAsyncIterator,
          reason,
          context.realm,
        ),
        getNext: (iterator) => getAsyncIteratorNextValue(
          iterator as IDLAsyncIterator,
          context.realm,
          (value, type) => context.conversions.convert(value, type),
        ),
        open: (iterable) => openAsyncSequence(
          iterable as IDLAsyncSequence,
          context.realm,
        ),
      },
      objects: {
        construct: (implementation, argumentsList) =>
          context.objects.construct(
            implementation,
            [environment, ...argumentsList],
          ),
        create: (implementation) => context.objects.create(implementation),
      },
      promises: {
        create: (type) => requireObject(context.promises.create(type)),
        createRejected: (reason, type) =>
          requireObject(context.promises.createRejected(reason, type)),
        createResolved: (value, type) =>
          requireObject(context.promises.createResolved(value, type)),
        // Writer promises resolve only with undefined, so capability
        // resolution and underlying promise settlement are equivalent here.
        isPending: (value) => context.promises.isUnresolved(value),
        markHandled: (value) => context.promises.markHandled(value),
        react: (value, resultType, steps) => requireObject(
          context.promises.react(value, resultType, steps),
        ),
        reject: (value, reason) => context.promises.reject(value, reason),
        resolve: (value, result) => context.promises.resolve(value, result),
        waitForAll: (values, type) => requireObject(
          context.promises.waitForAll(values, type),
        ),
      },
      queueMicrotask: (steps) => context.realm.queueMicrotask(steps),
    };
    environments.set(context.callbacks, environment);
  }
  return environment;
}

export const streamEnvironment = contextValue(getStreamEnvironment);

type StreamBindingContext = InterfaceBindingContext;

type StreamFunctionSteps = (
  thisArgument: unknown,
  argumentsList: unknown[],
  newTarget: CallableFunction | undefined,
) => unknown;

type StreamFunctionOptions = {
  readonly constructible?: boolean;
  readonly length: number;
  readonly name: string;
};

type StreamImplementationConstructor<Value extends object> = {
  readonly prototype: Value;
};

function requireObject(value: unknown): object {
  if ((typeof value !== 'object' || value === null) &&
    typeof value !== 'function') {
    throw new TypeError('Expected a Web IDL object value');
  }
  return value;
}

const environments = new WeakMap<object, StreamEnvironment>();
