import * as JSEngine from '../js-engine/index';
import {
  hasExtendedAttribute, type BufferTypeName, type BufferViewTypeName,
  type ExtendedAttribute,
} from './declaration/definition';
import { TypeError } from '../js-engine/simple-exception';

export function convertBufferSourceToIDL(
  value: unknown,
  name: BufferTypeName,
  extendedAttributes: ExtendedAttribute[],
): object {
  if (!JSEngine.isObject(value) || JSEngine.getBufferTypeName(value) !== name) {
    throw new TypeError(`Value is not a ${name}`);
  }

  const allowResizable = hasExtendedAttribute(
    extendedAttributes,
    'AllowResizable',
  );
  if (isBufferViewTypeName(name)) {
    const buffer = JSEngine.getArrayBufferViewBuffer(value);
    if (
      JSEngine.getBufferTypeName(buffer) === 'SharedArrayBuffer' &&
      !hasExtendedAttribute(extendedAttributes, 'AllowShared')
    ) {
      throw new TypeError(`${name} is backed by a SharedArrayBuffer`);
    }
    if (!allowResizable && JSEngine.isResizableArrayBuffer(buffer)) {
      throw new TypeError(`${name} is backed by a resizable buffer`);
    }
  } else if (!allowResizable && JSEngine.isResizableArrayBuffer(value)) {
    throw new TypeError(`${name} is resizable`);
  }
  return value;
}

export function convertBufferSourceToJavaScript(
  value: unknown,
  name: BufferTypeName,
): object {
  if (!JSEngine.isObject(value) || JSEngine.getBufferTypeName(value) !== name) {
    throw new Error(`IDL ${name} value has the wrong buffer source type`);
  }
  return value;
}

// Compatibility exports for callers migrating below the Web IDL boundary.
export {
  createArrayBuffer, createArrayBufferView, createArrayBufferViewFromBuffer,
  createSharedArrayBuffer, detachArrayBuffer, getBufferSourceByteLength,
  getBufferSourceByteOffset, getBufferSourceCopy, getBufferSourceUnderlyingBuffer,
  getBufferTypeName, isBufferSourceDetached, transferArrayBuffer,
  writeArrayBuffer, writeArrayBufferView, type ByteSequence,
} from '../js-engine/index';

function isBufferViewTypeName(name: BufferTypeName): name is BufferViewTypeName {
  return name !== 'ArrayBuffer' && name !== 'SharedArrayBuffer';
}
