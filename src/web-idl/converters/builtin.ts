import { isObject, toBigInt } from '../../js-engine/index';

import type {
  IDLAnyType, IDLUndefinedType, IDLBooleanType, IDLBigIntType, IDLObjectType, IDLSymbolType,
} from '../assembly/index';
import { Converter, type ConversionSteps } from './converter';

/** Preserve any author value without coercion. */
export class AnyConverter extends Converter<IDLAnyType> {
  protected createInputSteps(): ConversionSteps { return (value) => value; }
}

/** Discard an input or implementation result for an undefined contract. */
export class UndefinedConverter extends Converter<IDLUndefinedType> {
  protected createInputSteps(): ConversionSteps<undefined> { return () => undefined; }
  protected override createOutputSteps(): ConversionSteps<undefined> { return () => undefined; }
}

/** Convert author values using ToBoolean. */
export class BooleanConverter extends Converter<IDLBooleanType> {
  protected createInputSteps(): ConversionSteps<boolean> { return (value) => Boolean(value); }
}

/** Convert author values using ToBigInt. */
export class BigIntConverter extends Converter<IDLBigIntType> {
  protected createInputSteps(): ConversionSteps<bigint> { return toBigInt; }
}

/** Accept objects, including functions, without coercion. */
export class ObjectConverter extends Converter<IDLObjectType> {
  protected createInputSteps(): ConversionSteps<object> {
    return (value) => {
      if (!isObject(value)) this.throwTypeError('Value is not an object');
      return value;
    };
  }
}

/** Accept symbols without coercion. */
export class SymbolConverter extends Converter<IDLSymbolType> {
  protected createInputSteps(): ConversionSteps<symbol> {
    return (value) => {
      if (typeof value !== 'symbol') this.throwTypeError('Value is not a symbol');
      return value;
    };
  }
}
