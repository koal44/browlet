import { tryConsumeIntegerToken } from '../parser/component-consumers';
import { withComponentTrivia } from '../parser/component-grammar';
import {
  isBad, ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer, type TryComponentConsumerResult,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';

/*
 * <integer> = <integer-number-token>
 * <integer-number-token> = a <number-token> whose type flag is "integer"
 */

export type IntegerValue = {
  type: 'integer';
  value: number;
};

export function parseInteger(
  input: ParserInput,
  context: unknown = undefined,
): IntegerValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeInteger),
      context,
    ),
    'integer',
  );
}

export type IntegerConsumerOptions = {
  min?: number;
  max?: number;
};

export function createIntegerConsumer(
  options: IntegerConsumerOptions = {},
): TryComponentConsumer<IntegerValue> {
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;

  return (c): TryComponentConsumerResult<IntegerValue> => {
    const start = c.pos();
    const token = tryConsumeIntegerToken(c);

    if (token === null || isBad(token)) {
      return token;
    }

    if (token.value.value < min || token.value.value > max) {
      c.restore(start);
      return null;
    }

    return ok({
      type: 'integer',
      value: token.value.value,
    });
  };
}

export const tryConsumeInteger = createIntegerConsumer();

// CSSOM, "To serialize a CSS component value", <integer>.
export function serializeInteger(value: IntegerValue): string {
  if (Number.isSafeInteger(value.value)) {
    return Object.is(value.value, -0) ? '0' : String(value.value);
  }

  return BigInt(value.value).toString();
}

// CSS Values, "Computation and Combination of <integer>".
export function addIntegers(a: IntegerValue, b: IntegerValue): IntegerValue {
  return integerResult(a.value + b.value);
}

export function interpolateIntegers(
  a: IntegerValue,
  b: IntegerValue,
  p: number,
): IntegerValue {
  return integerResult(Math.round((1 - p) * a.value + p * b.value));
}

function integerResult(value: number): IntegerValue {
  return {
    type: 'integer',
    value: value === 0 ? 0 : value,
  };
}
