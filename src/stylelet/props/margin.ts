import { one, oneOf } from '../syntax/component-grammar';
import type {
  TokenCursor, TryConsumer, TryConsumerResult,
} from '../syntax/token-cursor';
import { serializeAuto, consumeAuto, type AutoValue } from '../values/auto';
import type { ValueDefinition } from '../value-processing/definition';
import type { MathContext } from '../values/math-value';
import {
  resolveLengthPercentage, serializeLengthPercentage, consumeLengthPercentage,
  type LengthPercentageValue,
} from '../values/length-percentage';
import { defineProperty } from '../values/whole-value';

/*
 * <margin-top>, <margin-right>, <margin-bottom>, <margin-left> =
 *   <length-percentage> | auto
 */

export type MarginTopValue = MarginSideValue;
export type MarginRightValue = MarginSideValue;
export type MarginBottomValue = MarginSideValue;
export type MarginLeftValue = MarginSideValue;

type MarginSideValue = LengthPercentageValue | AutoValue;

const marginSideDef: ValueDefinition<MarginSideValue, MathContext> = {
  consume: consumeMarginSideValue,
  resolve: (value, stage, context) => value.type === 'auto'
    ? value
    : resolveLengthPercentage(value, stage, context),
  serialize: serializeMarginSideValue,
};

export const marginTopProperty = defineProperty(marginSideDef);
export const marginRightProperty = defineProperty(marginSideDef);
export const marginBottomProperty = defineProperty(marginSideDef);
export const marginLeftProperty = defineProperty(marginSideDef);

function consumeMarginSideValue(
  c: TokenCursor,
): TryConsumerResult<MarginSideValue> {
  return marginSideValueConsumer(c);
}

function serializeMarginSideValue(value: MarginSideValue): string {
  return value.type === 'auto'
    ? serializeAuto(value)
    : serializeLengthPercentage(value);
}

// <margin-top>, <margin-right>, <margin-bottom>, <margin-left> = <length-percentage> | auto
const marginSideValueConsumer: TryConsumer<MarginSideValue> = oneOf(
  [
    one(consumeLengthPercentage),
    one(consumeAuto),
  ],
  ([value]) => value,
);
