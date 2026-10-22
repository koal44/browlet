import { InternalError } from '../../infra/internal-error';

import { one, oneOf, type ComponentValue, type TokenCursor, type TryConsumer, type TryConsumerResult } from '../syntax/index';
import { ValueStage, type ValueDefinition } from '../value-processing/index';
import {
  serializeAuto, consumeAuto, resolveLengthPercentage, serializeLengthPercentage, consumeLengthPercentage,
  defineWholeValue,
  type AutoValue, type MathContext, type LengthPercentageValue,
} from '../values/index';

import type { PropertyRecord } from './property';
import type { ShorthandRecord } from './shorthand';

/*
 * <margin-top>, <margin-right>, <margin-bottom>, <margin-left> =
 *   <length-percentage> | auto
 */

type MarginSideValue = LengthPercentageValue | AutoValue;

const marginSideDef: ValueDefinition<MarginSideValue, MathContext> = {
  consume: consumeMarginSideValue,
  resolve: resolveMarginSideValue,
  serialize: serializeMarginSideValue,
};

export const marginSideWholeValueDef = defineWholeValue(marginSideDef);

/** Margin's canonical longhands; its grammar and pending-substitution representation remain unfinished. */
// https://drafts.csswg.org/css-box-4/#margin-shorthand
// https://drafts.csswg.org/css-variables-1/#variables-in-shorthands
export const marginShorthand: ShorthandRecord = {
  longhands: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  expand(_declaration, _context) {
    // TODO: Validate the 1–4-value grammar, expand CSS-wide values, and retain a
    // shared pending-substitution value for var()/other arbitrary substitutions.
    throw new InternalError('Margin shorthand expansion and pending substitution are not implemented');
  },
  serialize(_declarations) {
    // TODO: Serialize compatible longhands without resolving them, including
    // CSS-wide and pending-substitution values; return empty text if incompatible.
    throw new InternalError('Margin shorthand serialization is not implemented');
  },
};

/** Shared grammar and metadata for the four physical margin longhands. */
// https://drafts.csswg.org/css-box-4/#margin-physical
export const marginSideProperty: PropertyRecord<MarginSideValue, MathContext> = {
  definition: marginSideWholeValueDef,
  inherits: false,
  initialValue: { type: 'ordinary', value: { type: 'length', value: 0, unit: '' } },
  logicalGroup: { name: 'margin', mapping: 'physical' },
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
