import { one, oneOf, withTrivia } from '../syntax/component-grammar';
import {
  type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult,
} from '../syntax/component-cursor';
import { createComponentParser, type ParserInput } from '../syntax/parser';
import { serializeAuto, consumeAuto, type AutoValue } from '../values/auto';
import type { MathContext } from '../values/math-value';
import {
  serializeLengthPercentage, consumeLengthPercentage,
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
  return marginSideValueParser(input, context);
}

export function consumeMarginSideValue(
  c: ComponentCursor,
): TryComponentConsumerResult<MarginSideValue> {
  return marginSideValueConsumer(c);
}

export function serializeMarginSideValue(value: MarginSideValue): string {
  return value.type === 'auto'
    ? serializeAuto(value)
    : serializeLengthPercentage(value);
}

// <margin-top>, <margin-right>, <margin-bottom>, <margin-left> = <length-percentage> | auto
const marginSideValueConsumer: TryComponentConsumer<MarginSideValue> = oneOf(
  [
    one(consumeLengthPercentage),
    one(consumeAuto),
  ],
  ([value]) => value,
);

const marginSideValueParser = createComponentParser(withTrivia(marginSideValueConsumer));
