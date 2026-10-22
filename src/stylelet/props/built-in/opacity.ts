import { NumberLiteral } from '../../values/numeric-literal/index';
import { OpacityValue, NumberValue } from '../../values/index';
import { PropertyRecord } from '../property';

// https://drafts.csswg.org/css-color-4/#transparency
export const opacityProperty = new PropertyRecord(OpacityValue.parse, {
  inherits: false,
  initialValue: new OpacityValue(new NumberValue(new NumberLiteral(1))),
});
