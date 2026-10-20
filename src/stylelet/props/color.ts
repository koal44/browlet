import {
  colorDef, ColorKind, defineWholeValue, type ColorValue, type ColorValueContext,
} from '../values/index';
import type { PropertyRecord } from '../css/index';

export const colorWholeValueDef = defineWholeValue(colorDef);

// https://drafts.csswg.org/css-color-4/#the-color-property
export const colorProperty: PropertyRecord<ColorValue, ColorValueContext> = {
  definition: colorWholeValueDef,
  inherits: true,
  initialValue: { type: 'ordinary', value: { kind: ColorKind.System, name: 'canvastext' } },
};

// https://drafts.csswg.org/css-backgrounds-3/#background-color
export const backgroundColorProperty: PropertyRecord<ColorValue, ColorValueContext> = {
  definition: colorWholeValueDef,
  inherits: false,
  initialValue: { type: 'ordinary', value: { kind: ColorKind.Named, name: 'transparent' } },
};
