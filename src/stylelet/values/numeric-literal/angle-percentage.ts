import type { TryConsumer } from '../../syntax/index';

import { AngleLiteral } from './angle';
import type { PercentageLiteral } from './percentage';
import { createDimensionPercentageConsumer, type DimensionPercentageConsumerOptions } from './dimension-percentage';

/** The literal alternatives in <angle-percentage>; there is no additional value container. */
export type AnglePercentageLiteral = AngleLiteral | PercentageLiteral;

export type AnglePercentageConsumerOptions = DimensionPercentageConsumerOptions;

/** Configure the literal alternatives before contextual percentage resolution. */
// https://drafts.csswg.org/css-values-4/#typedef-angle-percentage
export function createAnglePercentageConsumer(
  options: DimensionPercentageConsumerOptions = {},
): TryConsumer<AnglePercentageLiteral> {
  return createDimensionPercentageConsumer(AngleLiteral.consume, 'Angle-percentage', options);
}
