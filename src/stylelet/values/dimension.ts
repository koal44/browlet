import {
  one, oneOf, withTrivia, parseAsComponentGrammar,
  type ComponentValue, type TokenCursor, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import { DimensionLiteral } from './numeric-literal/index';

import { AngleValue } from './angle';
import { FrequencyValue } from './frequency';
import { LengthValue } from './length';
import { ResolutionValue } from './resolution';
import { TimeValue } from './time';
import type { MathContext } from './math-value';

/** A recognized dimension value, or a literal whose unit remains uninterpreted. */
export type DimensionValue = AngleValue | FrequencyValue | LengthValue | ResolutionValue | TimeValue | DimensionLiteral;

/** Parse a dimension and return its concrete family directly. */
// https://drafts.csswg.org/css-values-4/#dimensions
export function parseDimension(input: ParserInput, context: MathContext): DimensionValue | null {
  return parseAsComponentGrammar(input, dimensionGrammar, context);
}

/** Consume one dimension without adding an intermediate container. */
export function consumeDimension(c: TokenCursor<ComponentValue, MathContext>): TryConsumerResult<DimensionValue> {
  return dimensionConsumer(c);
}

const dimensionConsumer = oneOf([
  one(AngleValue.consume),
  one(FrequencyValue.consume),
  one(LengthValue.consume),
  one(ResolutionValue.consume),
  one(TimeValue.consume),
  one(DimensionLiteral.consume),
], ([parsed]) => parsed);
const dimensionGrammar = withTrivia(dimensionConsumer);
