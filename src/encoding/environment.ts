import {
  createArrayBufferView, getBufferSourceCopy,
  getBufferSourceByteLength, writeArrayBufferView,
} from '../web-idl/buffer-source';
import { contextValue, type WebIDLType } from '../web-idl/declaration/index';
import type { InterfaceBindingContext } from '../web-idl/projection';
import {
  getStreamEnvironment, type StreamEnvironment,
} from '../streams/environment';

export type EncodingEnvironment = {
  readonly streams: StreamEnvironment;
  convert(value: unknown, type: WebIDLType): unknown;
  copyBytes(value: object): Uint8Array;
  createUint8Array(bytes: Uint8Array): object;
  getByteLength(value: object): number;
  realizeError(error: unknown): never;
  writeBytes(destination: object, bytes: Uint8Array): void;
};

export function getEncodingEnvironment(
  context: InterfaceBindingContext,
): EncodingEnvironment {
  let environment = environments.get(context.callbacks);
  if (!environment) {
    environment = {
      streams: getStreamEnvironment(context),
      convert: (value, type) => context.conversions.convert(value, type),
      copyBytes: getBufferSourceCopy,
      createUint8Array: (bytes) => createArrayBufferView(
        'Uint8Array',
        bytes,
        context.realm,
      ),
      getByteLength: getBufferSourceByteLength,
      realizeError(error): never {
        if (error instanceof RangeError) {
          throw new context.realm.intrinsics.rangeError(error.message);
        }
        if (error instanceof TypeError) {
          throw new context.realm.intrinsics.typeError(error.message);
        }
        throw error;
      },
      writeBytes: writeArrayBufferView,
    };
    environments.set(context.callbacks, environment);
  }
  return environment;
}

export const encodingEnvironment = contextValue(getEncodingEnvironment);

const environments = new WeakMap<object, EncodingEnvironment>();
