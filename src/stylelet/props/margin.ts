import { one, oneOf, type ComponentValue, type TokenCursor, type TryConsumer, type TryConsumerResult } from '../syntax/index';
import type { ValueDefinition } from '../value-processing/index';
import {
  serializeAuto, consumeAuto, resolveLengthPercentage, serializeLengthPercentage, consumeLengthPercentage,
  defineProperty,
  type AutoValue, type MathContext, type LengthPercentageValue,
} from '../values/index';

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
  resolve: (value, stage, context: MathContext) => value.type === 'auto'
    ? value
    : resolveLengthPercentage(value, stage, context),
  serialize: serializeMarginSideValue,
};

export const marginTopProperty = defineProperty(marginSideDef);
export const marginRightProperty = defineProperty(marginSideDef);
export const marginBottomProperty = defineProperty(marginSideDef);
export const marginLeftProperty = defineProperty(marginSideDef);

function consumeMarginSideValue(
  c: TokenCursor<ComponentValue, MathContext>,
): TryConsumerResult<MarginSideValue> {
  return marginSideValueConsumer(c);
}

function serializeMarginSideValue(value: MarginSideValue): string {
  return value.type === 'auto'
    ? serializeAuto(value)
    : serializeLengthPercentage(value);
}

// <margin-top>, <margin-right>, <margin-bottom>, <margin-left> = <length-percentage> | auto
const marginSideValueConsumer: TryConsumer<MarginSideValue, MathContext> = oneOf(
  [
    one(consumeLengthPercentage),
    one(consumeAuto),
  ],
  ([value]) => value,
);
