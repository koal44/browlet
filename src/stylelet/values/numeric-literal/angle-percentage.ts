import { withTrivia } from '../../syntax/component-grammar';
import {
  type TokenCursor, type TryConsumer, type TryConsumerResult,
} from '../../syntax/token-cursor';
import { createComponentParser, type ParserInput } from '../../syntax/parser';
import {
  canonicalizeAngle, serializeAngle, consumeAngle, type AngleLiteral,
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
  percentageReferenceValue?: CanonicalAngleLiteral;
};

export function parseAnglePercentage(
  input: ParserInput,
  context: unknown = undefined,
): AnglePercentageLiteral | null {
  return anglePercentageParser(input, context);
}

export function consumeAnglePercentage(
  c: TokenCursor,
): TryConsumerResult<AnglePercentageLiteral> {
  return anglePercentageConsumer(c);
}

export function createAnglePercentageConsumer(
  options: DimensionPercentageConsumerOptions = {},
): TryConsumer<AnglePercentageLiteral> {
  return createDimensionPercentageConsumer(
    consumeAngle,
    'Angle-percentage',
    options,
  );
}

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

  const reference = context.percentageReferenceValue;

  if (reference === undefined) {
    return null;
  }

  return {
    ...reference,
    value: reference.value * value.value / 100,
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

// <angle-percentage> = [ <angle> | <percentage> ]
const anglePercentageConsumer = createAnglePercentageConsumer();
const anglePercentageParser = createComponentParser(withTrivia(anglePercentageConsumer));
