import { InternalError } from '../../../infra/internal-error';

import { one, oneOf, type TryConsumer } from '../../syntax/index';

import type { DimensionLiteral } from './dimension';
import { PercentageLiteral } from './percentage';

export type DimensionPercentageConsumerOptions = {
  /** Inclusive lower bound on the resolved mixed quantity. */
  min?: number;
  /** Inclusive upper bound on the resolved mixed quantity. */
  max?: number;
};

/** Shared grammar mechanics for a dimension family or percentage, without a wrapping value. */
export function createDimensionPercentageConsumer<Dimension extends DimensionLiteral>(
  consumeDimension: TryConsumer<Dimension>,
  productionName: string,
  options: DimensionPercentageConsumerOptions = {},
): TryConsumer<Dimension | PercentageLiteral> {
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;
  if (!((min === -Infinity || min === 0) && (max === 0 || max === Infinity))) {
    throw new InternalError(`${productionName} ranges with finite nonzero bounds are not yet supported`);
  }
  return oneOf([
    one(consumeDimension),
    one(PercentageLiteral.consume),
  ], ([literal]) => literal.value < min || literal.value > max ? null : literal);
}
