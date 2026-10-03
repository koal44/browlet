import type { NullableType, WebIDLType } from '../core/index';

import { Converter, type ConversionSteps } from './converter';

/** Handle null and undefined before applying the nullable branch's own annotated rules. */
// https://webidl.spec.whatwg.org/#es-nullable-type
export class NullableConverter<Type extends WebIDLType = WebIDLType> extends Converter<Type> {
  protected createInputSteps(): ConversionSteps {
    const { type } = this.resolvedType as NullableType;
    const includesUndefined = this.binding.assembly.includesUndefined(type);
    const convert = this.forType(type).inputSteps;
    return (value) => value === undefined && includesUndefined ? undefined
      : value === null || value === undefined ? null : convert(value);
  }

  protected override createOutputSteps(): ConversionSteps {
    const { type } = this.resolvedType as NullableType;
    const convert = this.forType(type).getIDLToJSSteps();
    return (value) => value === null ? null : convert(value);
  }
}
