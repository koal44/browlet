import { toNumber } from '../../js-engine/index';

import type { IDLFloatType } from '../assembly/index';
import { Converter, type ConversionSteps } from './converter';

/** Prepare float or double conversion with the declared restrictions on non-finite values. */
export class FloatConverter<Type extends IDLFloatType = IDLFloatType> extends Converter<Type> {
  // https://webidl.spec.whatwg.org/#es-float
  // https://webidl.spec.whatwg.org/#es-double
  protected createInputSteps(): ConversionSteps<number> {
    switch (this.type.name) {
      case 'float': return (value) => {
        const number = toNumber(value);
        if (!Number.isFinite(number)) this.throwTypeError('Value is not a finite float');
        const rounded = Math.fround(number);
        if (!Number.isFinite(rounded)) this.throwTypeError('Value is outside the float range');
        return rounded;
      };
      case 'unrestricted float': return (value) => Math.fround(toNumber(value));
      case 'double': return (value) => {
        const number = toNumber(value);
        if (!Number.isFinite(number)) this.throwTypeError('Value is not a finite double');
        return number;
      };
      case 'unrestricted double': return toNumber;
    }
  }
}
