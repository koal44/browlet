import {
  getEncodingEnvironment,
} from '../encoding/environment';
import { TextDecoderStreamImpl } from '../encoding/text-decoder-stream';
import {
  getStreamEnvironment, type StreamEnvironment, type StreamPromise,
} from '../streams/environment';
import {
  createArrayBuffer, createArrayBufferView,
} from '../web-idl/buffer-source';
import { defineCapability } from '../web-idl/capability';
import {
  contextValue, type WebIDLType,
} from '../web-idl/declaration/index';
import type { InterfaceBindingContext } from '../web-idl/projection';

/** Host services which File API algorithms cannot derive from ECMAScript. */
export const fileHost = defineCapability<FileHost>('File host');

export type FileHost = {
  getNativeLineEnding(global: object): NativeLineEnding;
  queueFileReadingTask(global: object, steps: () => void): void;
  runInParallel(global: object, steps: () => void): void;
};

/** Constructor-time Blob state which remains meaningful without projection. */
export type BlobEnvironment = {
  nativeLineEnding: NativeLineEnding;
};

/** Realm and host operations used by Blob's projected read surfaces. */
export type FileEnvironment = BlobEnvironment & {
  readonly streams: StreamEnvironment;
  readonly promises: {
    create(type: WebIDLType): StreamPromise;
    createRejected(reason: unknown, type: WebIDLType): StreamPromise;
    reject(promise: StreamPromise, reason: unknown): void;
    resolve(promise: StreamPromise, value: unknown): void;
  };
  createArrayBuffer(bytes: Uint8Array): object;
  createTextDecoderStream(): TextDecoderStreamImpl;
  createUint8Array(bytes: Uint8Array): object;
  queueFileReadingTask(steps: () => void): void;
  realizeException(exception: unknown): unknown;
  runInParallel(steps: () => void): void;
};

export type NativeLineEnding = '\n' | '\r\n';

export function getFileEnvironment(
  context: InterfaceBindingContext,
): FileEnvironment {
  let environment = environments.get(context.callbacks);
  if (environment) return environment;

  const global = context.interfaces.resolve(context.realm.global);
  const host = global && context.interfaces.getCapability(
    global.primaryInterface,
    fileHost,
  );
  if (!global || !host) {
    throw new Error('The relevant global has no File host capability');
  }

  environment = {
    nativeLineEnding: host.getNativeLineEnding(global.implementation),
    streams: getStreamEnvironment(context),
    promises: {
      create: (type) => requireObject(context.promises.create(type)),
      createRejected: (reason, type) =>
        requireObject(context.promises.createRejected(reason, type)),
      reject: (promise, reason) => context.promises.reject(promise, reason),
      resolve: (promise, value) => context.promises.resolve(promise, value),
    },
    createArrayBuffer: (bytes) => createArrayBuffer(bytes, context.realm),
    createTextDecoderStream: () => context.objects.construct(
      TextDecoderStreamImpl,
      [getEncodingEnvironment(context)],
    ),
    createUint8Array: (bytes) => createArrayBufferView(
      'Uint8Array',
      bytes,
      context.realm,
    ),
    queueFileReadingTask: (steps) =>
      host.queueFileReadingTask(global.implementation, steps),
    realizeException: (exception) => context.exceptions.realize(exception),
    runInParallel: (steps) => host.runInParallel(
      global.implementation,
      steps,
    ),
  };
  environments.set(context.callbacks, environment);
  return environment;
}

export const fileEnvironment = contextValue(getFileEnvironment);

function requireObject(value: unknown): object {
  if (
    (typeof value !== 'object' || value === null) &&
    typeof value !== 'function'
  ) {
    throw new TypeError('Expected a Web IDL object value');
  }
  return value;
}

const environments = new WeakMap<object, FileEnvironment>();
