import { one, oneOf } from '../parser/component-grammar';
import {
  isBad, ok,
  type TryComponentConsumer, type TryComponentConsumerResult,
} from '../parser/component-try-consumer';
import {
  addDimensions, interpolateDimensions,
  type DimensionValue,
} from './dimension';
import {
  addPercentages, interpolatePercentages, serializePercentage, tryConsumePercentage,
  type PercentageValue,
} from './percentage';

/*
 * Shared mechanics for the mixed dimension-percentage productions. This is
 * not itself a CSS value production.
 */

export type DimensionPercentageValue<
  Dimension extends DimensionValue<string, string>,
> = Dimension | PercentageValue;

export type DimensionPercentageConsumerOptions = {
  /** Inclusive lower bound on the resolved mixed quantity. */
  min?: number;

  /** Inclusive upper bound on the resolved mixed quantity. */
  max?: number;
};

export function createDimensionPercentageConsumer<
  Dimension extends DimensionValue<string, string>,
>(
  tryConsumeDimension: TryComponentConsumer<Dimension>,
  productionName: string,
  options: DimensionPercentageConsumerOptions = {},
): TryComponentConsumer<DimensionPercentageValue<Dimension>> {
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;

  if (!canCheckRangeWithoutResolution(min, max)) {
    throw new Error(
      `${productionName} ranges with finite nonzero bounds are not yet supported`,
    );
  }

  const tryConsumeUnrestricted: TryComponentConsumer<
    DimensionPercentageValue<Dimension>
  > = oneOf(
    [
      one(tryConsumeDimension),
      one(tryConsumePercentage),
    ],
    ([value]) => ok(value),
  );

  return (c): TryComponentConsumerResult<
    DimensionPercentageValue<Dimension>
  > => {
    const start = c.pos();
    const result = tryConsumeUnrestricted(c);

    if (result === null || isBad(result)) {
      return result;
    }

    if (result.value.value < min || result.value.value > max) {
      c.restore(start);
      return null;
    }

    return result;
  };
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
  Dimension extends DimensionValue<string, string>,
>(
  value: DimensionPercentageValue<Dimension>,
  serializeDimension: (value: Dimension) => string,
): string {
  return 'unit' in value
    ? serializeDimension(value)
    : serializePercentage(value);
}

// CSS Values, "Combination of Percentages and Dimensions".
export function tryAddDimensionPercentages<
  Dimension extends DimensionValue<string, string>,
>(
  a: DimensionPercentageValue<Dimension>,
  b: DimensionPercentageValue<Dimension>,
): DimensionPercentageValue<Dimension> | null {
  if (!('unit' in a) && !('unit' in b)) {
    return addPercentages(a, b);
  }

  if ('unit' in a && 'unit' in b && a.unit === b.unit) {
    return addDimensions(a, b) as Dimension;
  }

  return null;
}

export function tryInterpolateDimensionPercentages<
  Dimension extends DimensionValue<string, string>,
>(
  a: DimensionPercentageValue<Dimension>,
  b: DimensionPercentageValue<Dimension>,
  p: number,
): DimensionPercentageValue<Dimension> | null {
  if (!('unit' in a) && !('unit' in b)) {
    return interpolatePercentages(a, b, p);
  }

  if ('unit' in a && 'unit' in b && a.unit === b.unit) {
    return interpolateDimensions(a, b, p) as Dimension;
  }

  return null;
}

export function tryAccumulateDimensionPercentages<
  Dimension extends DimensionValue<string, string>,
>(
  a: DimensionPercentageValue<Dimension>,
  b: DimensionPercentageValue<Dimension>,
): DimensionPercentageValue<Dimension> | null {
  return tryAddDimensionPercentages(a, b);
}
