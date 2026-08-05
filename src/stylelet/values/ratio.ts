import { consumeSlashDelim } from '../syntax/component-consumers';
import { one, opt, sequenceOf, withTrivia } from '../syntax/component-grammar';
import {
  type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult,
} from '../syntax/component-cursor';
import { createComponentParser, type ParserInput } from '../syntax/parser';
import { createNumberConsumer, serializeCssNumber } from './numeric-literal/number';

/*
 * <ratio> = <number [0,∞]> [ / <number [0,∞]> ]?
 */

export type RatioValue = {
  type: 'ratio';
  numerator: number;
  denominator: number;
};

export function parseRatio(
  input: ParserInput,
  context: unknown = undefined,
): RatioValue | null {
  return ratioParser(input, context);
}

export function consumeRatio(
  c: ComponentCursor,
): TryComponentConsumerResult<RatioValue> {
  return ratioConsumer(c);
}

export function serializeRatio(value: RatioValue): string {
  return `${serializeCssNumber(value.numerator)} / ${serializeCssNumber(value.denominator)}`;
}

export function isDegenerateRatio(value: RatioValue): boolean {
  return isDegenerateRatioComponent(value.numerator) ||
    isDegenerateRatioComponent(value.denominator);
}

function isDegenerateRatioComponent(value: number): boolean {
  return value === 0 || Math.abs(value) === Infinity;
}

// CSS Values, "Combination of <ratio>".
export function interpolateRatios(
  a: RatioValue,
  b: RatioValue,
  p: number,
): RatioValue {
  if (isDegenerateRatio(a) || isDegenerateRatio(b)) {
    throw new TypeError('Degenerate ratios cannot be interpolated');
  }

  const aLog = Math.log(a.numerator / a.denominator);
  const bLog = Math.log(b.numerator / b.denominator);

  return {
    type: 'ratio',
    numerator: Math.exp((1 - p) * aLog + p * bLog),
    denominator: 1,
  };
}

// =============================================================================
// Syntax
// =============================================================================

// <number [0,∞]>
const nonnegativeNumberConsumer = createNumberConsumer({ min: 0 });

/*
 * Implementation factorization of <ratio>:
 * <ratio-denominator> = / <number [0,∞]>
 */
const ratioDenominatorConsumer: TryComponentConsumer<number> = sequenceOf(
  [
    one(withTrivia(consumeSlashDelim)),
    one(withTrivia(nonnegativeNumberConsumer)),
  ],
  ([, [denominator]]) => denominator.value,
);

// <ratio> = <number [0,∞]> [ / <number [0,∞]> ]?
const ratioConsumer: TryComponentConsumer<RatioValue> = sequenceOf(
  [
    one(nonnegativeNumberConsumer),
    opt(ratioDenominatorConsumer),
  ],
  ([[numerator], denominator]) => ({
    type: 'ratio',
    numerator: numerator.value,
    denominator: denominator[0] ?? 1,
  }),
);

const ratioParser = createComponentParser(withTrivia(ratioConsumer));
