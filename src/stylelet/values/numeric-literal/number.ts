import { consumeNumberToken } from '../../syntax/component-consumers';
import { adaptConsumer, withTrivia } from '../../syntax/component-grammar';
import {
  type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult,
} from '../../syntax/component-cursor';
import { createComponentParser, type ParserInput } from '../../syntax/parser';
import { serializeCssInteger } from './integer';

/*
 * <number> = <number-token>
 */

export type NumberLiteral = {
  type: 'number';
  value: number;
};

export function numberLiteral(value: number): NumberLiteral {
  return { type: 'number', value };
}

export function parseNumber(
  input: ParserInput,
  context: unknown = undefined,
): NumberLiteral | null {
  return numberParser(input, context);
}

export function consumeNumber(
  c: ComponentCursor,
): TryComponentConsumerResult<NumberLiteral> {
  return numberConsumer(c);
}

export type NumberConsumerOptions = {
  min?: number;
  max?: number;
};

export function createNumberConsumer(
  options: NumberConsumerOptions = {},
): TryComponentConsumer<NumberLiteral> {
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;

  return adaptConsumer(consumeNumberToken, (token) =>
    token.value < min || token.value > max
      ? null
      : { type: 'number', value: token.value },
  );
}

export function serializeNumber(value: NumberLiteral): string {
  return serializeCssNumber(value.value);
}

// CSSOM leaves decimal tie-breaking undefined. Use CSS's general rule for
// nearest-integer rounding: exact ties are resolved toward positive infinity.
// See CSSWG issue#5689 and the "CSSOM number serialization oracle" scenario.
export function serializeCssNumber(value: number): string {
  if (Number.isInteger(value)) {
    return serializeCssInteger(value);
  }

  const rounded = Math.round(value * 1_000_000) / 1_000_000;

  return Object.is(rounded, -0) ? '0' : String(rounded);
}

// CSS Values, "Computation and Combination of <number>".
export function addNumbers(a: NumberLiteral, b: NumberLiteral): NumberLiteral {
  return {
    type: 'number',
    value: a.value + b.value,
  };
}

export function interpolateNumbers(
  a: NumberLiteral,
  b: NumberLiteral,
  p: number,
): NumberLiteral {
  return {
    type: 'number',
    value: (1 - p) * a.value + p * b.value,
  };
}

export function accumulateNumbers(
  a: NumberLiteral,
  b: NumberLiteral,
): NumberLiteral {
  return addNumbers(a, b);
}

// <number> = <number-token>
const numberConsumer = createNumberConsumer();
const numberParser = createComponentParser(withTrivia(numberConsumer));
