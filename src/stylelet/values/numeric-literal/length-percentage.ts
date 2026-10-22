import type { TryConsumer } from '../../syntax/index';

import { LengthLiteral, type CanonicalLengthLiteral } from './length';
import type { PercentageLiteral } from './percentage';
import { createDimensionPercentageConsumer, type DimensionPercentageConsumerOptions } from './dimension-percentage';

/** The literal alternatives in <length-percentage>; there is no additional value container. */
export type LengthPercentageLiteral = LengthLiteral | PercentageLiteral;
export type CanonicalLengthPercentageLiteral = CanonicalLengthLiteral | PercentageLiteral;

export type LengthPercentageConsumerOptions = DimensionPercentageConsumerOptions;

/** Configure the literal alternatives before contextual percentage resolution. */
// https://drafts.csswg.org/css-values-4/#typedef-length-percentage
export function createLengthPercentageConsumer(
  options: DimensionPercentageConsumerOptions = {},
): TryConsumer<LengthPercentageLiteral> {
  return createDimensionPercentageConsumer(LengthLiteral.consume, 'Length-percentage', options);
}
