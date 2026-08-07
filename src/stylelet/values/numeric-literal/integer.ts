import { consumeIntegerToken } from '../../syntax/component-consumers';
import { adaptConsumer, withTrivia } from '../../syntax/component-grammar';
import {
  type TokenCursor, type TryConsumer, type TryConsumerResult,
} from '../../syntax/token-cursor';
import { createComponentParser, type ParserInput } from '../../syntax/parser';

/*
 * <integer> = <integer-number-token>
 * <integer-number-token> = a <number-token> whose type flag is "integer"
 */

export type IntegerLiteral = {
  type: 'integer';
  value: number;
};

export function integerLiteral(value: number): IntegerLiteral {
  return { type: 'integer', value };
}

export function parseInteger(
  input: ParserInput,
  context: unknown = undefined,
): IntegerLiteral | null {
  return integerParser(input, context);
}

export function consumeInteger(
  c: TokenCursor,
): TryConsumerResult<IntegerLiteral> {
  return integerConsumer(c);
}

export type IntegerConsumerOptions = {
  min?: number;
  max?: number;
};

export function createIntegerConsumer(
  options: IntegerConsumerOptions = {},
): TryConsumer<IntegerLiteral> {
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;

  return adaptConsumer(consumeIntegerToken, (token) =>
    token.value < min || token.value > max
      ? null
      : { type: 'integer', value: token.value },
  );
}

// CSSOM, "To serialize a CSS component value", <integer>.
export function serializeInteger(value: IntegerLiteral): string {
  return serializeCssInteger(value.value);
}

export function serializeCssInteger(value: number): string {
  if (Number.isSafeInteger(value)) {
    return Object.is(value, -0) ? '0' : String(value);
  }

  return BigInt(value).toString();
}

// CSS Values, "Computation and Combination of <integer>".
export function addIntegers(a: IntegerLiteral, b: IntegerLiteral): IntegerLiteral {
  return integerResult(a.value + b.value);
}

export function interpolateIntegers(
  a: IntegerLiteral,
  b: IntegerLiteral,
  p: number,
): IntegerLiteral {
  return integerResult(Math.round((1 - p) * a.value + p * b.value));
}

export function accumulateIntegers(
  a: IntegerLiteral,
  b: IntegerLiteral,
): IntegerLiteral {
  return addIntegers(a, b);
}

function integerResult(value: number): IntegerLiteral {
  return {
    type: 'integer',
    value: value === 0 ? 0 : value,
  };
}

// <integer> = <integer-number-token>
const integerConsumer = createIntegerConsumer();
const integerParser = createComponentParser(withTrivia(integerConsumer));
