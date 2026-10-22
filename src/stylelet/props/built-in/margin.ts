import { InternalError } from '../../../infra/internal-error';

import { one, oneOf, repeat, withTrivia, createComponentParser, type TryConsumer } from '../../syntax/index';
import { ValueStage } from '../../value-processing/index';
import { LengthLiteral } from '../../values/numeric-literal/index';
import {
  WholeValue, AutoValue, LengthPercentageValue, CssWideValue, OptionalDeclarationValue,
  SubstitutionValue, FirstValidValue, type MathContext,
} from '../../values/index';
import type { PropertyRecord } from '../property';
import type { ShorthandRecord } from '../shorthand';

/*
 * <margin-top>, <margin-right>, <margin-bottom>, <margin-left> =
 *   <length-percentage> | auto
 * <margin> = <'margin-top'>{1,4}
 */

type MarginSideValue = LengthPercentageValue | AutoValue;

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
export const parseMarginSideProperty = WholeValue.createParser(parseMarginSideValue);

/** The physical margin shorthand, expanding values in top/right/bottom/left order. */
// https://drafts.csswg.org/css-box-4/#margin-shorthand
export const marginShorthand: ShorthandRecord = {
  longhands: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  expand(input, context) {
    const declaration = OptionalDeclarationValue.parse(input, context);
    if (declaration === null) return null;
    if (SubstitutionValue.containsFunction(declaration.value) || FirstValidValue.parse(declaration.value, context) !== null) {
      // TODO: Retain one deferred shorthand shared by its longhands, then substitute
      // and parse the original grammar before selecting each longhand at Computed time.
      // https://drafts.csswg.org/css-values-5/#substitution-in-shorthands
      // https://drafts.csswg.org/css-values-5/#first-valid
      throw new InternalError('Deferred margin shorthand expansion is not implemented');
    }

    const cssWide = CssWideValue.parse(declaration.value, context);
    if (cssWide !== null) {
      return this.longhands.map(() => new WholeValue<MarginSideValue, MathContext>(cssWide, parseMarginSideValue));
    }
    const values = parseMarginValues(declaration.value, context);
    if (values === null) return null;
    const [top, right = top, bottom = top, left = right] = values;
    return [top, right, bottom, left].map((value) => new WholeValue<MarginSideValue, MathContext>(value, parseMarginSideValue));
  },
  serialize(values) {
    const components = values.map(({ value }) => value);
    const first = components[0]!;
    if (first instanceof CssWideValue) {
      return components.every((value) => value instanceof CssWideValue && value.value === first.value)
        ? first.serialize()
        : '';
    }
    // CSS-wide values cannot mix with ordinary sides, and independently deferred
    // longhands cannot be recombined into a shorthand before their grammar is known.
    // https://drafts.csswg.org/css-values-5/#substitution-in-shorthands
    if (!components.every((value) => value instanceof LengthPercentageValue || value instanceof AutoValue)) return '';
    const text = components.map((value) => value.serialize());
    if (text[3] === text[1]) {
      text.pop();
      if (text[2] === text[0]) {
        text.pop();
        if (text[1] === text[0]) text.pop();
      }
    }
    return text.join(' ');
  },
};

/** Shared grammar and metadata for the four physical margin longhands. */
// https://drafts.csswg.org/css-box-4/#margin-physical
export const marginSideProperty: PropertyRecord<MarginSideValue, MathContext> = {
  parse: parseMarginSideProperty,
  inherits: false,
  initialValue: new WholeValue<MarginSideValue, MathContext>(
    new LengthPercentageValue(new LengthLiteral(0, 'px')), parseMarginSideValue,
  ),
  logicalGroup: { name: 'margin', mapping: 'physical' },
};
