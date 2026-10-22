import { ColorKind, ColorValue } from '../../values/index';
import { PropertyRecord } from '../property';

// https://drafts.csswg.org/css-color-4/#the-color-property
export const colorProperty = new PropertyRecord(ColorValue.parse, {
  inherits: true,
  initialValue: new ColorValue({ kind: ColorKind.System, name: 'canvastext' }),
});

// https://drafts.csswg.org/css-backgrounds-3/#background-color
export const backgroundColorProperty = new PropertyRecord(ColorValue.parse, {
  inherits: false,
  initialValue: new ColorValue({ kind: ColorKind.Named, name: 'transparent' }),
});
