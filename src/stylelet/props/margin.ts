import { one, oneOf, withTrivia } from '../parser/component-grammar';
import { type TryComponentConsumer } from '../parser/component-cursor';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { serializeAuto, tryConsumeAuto, type AutoValue } from '../values/auto';
import type { MathContext } from '../values/math-value';
import {
  serializeLengthPercentage, tryConsumeLengthPercentage,
  type LengthPercentageValue,
} from '../values/length-percentage';

/*
 * <margin-top>, <margin-right>, <margin-bottom>, <margin-left> =
 *   <length-percentage> | auto
 */

export type MarginSideValue =
  | LengthPercentageValue
  | AutoValue;

export function parseMarginSideValue(
  input: ParserInput,
  context: MathContext = {},
): MarginSideValue | null {
  return parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeMarginSideValue),
    context,
  );
}

export const tryConsumeMarginSideValue: TryComponentConsumer<MarginSideValue> = oneOf(
  [
    one(tryConsumeLengthPercentage),
    one(tryConsumeAuto),
  ],
  ([value]) => value,
);

export function serializeMarginSideValue(value: MarginSideValue): string {
  return value.type === 'auto'
    ? serializeAuto(value)
    : serializeLengthPercentage(value);
}
