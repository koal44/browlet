import { TypeError, InternalError } from '../../infra/index';
import * as JSEngine from '../../js-engine/index';
import type { BufferTypeName, BufferViewTypeName } from '../core/index';

import type { IDLBufferType } from '../assembly/index';
import { Converter, type ConversionSteps } from './converter';

/** Validate buffer identity and the sharing/resizing rules of one declared use. */
export class BufferSourceConverter<Type extends IDLBufferType = IDLBufferType> extends Converter<Type> {
  // https://webidl.spec.whatwg.org/#es-buffer-source-types
  protected createInputSteps(): ConversionSteps<ArrayBufferLike | ArrayBufferView> {
    const { name } = this.type;
    const { allowShared, allowResizable } = this.type;
    return (value) => {
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
    };
  }

  protected override createOutputSteps(): ConversionSteps<ArrayBufferLike | ArrayBufferView> {
    const { name } = this.type;
    return (value) => {
      if (!JSEngine.isObject(value) || JSEngine.getBufferTypeName(value) !== name) {
        throw new InternalError(`IDL ${name} value has the wrong buffer source type`);
      }
      return value as ArrayBufferLike | ArrayBufferView;
    };
  }
}

function isBufferViewTypeName(name: BufferTypeName): name is BufferViewTypeName {
  return name !== 'ArrayBuffer' && name !== 'SharedArrayBuffer';
}
