import * as JSEngine from '../../js-engine/index';
import type { BufferTypeName, BufferViewTypeName, SimpleTypeName } from '../core/types';
import type { ConversionContext } from '../conversion-context';
import { TypeError } from '../../infra/exceptions';
import { InternalError } from '../../infra/internal-error';

/** Validate a buffer source using the buffer type and annotations selected by conversion dispatch. */
// https://webidl.spec.whatwg.org/#js-to-buffer-source
export function jsToIDLBufferSource(
  value: unknown,
  context: ConversionContext,
): ArrayBufferLike | ArrayBufferView {
  const { name } = context.resolvedType as { name: BufferTypeName; };
  const { allowShared, allowResizable } = context;
  if (!JSEngine.isObject(value) || JSEngine.getBufferTypeName(value) !== name) {
    throw new TypeError(`Value is not a ${name}`);
  }

  if (isBufferViewTypeName(name)) {
    const buffer = JSEngine.getArrayBufferViewBuffer(value);
    if (
      JSEngine.getBufferTypeName(buffer) === 'SharedArrayBuffer' &&
      !allowShared
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

/** Preserve a buffer source's identity after checking the buffer type selected by conversion dispatch. */
// https://webidl.spec.whatwg.org/#buffer-source-to-js
export function idlToJSBufferSource(
  value: unknown,
  context: ConversionContext,
): ArrayBufferLike | ArrayBufferView {
  const { name } = context.resolvedType as { name: BufferTypeName; };
  if (!JSEngine.isObject(value) || JSEngine.getBufferTypeName(value) !== name) {
    throw new InternalError(`IDL ${name} value has the wrong buffer source type`);
  }
  return value as ArrayBufferLike | ArrayBufferView;
}

function isBufferViewTypeName(name: BufferTypeName): name is BufferViewTypeName {
  return name !== 'ArrayBuffer' && name !== 'SharedArrayBuffer';
}

/** Simple type names whose conversion validates ArrayBuffer or view storage. */
export const bufferTypeNames = new Set<SimpleTypeName>([
  'ArrayBuffer', 'SharedArrayBuffer', ...JSEngine.bufferViewNames,
]);
