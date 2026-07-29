import { tryConsumeIntegerToken } from '../../parser/component-consumers';
import { withComponentTrivia } from '../../parser/component-grammar';
import {
  isBad, ok, unwrapConsumeResultOrThrow, type TryComponentConsumer,
  type TryComponentConsumerResult,
} from '../../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../../parser/syntax';

/*
 * <integer> = <integer-number-token>
 * <integer-number-token> = a <number-token> whose type flag is "integer"
 */

export type IntegerLiteral = {
  type: 'integer';
  value: number;
};

export function parseInteger(
  input: ParserInput,
  context: unknown = undefined,
): IntegerLiteral | null {
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
): TryComponentConsumer<IntegerLiteral> {
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;

  return (c): TryComponentConsumerResult<IntegerLiteral> => {
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
