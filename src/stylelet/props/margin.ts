import { one, oneOf, type ComponentValue, type TokenCursor, type TryConsumer, type TryConsumerResult } from '../syntax/index';
import { ValueStage, type ValueDefinition } from '../value-processing/index';
import {
  serializeAuto, consumeAuto, resolveLengthPercentage, serializeLengthPercentage, consumeLengthPercentage,
  defineWholeValue,
  type AutoValue, type MathContext, type LengthPercentageValue,
} from '../values/index';
import type { PropertyRecord } from '../css/index';

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
  resolve: resolveMarginSideValue,
  serialize: serializeMarginSideValue,
};

export const marginSideWholeValueDef = defineWholeValue(marginSideDef);

// https://drafts.csswg.org/css-box-4/#margin-physical
export const marginTopProperty: PropertyRecord<MarginTopValue, MathContext> = {
  definition: marginSideWholeValueDef,
  inherits: false,
  initialValue: { type: 'ordinary', value: { type: 'length', value: 0, unit: '' } },
};

export const marginRightProperty: PropertyRecord<MarginRightValue, MathContext> = {
  definition: marginSideWholeValueDef,
  inherits: false,
  initialValue: { type: 'ordinary', value: { type: 'length', value: 0, unit: '' } },
};

export const marginBottomProperty: PropertyRecord<MarginBottomValue, MathContext> = {
  definition: marginSideWholeValueDef,
  inherits: false,
  initialValue: { type: 'ordinary', value: { type: 'length', value: 0, unit: '' } },
};

export const marginLeftProperty: PropertyRecord<MarginLeftValue, MathContext> = {
  definition: marginSideWholeValueDef,
  inherits: false,
  initialValue: { type: 'ordinary', value: { type: 'length', value: 0, unit: '' } },
};

function consumeMarginSideValue(
  c: TokenCursor<ComponentValue, MathContext>,
): TryConsumerResult<MarginSideValue> {
  return marginSideValueConsumer(c);
}

/** Resolve a margin longhand's numeric value while preserving the auto keyword. */
function resolveMarginSideValue(
  value: MarginSideValue,
  stage: ValueStage,
  context: MathContext,
): MarginSideValue {
  return value.type === 'auto' ? value : resolveLengthPercentage(value, stage, context);
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
  ([value], context: MathContext) => resolveMarginSideValue(value, ValueStage.Declared, context),
);
