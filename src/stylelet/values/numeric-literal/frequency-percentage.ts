import type { TryConsumer } from '../../syntax/index';

import { FrequencyLiteral } from './frequency';
import type { PercentageLiteral } from './percentage';
import { createDimensionPercentageConsumer, type DimensionPercentageConsumerOptions } from './dimension-percentage';

/** The literal alternatives in <frequency-percentage>; there is no additional value container. */
export type FrequencyPercentageLiteral = FrequencyLiteral | PercentageLiteral;

export type FrequencyPercentageConsumerOptions = DimensionPercentageConsumerOptions;

/** Configure the literal alternatives before contextual percentage resolution. */
// https://drafts.csswg.org/css-values-4/#typedef-frequency-percentage
export function createFrequencyPercentageConsumer(
  options: DimensionPercentageConsumerOptions = {},
): TryConsumer<FrequencyPercentageLiteral> {
  return createDimensionPercentageConsumer(FrequencyLiteral.consume, 'Frequency-percentage', options);
}
