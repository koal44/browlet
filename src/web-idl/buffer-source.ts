import * as JSEngine from '../js-engine/index';
import { hasExtendedAttribute } from './core/helpers';
import type { BufferTypeName, BufferViewTypeName, ExtendedAttribute } from './core/types';
import { TypeError } from '../js-engine/exceptions';

// Web IDL §3.2.26 Buffer source types — shared JavaScript-to-IDL buffer conversions.
export function convertBufferSourceToIDL(
  value: unknown,
  name: BufferTypeName,
  extendedAttributes: ExtendedAttribute[],
): ArrayBufferLike | ArrayBufferView {
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
  return value as ArrayBufferLike | ArrayBufferView;
}

// Web IDL §3.2.26 Buffer source types — convert a buffer source to a JavaScript value.
export function convertBufferSourceToJavaScript(
  value: unknown,
  name: BufferTypeName,
): ArrayBufferLike | ArrayBufferView {
  if (!JSEngine.isObject(value) || JSEngine.getBufferTypeName(value) !== name) {
    throw new Error(`IDL ${name} value has the wrong buffer source type`);
  }
  return value as ArrayBufferLike | ArrayBufferView;
}

// Project helper: distinguish buffer views from ArrayBuffer and SharedArrayBuffer.
function isBufferViewTypeName(name: BufferTypeName): name is BufferViewTypeName {
  return name !== 'ArrayBuffer' && name !== 'SharedArrayBuffer';
}
