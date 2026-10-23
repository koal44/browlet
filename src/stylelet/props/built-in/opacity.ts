import { ValueStage } from '../../value-processing/index';
import { NumberLiteral } from '../../values/numeric-literal/index';
import { OpacityValue, NumberValue } from '../../values/index';
import { BuiltInProperty } from '../builtin-property';

// https://drafts.csswg.org/css-color-4/#transparency
export const opacityProperty = new BuiltInProperty({
  name: 'opacity',
  parse: OpacityValue.parse,
  inherits: false,
  initialValue: new OpacityValue(new NumberValue(new NumberLiteral(1))),
  animationType: 'by-computed-value',
  percentages: 'number',
  resolvedValueStage: ValueStage.Computed,
});
