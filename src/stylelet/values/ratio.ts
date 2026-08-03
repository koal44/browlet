import { tryConsumeSlashDelim } from '../parser/component-consumers';
import { one, opt, sequenceOf, withTrivia } from '../parser/component-grammar';
import { type TryComponentConsumer } from '../parser/component-cursor';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
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
  return parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeRatio),
    context,
  );
}

const tryConsumeNonnegativeNumber = createNumberConsumer({ min: 0 });
const tryConsumeRatioDenominator: TryComponentConsumer<number> = sequenceOf(
  [
    one(withTrivia(tryConsumeSlashDelim)),
    one(withTrivia(tryConsumeNonnegativeNumber)),
  ],
  ([, [denominator]]) => denominator.value,
);

export const tryConsumeRatio: TryComponentConsumer<RatioValue> = sequenceOf(
  [
    one(tryConsumeNonnegativeNumber),
    opt(tryConsumeRatioDenominator),
  ],
  ([[numerator], denominator]) => ({
    type: 'ratio',
    numerator: numerator.value,
    denominator: denominator[0] ?? 1,
  }),
);

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
