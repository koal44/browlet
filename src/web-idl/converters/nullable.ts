import type { IDLNullableType } from '../assembly/index';
import { Converter, type ConversionSteps } from './converter';

/** Handle null and undefined before applying the nullable branch's own annotated rules. */
// https://webidl.spec.whatwg.org/#es-nullable-type
export class NullableConverter<Type extends IDLNullableType = IDLNullableType> extends Converter<Type> {
  protected createInputSteps(): ConversionSteps {
    const type = this.type.innerType;
    const includesUndefined = this.binding.assembly.includesUndefined(type);
    const convert = this.forType(type).inputSteps;
    return (value) => value === undefined && includesUndefined ? undefined
      : value === null || value === undefined ? null : convert(value);
  }

  protected override createOutputSteps(): ConversionSteps {
    const type = this.type.innerType;
    const convert = this.forType(type).getIDLToJSSteps();
    return (value) => value === null ? null : convert(value);
  }
}
