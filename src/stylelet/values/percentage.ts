import { tryConsumePercentageToken } from '../parser/component-consumers';
import { withComponentTrivia } from '../parser/component-grammar';
import {
  isBad, ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer, type TryComponentConsumerResult,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { serializeCssNumber } from './number';

/*
 * <percentage> = <percentage-token>
 */

export type PercentageValue = {
  type: 'percentage';
  value: number;
};

export function parsePercentage(
  input: ParserInput,
  context: unknown = undefined,
): PercentageValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumePercentage),
      context,
    ),
    'percentage',
  );
}

export type PercentageConsumerOptions = {
  min?: number;
  max?: number;
};

export function createPercentageConsumer(
  options: PercentageConsumerOptions = {},
): TryComponentConsumer<PercentageValue> {
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;

  return (c): TryComponentConsumerResult<PercentageValue> => {
    const start = c.pos();
    const token = tryConsumePercentageToken(c);

    if (token === null || isBad(token)) {
      return token;
    }

    if (token.value.value < min || token.value.value > max) {
      c.restore(start);
      return null;
    }

    return ok({
      type: 'percentage',
      value: token.value.value,
    });
  };
}

export const tryConsumePercentage = createPercentageConsumer();

// CSSOM, "To serialize a CSS component value", <percentage>.
export function serializePercentage(value: PercentageValue): string {
  return `${serializeCssNumber(value.value)}%`;
}

// CSS Values, "Computation and Combination of <percentage>".
export function addPercentages(
  a: PercentageValue,
  b: PercentageValue,
): PercentageValue {
  return {
    type: 'percentage',
    value: a.value + b.value,
  };
}

export function interpolatePercentages(
  a: PercentageValue,
  b: PercentageValue,
  p: number,
): PercentageValue {
  return {
    type: 'percentage',
    value: (1 - p) * a.value + p * b.value,
  };
}
