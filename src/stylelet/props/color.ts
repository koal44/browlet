import { resolveColorValue, serializeColorValue, tryConsumeColor } from '../values/color';
import { defineProperty } from '../values/property-value';

export const colorProperty = defineProperty({
  tryConsume: tryConsumeColor,
  resolve: resolveColorValue,
  serialize: serializeColorValue,
});
