import {
  ColorKind, WholeValue, ColorValue, type ColorValueContext,
} from '../values/index';

import type { PropertyRecord } from './property';

export const parseColorProperty = WholeValue.createParser(ColorValue.parse);

// https://drafts.csswg.org/css-color-4/#the-color-property
export const colorProperty: PropertyRecord<ColorValue, ColorValueContext> = {
  parse: parseColorProperty,
  inherits: true,
  initialValue: new WholeValue<ColorValue, ColorValueContext>(
    new ColorValue({ kind: ColorKind.System, name: 'canvastext' }), ColorValue.parse,
  ),
};

// https://drafts.csswg.org/css-backgrounds-3/#background-color
export const backgroundColorProperty: PropertyRecord<ColorValue, ColorValueContext> = {
  parse: parseColorProperty,
  inherits: false,
  initialValue: new WholeValue<ColorValue, ColorValueContext>(
    new ColorValue({ kind: ColorKind.Named, name: 'transparent' }), ColorValue.parse,
  ),
};
