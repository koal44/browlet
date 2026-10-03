import { InternalError } from '../../infra/index';
import { toString } from '../../js-engine/index';

import type { IDLEnumerationType, IDLProxyType, IDLObservableArrayType } from '../assembly/index';
import { Converter, type ConversionSteps } from './converter';

/** Coerce an enum value to a string and check the assembled declaration's membership set. */
export class EnumerationConverter<Type extends IDLEnumerationType = IDLEnumerationType> extends Converter<Type> {
  // https://webidl.spec.whatwg.org/#es-enumeration
  protected createInputSteps(): ConversionSteps<string> {
    const assembled = this.type.assembled;
    return (value) => {
      const string = toString(value);
      if (!assembled.hasValue(string)) {
        this.throwTypeError(`${string} is not a value of ${assembled.primary.name}`);
      }
      return string;
    };
  }
}

/** Preserve recognized proxy objects, such as a WindowProxy. */
export class ProxyObjectConverter<Type extends IDLProxyType = IDLProxyType> extends Converter<Type> {
  protected createInputSteps(): ConversionSteps {
    const assembled = this.type.assembled;
    return (value) => assembled.is(value) ? value : this.throwTypeError(`Value does not implement ${assembled.primary.name}`);
  }

  protected override createOutputSteps(): ConversionSteps {
    const assembled = this.type.assembled;
    return (value) => {
      if (assembled.is(value)) return value;
      throw new InternalError(`IDL interface value does not implement ${assembled.primary.name}`);
    };
  }
}

/** Observable arrays are supported by attribute bindings; general value conversion remains unimplemented. */
export class ObservableArrayConverter<Type extends IDLObservableArrayType = IDLObservableArrayType> extends Converter<Type> {
  protected createInputSteps(): ConversionSteps {
    return () => { throw new InternalError('Web IDL conversion for observable-array is not implemented'); };
  }
  protected override createOutputSteps(): ConversionSteps { return this.createInputSteps(); }
}
