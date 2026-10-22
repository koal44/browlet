import type { TryConsumer } from '../../syntax/index';

import { TimeLiteral } from './time';
import type { PercentageLiteral } from './percentage';
import { createDimensionPercentageConsumer, type DimensionPercentageConsumerOptions } from './dimension-percentage';

/** The literal alternatives in <time-percentage>; there is no additional value container. */
export type TimePercentageLiteral = TimeLiteral | PercentageLiteral;

export type TimePercentageConsumerOptions = DimensionPercentageConsumerOptions;

/** Configure the literal alternatives before contextual percentage resolution. */
// https://drafts.csswg.org/css-values-4/#typedef-time-percentage
export function createTimePercentageConsumer(
  options: DimensionPercentageConsumerOptions = {},
): TryConsumer<TimePercentageLiteral> {
  return createDimensionPercentageConsumer(TimeLiteral.consume, 'Time-percentage', options);
}
