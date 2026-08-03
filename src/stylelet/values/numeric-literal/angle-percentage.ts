import { withTrivia } from '../../parser/component-grammar';
import { type TryComponentConsumer } from '../../parser/component-cursor';
import { parseAsComponentGrammar, type ParserInput } from '../../parser/syntax';
import {
  canonicalizeAngle, serializeAngle, tryConsumeAngle, type AngleLiteral,
  type CanonicalAngleLiteral,
} from './angle';
import {
  createDimensionPercentageConsumer, serializeDimensionPercentage,
  tryAccumulateDimensionPercentages, tryAddDimensionPercentages, tryInterpolateDimensionPercentages,
  type DimensionPercentageConsumerOptions, type DimensionPercentageLiteral,
} from './dimension-percentage';

/*
 * <angle-percentage> = [ <angle> | <percentage> ]
 */

export type AnglePercentageLiteral = DimensionPercentageLiteral<AngleLiteral>;

export type AnglePercentageResolutionContext = {
  /** Percentage basis in canonical degrees. */
  percentageBasis?: number;
};

export function parseAnglePercentage(
  input: ParserInput,
  context: unknown = undefined,
): AnglePercentageLiteral | null {
  return parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeAnglePercentage),
    context,
  );
}

export type AnglePercentageConsumerOptions =
  DimensionPercentageConsumerOptions;

export function createAnglePercentageConsumer(
  options: AnglePercentageConsumerOptions = {},
): TryComponentConsumer<AnglePercentageLiteral> {
  return createDimensionPercentageConsumer(
    tryConsumeAngle,
    'Angle-percentage',
    options,
  );
}

export const tryConsumeAnglePercentage = createAnglePercentageConsumer();

export function serializeAnglePercentage(value: AnglePercentageLiteral): string {
  return serializeDimensionPercentage(value, serializeAngle);
}

export function tryResolveAnglePercentage(
  value: AnglePercentageLiteral,
  context: AnglePercentageResolutionContext = {},
): CanonicalAngleLiteral | null {
  if (value.type === 'angle') {
    return canonicalizeAngle(value);
  }

  if (context.percentageBasis === undefined) {
    return null;
  }

  return {
    type: 'angle',
    value: context.percentageBasis * value.value / 100,
    unit: 'deg',
  };
}

export function tryAddAnglePercentages(
  a: AnglePercentageLiteral,
  b: AnglePercentageLiteral,
): AnglePercentageLiteral | null {
  return tryAddDimensionPercentages(a, b);
}

export function tryInterpolateAnglePercentages(
  a: AnglePercentageLiteral,
  b: AnglePercentageLiteral,
  p: number,
): AnglePercentageLiteral | null {
  return tryInterpolateDimensionPercentages(a, b, p);
}

export function tryAccumulateAnglePercentages(
  a: AnglePercentageLiteral,
  b: AnglePercentageLiteral,
): AnglePercentageLiteral | null {
  return tryAccumulateDimensionPercentages(a, b);
}
