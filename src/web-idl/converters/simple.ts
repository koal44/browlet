import { toScalarValueString, InternalError } from '../../infra/index';

import { isObject, toBigInt, toNumber, toString } from '../../js-engine/index';

import type { SimpleType, WebIDLType } from '../core/index';

import { Converter, integerTypes, type ConversionSteps } from './converter';

/** Prepared scalar conversion, including integer and string annotations. */
export class SimpleConverter<Type extends WebIDLType = WebIDLType> extends Converter<Type> {
  // https://webidl.spec.whatwg.org/#es-type-mapping
  protected createInputSteps(): ConversionSteps {
    const { name } = this.resolvedType as SimpleType;
    const integer = integerTypes[name];
    if (integer) return (value) => this.#toInteger(value, integer.bitLength, integer.signed);
    switch (name) {
      case 'any': return (value) => value;
      case 'undefined': return () => undefined;
      case 'boolean': return (value) => Boolean(value);
      case 'float': return (value) => this.#toFloat(value, false);
      case 'unrestricted float': return (value) => this.#toFloat(value, true);
      case 'double': return (value) => {
        const number = toNumber(value);
        if (!Number.isFinite(number)) this.throwTypeError('Value is not a finite double');
        return number;
      };
      case 'unrestricted double': return (value) => toNumber(value);
      case 'bigint': return (value) => toBigInt(value);
      case 'DOMString': return (value) => {
        if (value === null && this.nullToEmptyString) return '';
        return toString(value);
      };
      case 'ByteString': return (value) => {
        const string = toString(value);
        for (let i = 0; i < string.length; i++) {
          if (string.charCodeAt(i) > 255) this.throwTypeError('Value is not a ByteString');
        }
        return string;
      };
      case 'USVString': return (value) => {
        if (value === null && this.nullToEmptyString) return toScalarValueString('');
        return toScalarValueString(toString(value));
      };
      case 'object': return (value) => {
        if (!isObject(value)) this.throwTypeError('Value is not an object');
        return value;
      };
      case 'symbol': return (value) => {
        if (typeof value !== 'symbol') this.throwTypeError('Value is not a symbol');
        return value;
      };
      default: return () => { throw new InternalError(`Web IDL conversion for ${name} is not implemented`); };
    }
  }

  protected override createOutputSteps(): ConversionSteps | undefined {
    return (this.resolvedType as SimpleType).name === 'undefined' ? () => undefined : undefined;
  }

  // https://webidl.spec.whatwg.org/#abstract-opdef-converttoint
  #toInteger(value: unknown, bitLength: number, signed: boolean): number {
    const mode = this.integerMode;
    let number = toNumber(value);
    if (Object.is(number, -0)) number = 0;

    const lowerBound = bitLength === 64
      ? signed ? -(2 ** 53) + 1 : 0
      : signed ? -(2 ** (bitLength - 1)) : 0;
    const upperBound = bitLength === 64
      ? 2 ** 53 - 1
      : signed ? 2 ** (bitLength - 1) - 1 : 2 ** bitLength - 1;

    if (mode === 'enforce-range') {
      if (!Number.isFinite(number)) {
        this.throwTypeError('Integer is not finite');
      }
      number = Math.trunc(number);
      if (number < lowerBound || number > upperBound) {
        this.throwTypeError('Integer is outside the accepted range');
      }
      return number;
    }

    if (!Number.isNaN(number) && mode === 'clamp') {
      number = Math.min(Math.max(number, lowerBound), upperBound);
      return roundToEven(number);
    }

    if (!Number.isFinite(number) || number === 0) return 0;
    const integer = BigInt(Math.trunc(number));
    return Number(signed
      ? BigInt.asIntN(bitLength, integer)
      : BigInt.asUintN(bitLength, integer));
  }

  // https://webidl.spec.whatwg.org/#es-float
  #toFloat(value: unknown, unrestricted: boolean): number {
    const number = toNumber(value);
    if (!unrestricted && !Number.isFinite(number)) {
      this.throwTypeError('Value is not a finite float');
    }
    const rounded = Math.fround(number);
    if (!unrestricted && !Number.isFinite(rounded)) {
      this.throwTypeError('Value is outside the float range');
    }
    return rounded;
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
