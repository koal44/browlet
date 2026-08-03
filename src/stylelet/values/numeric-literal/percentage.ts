import { tryConsumePercentageToken } from '../../parser/component-consumers';
import { adaptConsumer, withTrivia } from '../../parser/component-grammar';
import { type TryComponentConsumer } from '../../parser/component-cursor';
import { parseAsComponentGrammar, type ParserInput } from '../../parser/syntax';
import { serializeCssNumber } from './number';

/*
 * <percentage> = <percentage-token>
 */

export type PercentageLiteral = {
  type: 'percentage';
  value: number;
};

export function percentageLiteral(value: number): PercentageLiteral {
  return { type: 'percentage', value };
}

export function parsePercentage(
  input: ParserInput,
  context: unknown = undefined,
): PercentageLiteral | null {
  return parseAsComponentGrammar(
    input,
    withTrivia(tryConsumePercentage),
    context,
  );
}

export type PercentageConsumerOptions = {
  min?: number;
  max?: number;
};

export function createPercentageConsumer(
  options: PercentageConsumerOptions = {},
): TryComponentConsumer<PercentageLiteral> {
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;

  return adaptConsumer(tryConsumePercentageToken, (token) =>
    token.value < min || token.value > max
      ? null
      : { type: 'percentage', value: token.value },
  );
}

export const tryConsumePercentage = createPercentageConsumer();

// CSSOM, "To serialize a CSS component value", <percentage>.
export function serializePercentage(value: PercentageLiteral): string {
  return `${serializeCssNumber(value.value)}%`;
}

// CSS Values, "Computation and Combination of <percentage>".
export function addPercentages(
  a: PercentageLiteral,
  b: PercentageLiteral,
): PercentageLiteral {
  return {
    type: 'percentage',
    value: a.value + b.value,
  };
}

export function interpolatePercentages(
  a: PercentageLiteral,
  b: PercentageLiteral,
  p: number,
): PercentageLiteral {
  return {
    type: 'percentage',
    value: (1 - p) * a.value + p * b.value,
  };
}

export function accumulatePercentages(
  a: PercentageLiteral,
  b: PercentageLiteral,
): PercentageLiteral {
  return addPercentages(a, b);
}
