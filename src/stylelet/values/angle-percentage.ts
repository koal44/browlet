import { withComponentTrivia } from '../parser/component-grammar';
import { unwrapConsumeResultOrThrow, type TryComponentConsumer } from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import {
  resolveAngle, serializeAngle, tryConsumeAngle,
  type AngleValue, type CanonicalAngleValue,
} from './angle';
import {
  createDimensionPercentageConsumer, serializeDimensionPercentage,
  tryAddDimensionPercentages, tryInterpolateDimensionPercentages,
  type DimensionPercentageConsumerOptions, type DimensionPercentageValue,
} from './dimension-percentage';

/*
 * <angle-percentage> = [ <angle> | <percentage> ]
 */

export type AnglePercentageValue = DimensionPercentageValue<AngleValue>;

export type AnglePercentageResolutionContext = {
  /** Percentage basis in canonical degrees. */
  percentageBasis?: number;
};

export function parseAnglePercentage(
  input: ParserInput,
  context: unknown = undefined,
): AnglePercentageValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeAnglePercentage),
      context,
    ),
    'angle-percentage',
  );
}

export type AnglePercentageConsumerOptions =
  DimensionPercentageConsumerOptions;

export function createAnglePercentageConsumer(
  options: AnglePercentageConsumerOptions = {},
): TryComponentConsumer<AnglePercentageValue> {
  return createDimensionPercentageConsumer(
    tryConsumeAngle,
    'Angle-percentage',
    options,
  );
}

export const tryConsumeAnglePercentage = createAnglePercentageConsumer();

export function serializeAnglePercentage(value: AnglePercentageValue): string {
  return serializeDimensionPercentage(value, serializeAngle);
}

export function tryResolveAnglePercentage(
  value: AnglePercentageValue,
  context: AnglePercentageResolutionContext = {},
): CanonicalAngleValue | null {
  if (value.type === 'angle') {
    return resolveAngle(value);
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
  a: AnglePercentageValue,
  b: AnglePercentageValue,
): AnglePercentageValue | null {
  return tryAddDimensionPercentages(a, b);
}

export function tryInterpolateAnglePercentages(
  a: AnglePercentageValue,
  b: AnglePercentageValue,
  p: number,
): AnglePercentageValue | null {
  return tryInterpolateDimensionPercentages(a, b, p);
}
