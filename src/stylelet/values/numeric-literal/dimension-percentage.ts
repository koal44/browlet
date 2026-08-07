import { one, oneOf } from '../../syntax/component-grammar';
import { type TryConsumer } from '../../syntax/token-cursor';
import {
  addDimensions, interpolateDimensions, type AnyDimensionLiteral,
} from './dimension';
import {
  addPercentages, interpolatePercentages, serializePercentage, consumePercentage,
  type PercentageLiteral,
} from './percentage';

/*
 * Shared mechanics for the mixed dimension-percentage productions. This is
 * not itself a CSS value production.
 */

export type DimensionPercentageLiteral<
  Dimension extends AnyDimensionLiteral,
> = Dimension | PercentageLiteral;

export type DimensionPercentageConsumerOptions = {
  /** Inclusive lower bound on the resolved mixed quantity. */
  min?: number;

  /** Inclusive upper bound on the resolved mixed quantity. */
  max?: number;
};

export function createDimensionPercentageConsumer<
  Dimension extends AnyDimensionLiteral,
>(
  consumeDimension: TryConsumer<Dimension>,
  productionName: string,
  options: DimensionPercentageConsumerOptions = {},
): TryConsumer<DimensionPercentageLiteral<Dimension>> {
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;

  if (!canCheckRangeWithoutResolution(min, max)) {
    throw new Error(
      `${productionName} ranges with finite nonzero bounds are not yet supported`,
    );
  }

  return oneOf(
    [
      one(consumeDimension),
      one(consumePercentage),
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
  Dimension extends AnyDimensionLiteral,
>(
  value: DimensionPercentageLiteral<Dimension>,
  serializeDimension: (value: Dimension) => string,
): string {
  return value.type === 'percentage'
    ? serializePercentage(value)
    : serializeDimension(value);
}

// CSS Values, "Combination of Percentages and Dimensions".
export function tryAddDimensionPercentages<
  Dimension extends AnyDimensionLiteral,
>(
  a: DimensionPercentageLiteral<Dimension>,
  b: DimensionPercentageLiteral<Dimension>,
): DimensionPercentageLiteral<Dimension> | null {
  if (a.type === 'percentage' && b.type === 'percentage') {
    return addPercentages(a, b);
  }

  if (
    a.type !== 'percentage' &&
    b.type !== 'percentage' &&
    a.unit === b.unit
  ) {
    return addDimensions(a, b);
  }

  return null;
}

export function tryInterpolateDimensionPercentages<
  Dimension extends AnyDimensionLiteral,
>(
  a: DimensionPercentageLiteral<Dimension>,
  b: DimensionPercentageLiteral<Dimension>,
  p: number,
): DimensionPercentageLiteral<Dimension> | null {
  if (a.type === 'percentage' && b.type === 'percentage') {
    return interpolatePercentages(a, b, p);
  }

  if (
    a.type !== 'percentage' &&
    b.type !== 'percentage' &&
    a.unit === b.unit
  ) {
    return interpolateDimensions(a, b, p);
  }

  return null;
}

export function tryAccumulateDimensionPercentages<
  Dimension extends AnyDimensionLiteral,
>(
  a: DimensionPercentageLiteral<Dimension>,
  b: DimensionPercentageLiteral<Dimension>,
): DimensionPercentageLiteral<Dimension> | null {
  return tryAddDimensionPercentages(a, b);
}
