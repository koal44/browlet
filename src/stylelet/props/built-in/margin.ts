import { one, oneOf, repeat, withTrivia, createComponentParser, type ParserInput, type TryConsumer } from '../../syntax/index';
import { ValueStage } from '../../value-processing/index';
import { LengthLiteral } from '../../values/numeric-literal/index';
import {
  AutoValue, LengthPercentageValue, type WholeValue, type MathContext, type Value,
} from '../../values/index';
import { PropertyRecord, type PropertyContext } from '../property';
import { Shorthand } from '../shorthand';

/** The physical margin shorthand, expanding values in top/right/bottom/left order. */
// https://drafts.csswg.org/css-box-4/#margin-shorthand
export class MarginShorthand extends Shorthand<MarginSideValue> {
  constructor() {
    super('margin', [
      ['margin-top', marginSideProperty],
      ['margin-right', marginSideProperty],
      ['margin-bottom', marginSideProperty],
      ['margin-left', marginSideProperty],
    ]);
  }

  protected override parseValues(input: ParserInput, context: PropertyContext): MarginSideValue[] | null {
    const values = parseMarginValues(input, context);
    if (values === null) return null;
    const [top, right = top, bottom = top, left = right] = values;
    return [top, right, bottom, left];
  }

  protected override serializeValues(values: WholeValue<Value>['value'][]): string {
    if (!values.every((value) => value instanceof LengthPercentageValue || value instanceof AutoValue)) return '';
    const text = values.map((value) => value.serialize());
    if (text[3] === text[1]) {
      text.pop();
      if (text[2] === text[0]) {
        text.pop();
        if (text[1] === text[0]) text.pop();
      }
    }
    return text.join(' ');
  }
}

type MarginSideValue = LengthPercentageValue | AutoValue;

/*
 * <margin-top>, <margin-right>, <margin-bottom>, <margin-left> =
 *   <length-percentage> | auto
 * <margin> = <'margin-top'>{1,4}
 */

// <margin-top>, <margin-right>, <margin-bottom>, <margin-left> = <length-percentage> | auto
const marginSideValueConsumer: TryConsumer<MarginSideValue, MathContext> = oneOf(
  [one(LengthPercentageValue.consume), one(AutoValue.consume)],
  ([value], context: MathContext) => {
    const resolved = value.resolve(ValueStage.Declared, context);
    // The property accepts unitless zero as a length; retain its declared px representation.
    // https://drafts.csswg.org/css-values-4/#lengths
    return resolved instanceof LengthPercentageValue && resolved.value instanceof LengthLiteral && resolved.value.unit === ''
      ? new LengthPercentageValue(new LengthLiteral(0, 'px'))
      : resolved;
  },
);
const parseMarginSideValue = createComponentParser(withTrivia(marginSideValueConsumer));
const parseMarginValues = createComponentParser(repeat(withTrivia(marginSideValueConsumer), 1, 4));

/** Shared grammar and metadata for the four physical margin longhands. */
// https://drafts.csswg.org/css-box-4/#margin-physical
export const marginSideProperty = new PropertyRecord(parseMarginSideValue, {
  inherits: false,
  initialValue: new LengthPercentageValue(new LengthLiteral(0, 'px')),
  logicalGroup: { name: 'margin', mapping: 'physical' },
});

export const marginShorthand = new MarginShorthand();
