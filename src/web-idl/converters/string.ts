import { toScalarValueString } from '../../infra/index';
import { toString } from '../../js-engine/index';

import type { IDLStringType } from '../assembly/index';
import { Converter, type ConversionSteps } from './converter';

/** Prepare the declared string conversion and null-to-empty-string behavior. */
export class StringConverter<Type extends IDLStringType = IDLStringType> extends Converter<Type> {
  // https://webidl.spec.whatwg.org/#es-DOMString
  // https://webidl.spec.whatwg.org/#es-ByteString
  // https://webidl.spec.whatwg.org/#es-USVString
  protected createInputSteps(): ConversionSteps<string> {
    switch (this.type.name) {
      case 'DOMString': return this.type.nullToEmptyString
        ? (value) => value === null ? '' : toString(value)
        : toString;
      case 'ByteString': return (value) => {
        const string = toString(value);
        for (let i = 0; i < string.length; i++) {
          if (string.charCodeAt(i) > 255) this.throwTypeError('Value is not a ByteString');
        }
        return string;
      };
      case 'USVString': return this.type.nullToEmptyString
        ? (value) => toScalarValueString(value === null ? '' : toString(value))
        : (value) => toScalarValueString(toString(value));
    }
  }
}
