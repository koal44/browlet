import {
  annotated, arg, defineCallbackFunction, defineTypedef, idlType, reference,
  union, xattr,
} from './declaration/definition';
import {
  domExceptionIDL, quotaExceededErrorIDL, quotaExceededErrorOptionsIDL,
} from './dom-exception';

/*
 * callback Function = any (any... arguments);
 */

export const functionIDL = defineCallbackFunction({
  arguments: [arg('arguments', idlType.any, { variadic: true })],
  name: 'Function',
  returns: idlType.any,
});

/*
 * callback VoidFunction = undefined ();
 */

export const voidFunctionIDL = defineCallbackFunction({
  arguments: [],
  name: 'VoidFunction',
  returns: idlType.undefined,
});

/*
 * typedef (Int8Array or Int16Array or Int32Array or
 *          Uint8Array or Uint16Array or Uint32Array or Uint8ClampedArray or
 *          BigInt64Array or BigUint64Array or
 *          Float16Array or Float32Array or Float64Array or DataView)
 *          ArrayBufferView;
 */

export const arrayBufferViewIDL = defineTypedef({
  name: 'ArrayBufferView',
  type: union(
    idlType.Int8Array,
    idlType.Int16Array,
    idlType.Int32Array,
    idlType.Uint8Array,
    idlType.Uint16Array,
    idlType.Uint32Array,
    idlType.Uint8ClampedArray,
    idlType.BigInt64Array,
    idlType.BigUint64Array,
    idlType.Float16Array,
    idlType.Float32Array,
    idlType.Float64Array,
    idlType.DataView,
  ),
});

/*
 * typedef (ArrayBufferView or ArrayBuffer) BufferSource;
 */

export const bufferSourceIDL = defineTypedef({
  name: 'BufferSource',
  type: union(reference('ArrayBufferView'), idlType.ArrayBuffer),
});

/*
 * typedef (ArrayBuffer or SharedArrayBuffer or [AllowShared] ArrayBufferView)
 *         AllowSharedBufferSource;
 */

export const allowSharedBufferSourceIDL = defineTypedef({
  name: 'AllowSharedBufferSource',
  type: union(
    idlType.ArrayBuffer,
    idlType.SharedArrayBuffer,
    annotated(reference('ArrayBufferView'), xattr('AllowShared')),
  ),
});

export const webIDLCommonDefinitions = [
  arrayBufferViewIDL,
  bufferSourceIDL,
  allowSharedBufferSourceIDL,
  domExceptionIDL,
  quotaExceededErrorIDL,
  quotaExceededErrorOptionsIDL,
  functionIDL,
  voidFunctionIDL,
];
