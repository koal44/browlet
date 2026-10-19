import type { ValueDefinition } from '../value-processing/index';
import {
  consumeOpacityValue, resolveOpacityValue, serializeOpacityValue, defineProperty,
  type MathContext, type OpacityValue,
} from '../values/index';

const opacityDef: ValueDefinition<OpacityValue, MathContext> = {
  consume: consumeOpacityValue,
  resolve: resolveOpacityValue,
  serialize: serializeOpacityValue,
};

export const opacityProperty = defineProperty(opacityDef);
