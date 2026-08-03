import { one, oneOf } from '../../parser/component-grammar';
import { type TryComponentConsumer } from '../../parser/component-cursor';
import { addDimensions, interpolateDimensions, type DimensionLiteral } from './dimension';
import {
  addPercentages, interpolatePercentages, serializePercentage, tryConsumePercentage,
  type PercentageLiteral,
} from './percentage';

/*
 * Shared mechanics for the mixed dimension-percentage productions. This is
 * not itself a CSS value production.
 */

export type DimensionPercentageLiteral<
  Dimension extends DimensionLiteral<string, string>,
> = Dimension | PercentageLiteral;

export type DimensionPercentageConsumerOptions = {
  /** Inclusive lower bound on the resolved mixed quantity. */
  min?: number;

  /** Inclusive upper bound on the resolved mixed quantity. */
  max?: number;
};

export function createDimensionPercentageConsumer<
  Dimension extends DimensionLiteral<string, string>,
>(
  tryConsumeDimension: TryComponentConsumer<Dimension>,
  productionName: string,
  options: DimensionPercentageConsumerOptions = {},
): TryComponentConsumer<DimensionPercentageLiteral<Dimension>> {
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;

  if (!canCheckRangeWithoutResolution(min, max)) {
    throw new Error(
      `${productionName} ranges with finite nonzero bounds are not yet supported`,
    );
  }

  return oneOf(
    [
      one(tryConsumeDimension),
      one(tryConsumePercentage),
    ],
    ([value]) => value.value < min || value.value > max
      ? null
      : value,
  );
}

function canCheckRangeWithoutResolution(min: number, max: number): boolean {
  // Dimension and percentage resolutions preserve sign, so zero and infinite
  // bounds do not require a percentage basis or dimension context.
  return (
    (min === -Infinity || min === 0) &&
    (max === 0 || max === Infinity)
  );
}

export function serializeDimensionPercentage<
  Dimension extends DimensionLiteral<string, string>,
>(
  value: DimensionPercentageLiteral<Dimension>,
  serializeDimension: (value: Dimension) => string,
): string {
  return 'unit' in value
    ? serializeDimension(value)
    : serializePercentage(value);
}

// CSS Values, "Combination of Percentages and Dimensions".
export function tryAddDimensionPercentages<
  Dimension extends DimensionLiteral<string, string>,
>(
  a: DimensionPercentageLiteral<Dimension>,
  b: DimensionPercentageLiteral<Dimension>,
): DimensionPercentageLiteral<Dimension> | null {
  if (!('unit' in a) && !('unit' in b)) {
    return addPercentages(a, b);
  }

  if ('unit' in a && 'unit' in b && a.unit === b.unit) {
    return addDimensions(a, b) as Dimension;
  }

  return null;
}

export function tryInterpolateDimensionPercentages<
  Dimension extends DimensionLiteral<string, string>,
>(
  a: DimensionPercentageLiteral<Dimension>,
  b: DimensionPercentageLiteral<Dimension>,
  p: number,
): DimensionPercentageLiteral<Dimension> | null {
  if (!('unit' in a) && !('unit' in b)) {
    return interpolatePercentages(a, b, p);
  }

  if ('unit' in a && 'unit' in b && a.unit === b.unit) {
    return interpolateDimensions(a, b, p) as Dimension;
  }

  return null;
}

export function tryAccumulateDimensionPercentages<
  Dimension extends DimensionLiteral<string, string>,
>(
  a: DimensionPercentageLiteral<Dimension>,
  b: DimensionPercentageLiteral<Dimension>,
): DimensionPercentageLiteral<Dimension> | null {
  return tryAddDimensionPercentages(a, b);
}
