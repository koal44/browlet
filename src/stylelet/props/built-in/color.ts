import { ValueStage } from '../../value-processing/index';
import { ColorKind, ColorValue } from '../../values/index';
import { BuiltInProperty } from '../builtin-property';

// https://drafts.csswg.org/css-color-4/#the-color-property
export const colorProperty = new BuiltInProperty({
  name: 'color',
  parse: ColorValue.parse,
  inherits: true,
  initialValue: new ColorValue({ kind: ColorKind.System, name: 'canvastext' }),
  appliesTo: () => true,
  animationType: 'by-computed-value',
  percentages: 'not-applicable',
  resolvedValueStage: ValueStage.Used,
});

// https://drafts.csswg.org/css-backgrounds-3/#background-color
export const backgroundColorProperty = new BuiltInProperty({
  name: 'background-color',
  parse: ColorValue.parse,
  inherits: false,
  initialValue: new ColorValue({ kind: ColorKind.Named, name: 'transparent' }),
  appliesTo: () => true,
  animationType: 'by-computed-value',
  percentages: 'not-applicable',
  resolvedValueStage: ValueStage.Used,
});
