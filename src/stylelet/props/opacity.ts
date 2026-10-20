import type { ValueDefinition } from '../value-processing/index';
import {
  consumeOpacityValue, resolveOpacityValue, serializeOpacityValue, defineWholeValue,
  type MathContext, type OpacityValue,
} from '../values/index';
import type { PropertyRecord } from '../css/index';

const opacityDef: ValueDefinition<OpacityValue, MathContext> = {
  consume: consumeOpacityValue,
  resolve: resolveOpacityValue,
  serialize: serializeOpacityValue,
};

export const opacityWholeValueDef = defineWholeValue(opacityDef);

// https://drafts.csswg.org/css-color-4/#transparency
export const opacityProperty: PropertyRecord<OpacityValue, MathContext> = {
  definition: opacityWholeValueDef,
  inherits: false,
  initialValue: { type: 'ordinary', value: { type: 'number', value: 1 } },
};
