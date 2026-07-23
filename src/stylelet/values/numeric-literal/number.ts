import { tryConsumeNumberToken } from '../../parser/component-consumers';
import { withComponentTrivia } from '../../parser/component-grammar';
import {
  isBad, ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer, type TryComponentConsumerResult,
} from '../../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../../parser/syntax';
import { serializeInteger } from './integer';

/*
 * <number> = <number-token>
 */

export type NumberLiteral = {
  type: 'number';
  value: number;
};

export function parseNumber(
  input: ParserInput,
  context: unknown = undefined,
): NumberLiteral | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeNumber),
      context,
    ),
    'number',
  );
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

  return (c): TryComponentConsumerResult<NumberLiteral> => {
    const start = c.pos();
    const token = tryConsumeNumberToken(c);

    if (token === null || isBad(token)) {
      return token;
    }

    if (token.value.value < min || token.value.value > max) {
      c.restore(start);
      return null;
    }

    return ok({
      type: 'number',
      value: token.value.value,
    });
  };
}

export const tryConsumeNumber = createNumberConsumer();

export function serializeNumber(value: NumberLiteral): string {
  return serializeCssNumber(value.value);
}

// CSSOM leaves decimal tie-breaking undefined. Use CSS's general rule for
// nearest-integer rounding: exact ties are resolved toward positive infinity.
// See CSSWG issue#5689 and the "CSSOM number serialization oracle" scenario.
export function serializeCssNumber(value: number): string {
  if (Number.isInteger(value)) {
    return serializeInteger({ type: 'integer', value });
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
