import { InternalError } from '../../infra/internal-error';

import { one, oneOf, withTrivia, createComponentParser, type TryConsumer } from '../syntax/index';
import { ValueStage } from '../value-processing/index';
import { LengthLiteral } from '../values/numeric-literal/index';
import { WholeValue, AutoValue, LengthPercentageValue, type MathContext } from '../values/index';

import type { PropertyRecord } from './property';
import type { ShorthandRecord } from './shorthand';

/*
 * <margin-top>, <margin-right>, <margin-bottom>, <margin-left> =
 *   <length-percentage> | auto
 */

type MarginSideValue = LengthPercentageValue | AutoValue;

// <margin-top>, <margin-right>, <margin-bottom>, <margin-left> = <length-percentage> | auto
const marginSideValueConsumer: TryConsumer<MarginSideValue, MathContext> = oneOf(
  [one(LengthPercentageValue.consume), one(AutoValue.consume)],
  ([value], context: MathContext) => value.resolve(ValueStage.Declared, context),
);
const parseMarginSideValue = createComponentParser(withTrivia(marginSideValueConsumer));
export const parseMarginSideProperty = WholeValue.createParser(parseMarginSideValue);

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
  parse: parseMarginSideProperty,
  inherits: false,
  initialValue: new WholeValue<MarginSideValue, MathContext>(
    new LengthPercentageValue(new LengthLiteral(0, '')), parseMarginSideValue,
  ),
  logicalGroup: { name: 'margin', mapping: 'physical' },
};
