import type { ValueDefinition } from '../value-processing/definition';
import type { MathContext } from '../values/math-value';
import {
  consumeOpacityValue, resolveOpacityValue, serializeOpacityValue,
  type OpacityValue,
} from '../values/opacity-value';
import { defineProperty } from '../values/whole-value';

const opacityDef: ValueDefinition<OpacityValue, MathContext> = {
  consume: consumeOpacityValue,
  resolve: resolveOpacityValue,
  serialize: serializeOpacityValue,
};

export const opacityProperty = defineProperty(opacityDef);
