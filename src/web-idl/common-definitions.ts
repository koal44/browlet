import { annotated, arg, reference, union, xattr } from './core/helpers';
import { idlType } from './core/types';
import { defineCallbackFunction, defineTypedef } from './core/declarations';
import {
  domExceptionIDL, quotaExceededErrorIDL, quotaExceededErrorOptionsIDL,
} from './dom-exception';

/*
 * callback Function = any (any... arguments);
 */

// Web IDL §4.5 Function.
export const functionIDL = defineCallbackFunction({
  name: 'Function',
  returns: idlType.any,
  arguments: [arg('arguments', idlType.any, { variadic: true })],
});

/*
 * callback VoidFunction = undefined ();
 */

// Web IDL §4.6 VoidFunction.
export const voidFunctionIDL = defineCallbackFunction({
  name: 'VoidFunction',
  returns: idlType.undefined,
  arguments: [],
});

/*
 * typedef (Int8Array or Int16Array or Int32Array or
 *          Uint8Array or Uint16Array or Uint32Array or Uint8ClampedArray or
 *          BigInt64Array or BigUint64Array or
 *          Float16Array or Float32Array or Float64Array or DataView)
 *          ArrayBufferView;
 */

// Web IDL §4.1 ArrayBufferView.
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

// Web IDL §4.2 BufferSource.
export const bufferSourceIDL = defineTypedef({
  name: 'BufferSource',
  type: union(reference('ArrayBufferView'), idlType.ArrayBuffer),
});

/*
 * typedef (ArrayBuffer or SharedArrayBuffer or [AllowShared] ArrayBufferView)
 *         AllowSharedBufferSource;
 */

// Web IDL §4.3 AllowSharedBufferSource.
export const allowSharedBufferSourceIDL = defineTypedef({
  name: 'AllowSharedBufferSource',
  type: union(
    idlType.ArrayBuffer,
    idlType.SharedArrayBuffer,
    annotated(reference('ArrayBufferView'), xattr('AllowShared')),
  ),
});

// Project registration list for the common definitions and exception interfaces.
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
