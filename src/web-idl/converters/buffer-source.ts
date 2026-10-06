import { TypeError, InternalError } from '../../infra/index';
import * as JSEngine from '../../js-engine/index';

import type { IDLBufferType } from '../assembly/index';
import { Converter, type ConversionSteps } from './converter';

/** Validate buffer identity and the sharing/resizing rules of one declared use. */
export class BufferSourceConverter<Type extends IDLBufferType = IDLBufferType> extends Converter<Type> {
  // https://webidl.spec.whatwg.org/#es-buffer-source-types
  protected createInputSteps(): ConversionSteps<ArrayBufferLike | ArrayBufferView> {
    const { name, isView, allowShared, allowResizable } = this.type;
    return (value) => {
      if (!JSEngine.isBufferType(value, name)) {
        throw new TypeError(`Value is not a ${name}`);
      }

      const buffer = JSEngine.isAnyArrayBuffer(value) ? value : JSEngine.getArrayBufferViewBuffer(value);
      if (isView && !allowShared && JSEngine.isSharedArrayBuffer(buffer)) {
        throw new TypeError(`${name} is backed by a SharedArrayBuffer`);
      }
      if (!allowResizable && JSEngine.isResizableArrayBuffer(buffer)) {
        throw new TypeError(isView ? `${name} is backed by a resizable buffer` : `${name} is resizable`);
      }
      return value;
    };
  }

  protected override createOutputSteps(): ConversionSteps<ArrayBufferLike | ArrayBufferView> {
    const { name } = this.type;
    return (value) => {
      if (!JSEngine.isBufferType(value, name)) {
        throw new InternalError(`IDL ${name} value has the wrong buffer source type`);
      }
      return value;
    };
  }
}
