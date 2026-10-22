import { NumberLiteral } from '../values/numeric-literal/index';
import {
  WholeValue, OpacityValue, NumberValue, type MathContext,
} from '../values/index';

import type { PropertyRecord } from './property';

export const parseOpacityProperty = WholeValue.createParser(OpacityValue.parse);

// https://drafts.csswg.org/css-color-4/#transparency
export const opacityProperty: PropertyRecord<OpacityValue, MathContext> = {
  parse: parseOpacityProperty,
  inherits: false,
  initialValue: new WholeValue<OpacityValue, MathContext>(
    new OpacityValue(new NumberValue(new NumberLiteral(1))), OpacityValue.parse,
  ),
};
