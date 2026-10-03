import { toNumber } from '../../js-engine/index';

import type { IDLIntegerType } from '../assembly/index';
import { Converter, type ConversionSteps } from './converter';

/** Prepare the declared integer width, signedness, and overflow behavior. */
export class IntegerConverter<Type extends IDLIntegerType = IDLIntegerType> extends Converter<Type> {
  // https://webidl.spec.whatwg.org/#abstract-opdef-converttoint
  protected createInputSteps(): ConversionSteps<number> {
    const { bitLength, signed, lowerBound, upperBound } = this.type.format;

    switch (this.type.integerMode) {
      case 'enforce-range': return (value) => {
        let number = toNumber(value);
        if (!Number.isFinite(number)) this.throwTypeError('Integer is not finite');
        if (Object.is(number, -0)) number = 0;
        number = Math.trunc(number);
        if (number < lowerBound || number > upperBound) this.throwTypeError('Integer is outside the accepted range');
        return number;
      };
      case 'clamp': return (value) => {
        const number = toNumber(value);
        if (Number.isNaN(number)) return 0;
        return roundToEven(Math.min(Math.max(number, lowerBound), upperBound));
      };
      case 'wrap': {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- BigInt's width conversions do not use their receiver.
        const wrap = signed ? BigInt.asIntN : BigInt.asUintN;
        return (value) => {
          const number = toNumber(value);
          if (!Number.isFinite(number) || number === 0) return 0;
          return Number(wrap(bitLength, BigInt(Math.trunc(number))));
        };
      }
    }
  }
}

// ConvertToInt's [Clamp] rounding step.
function roundToEven(value: number): number {
  const lower = Math.floor(value);
  const difference = value - lower;
  if (difference < 0.5) return lower === 0 ? 0 : lower;
  if (difference > 0.5) return lower + 1;
  const result = lower % 2 === 0 ? lower : lower + 1;
  return result === 0 ? 0 : result;
}
