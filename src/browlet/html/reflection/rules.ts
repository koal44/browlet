import { toScalarValueString } from '../../../infra/index';
import { DOMExceptionImpl, DOMExceptionNames } from '../../../web-idl/core/index';

import {
  type EnumeratedAttribute, parseInteger, parseNonNegativeInteger,
  parseFloatingPointNumber, serializeFloatingPointNumber,
} from '../microsyntaxes/index';

/** Interpret a reflected enumerated attribute as its canonical keyword, not its implementation state. */
// https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflect
export function getReflectedKeyword<State extends PropertyKey>(
  value: string | null, definition: EnumeratedAttribute<State>,
): string | null {
  const state = definition.getState(value);
  return state === null ? null : definition.getCanonicalKeyword(state);
}

/** Reflection rules consume converted IDL values; author conversion remains in Binding. */
export type ReflectionRules<Value> = {
  /** Interpret the current content attribute, with null representing absence. */
  get(this: void, value: string | null): Value;
  /** Return attribute text, null to delete, or undefined to leave the attribute unchanged. */
  set(this: void, value: Value): string | null | undefined;
};

/** DOMString reflection preserves the text and represents an absent attribute as an empty string. */
// https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflect
export const stringReflection: ReflectionRules<string> = {
  get: (value) => value ?? '',
  set: (value) => value,
};

/** Nullable string reflection preserves absence; assigning null deletes the attribute. */
// https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflect
export const nullableStringReflection: ReflectionRules<string | null> = {
  get: (value) => value,
  set: (value) => value,
};

/** USVString getters replace lone surrogates even when the content attribute was set directly. */
// https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflect
export const scalarStringReflection: ReflectionRules<string> = {
  get: (value) => toScalarValueString(value ?? ''),
  set: (value) => value,
};

/** Boolean reflection reads presence and writes an empty attribute or removes it. */
// https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflect
export const booleanReflection: ReflectionRules<boolean> = {
  get: (value) => value !== null,
  set: (value) => value ? '' : null,
};

/** Prepare signed-long reflection, including the optional nonnegative restriction and default. */
// https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflect
export function reflectLong(nonNegative = false, defaultValue = nonNegative ? -1 : 0): ReflectionRules<number> {
  const parse = nonNegative ? parseNonNegativeInteger : parseInteger;
  return {
    get(value) {
      const parsed = value === null ? null : parse(value);
      return parsed !== null && parsed >= -2147483648n && parsed <= 2147483647n
        ? Number(parsed) : defaultValue;
    },
    set(value) {
      if (nonNegative && value < 0) throw new DOMExceptionImpl('', DOMExceptionNames.indexSize);
      return String(value);
    },
  };
}

/** Prepare unsigned-long reflection; range clamping affects reads, never writes. */
// https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflect
export function reflectUnsignedLong(
  positive = false, positiveWithFallback = false, range?: [number, number], defaultValue?: number,
): ReflectionRules<number> {
  const minimum = range?.[0] ?? (positive || positiveWithFallback ? 1 : 0);
  const maximum = range?.[1] ?? 2147483647;
  const min = BigInt(minimum);
  const max = BigInt(maximum);
  const setterMinimum = positive || positiveWithFallback ? 1 : 0;
  return {
    get(value) {
      const parsed = value === null ? null : parseNonNegativeInteger(value);
      if (parsed !== null) {
        if (parsed >= min && parsed <= max) return Number(parsed);
        if (range) return parsed < min ? minimum : maximum;
      }
      return defaultValue ?? minimum;
    },
    set(value) {
      if (positive && value === 0) throw new DOMExceptionImpl('', DOMExceptionNames.indexSize);
      return String(value >= setterMinimum && value <= 2147483647
        ? value : defaultValue ?? setterMinimum);
    },
  };
}

/** Prepare finite-double reflection; nonpositive assignments to positive-only attributes do nothing. */
// https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflect
export function reflectDouble(positive = false, defaultValue = 0): ReflectionRules<number> {
  return {
    get(value) {
      const parsed = value === null ? null : parseFloatingPointNumber(value);
      return parsed !== null && (!positive || parsed > 0) ? parsed : defaultValue;
    },
    set(value) {
      return positive && value <= 0 ? undefined : serializeFloatingPointNumber(value);
    },
  };
}
