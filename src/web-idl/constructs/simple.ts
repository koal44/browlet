import { InternalError } from '../../infra/internal-error';
import { toScalarValueString } from '../../infra/index';
import { isObject, toBigInt, toNumber, toString } from '../../js-engine/index';
import type { SimpleType, SimpleTypeName } from '../core/types';
import type { ConversionContext } from '../conversion-context';
import type { ValueConverter } from '../conversion';
import { bufferTypeNames, jsToIDLBufferSource, idlToJSBufferSource } from './buffer-source';

// The dispatchers select each helper by resolved type; the assertions below retain
// that selection without inspecting the type again for every converted value.
// Shared implementation of the simple-type conversions in Web IDL §3.2 JavaScript type mapping.
export function jsToIDLSimple(
  value: unknown,
  context: ConversionContext,
): unknown {
  const { name } = context.resolvedType as SimpleType;
  const integerType = integerTypes[name];
  if (integerType) {
    return convertToInteger(
      value,
      integerType.bitLength,
      integerType.signed,
      context,
    );
  }

  if (bufferTypeNames.has(name)) {
    return jsToIDLBufferSource(value, context);
  }

  const convert = jsToIDLSimpleConverters[name];
  if (!convert) throw new InternalError(`Web IDL conversion for ${name} is not implemented`);
  return convert(value, context);
}

// Shared simple-type IDL-to-JavaScript conversion rules from Web IDL §3.2 JavaScript type mapping.
export function idlToJSSimple(
  value: unknown,
  context: ConversionContext,
): unknown {
  const { name } = context.resolvedType as SimpleType;
  if (bufferTypeNames.has(name)) {
    return idlToJSBufferSource(value, context);
  }
  return name === 'undefined' ? undefined : value;
}

/** Select an integer, scalar, or buffer converter once for this declared simple type. */
export function createJSToIDLSimpleConverter(context: ConversionContext): ValueConverter {
  const { name } = context.resolvedType as SimpleType;
  const integer = integerTypes[name];
  const simple = jsToIDLSimpleConverters[name];
  return integer
    ? (value) => convertToInteger(value, integer.bitLength, integer.signed, context)
    : simple
      ? (value) => simple(value, context)
      : (value) => jsToIDLSimple(value, context);
}

// Web IDL §3.2.4.9 Abstract operations — ConvertToInt.
function convertToInteger(
  value: unknown,
  bitLength: number,
  signed: boolean,
  context: ConversionContext,
): number {
  const mode = context.integerMode;
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
      context.throwTypeError('Integer is not finite');
    }
    number = Math.trunc(number);
    if (number < lowerBound || number > upperBound) {
      context.throwTypeError('Integer is outside the accepted range');
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

// Shared JavaScript-to-IDL conversions from Web IDL §3.2.5 float and §3.2.6 unrestricted float.
function convertToFloat(
  value: unknown,
  unrestricted: boolean,
  context: ConversionContext,
): number {
  const number = toNumber(value);
  if (!unrestricted && !Number.isFinite(number)) {
    context.throwTypeError('Value is not a finite float');
  }
  const rounded = Math.fround(number);
  if (!unrestricted && !Number.isFinite(rounded)) {
    context.throwTypeError('Value is outside the float range');
  }
  return rounded;
}

// Extracted from Web IDL §3.2.4.9 Abstract operations — ConvertToInt's [Clamp] rounding step.
function roundToEven(value: number): number {
  const lower = Math.floor(value);
  const difference = value - lower;
  if (difference < 0.5) return lower === 0 ? 0 : lower;
  if (difference > 0.5) return lower + 1;
  const result = lower % 2 === 0 ? lower : lower + 1;
  return result === 0 ? 0 : result;
}

/** Integer conversion parameters, also used to recognize validated integer defaults. */
// https://webidl.spec.whatwg.org/#js-integer-types
export const integerTypes: Partial<Record<
  SimpleTypeName,
  { bitLength: number; signed: boolean; }
>> = {
  byte: { bitLength: 8, signed: true },
  octet: { bitLength: 8, signed: false },
  short: { bitLength: 16, signed: true },
  'unsigned short': { bitLength: 16, signed: false },
  long: { bitLength: 32, signed: true },
  'unsigned long': { bitLength: 32, signed: false },
  'long long': { bitLength: 64, signed: true },
  'unsigned long long': { bitLength: 64, signed: false },
};

// https://webidl.spec.whatwg.org/#es-type-mapping
// The generic converter and prepared inputs use the same conversion algorithms.
const jsToIDLSimpleConverters: Partial<Record<SimpleTypeName, (
  value: unknown,
  context: ConversionContext,
) => unknown>> = {
  any: (value) => value,
  undefined: () => undefined,
  boolean: (value) => Boolean(value),
  float: (value, context) => convertToFloat(value, false, context),
  'unrestricted float': (value, context) => convertToFloat(value, true, context),
  double(value, context) {
    const number = toNumber(value);
    if (!Number.isFinite(number)) context.throwTypeError('Value is not a finite double');
    return number;
  },
  'unrestricted double': (value) => toNumber(value),
  bigint: (value) => toBigInt(value),
  DOMString(value, context) {
    if (value === null && context.nullToEmptyString) return '';
    return toString(value);
  },
  ByteString(value, context) {
    const string = toString(value);
    for (let i = 0; i < string.length; i++) {
      if (string.charCodeAt(i) > 255) context.throwTypeError('Value is not a ByteString');
    }
    return string;
  },
  USVString(value, context) {
    if (value === null && context.nullToEmptyString) return toScalarValueString('');
    return toScalarValueString(toString(value));
  },
  object(value, context) {
    if (!isObject(value)) context.throwTypeError('Value is not an object');
    return value;
  },
  symbol(value, context) {
    if (typeof value !== 'symbol') context.throwTypeError('Value is not a symbol');
    return value;
  },
};
