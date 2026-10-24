import { InternalError } from '../../../infra/internal-error';

import { one, oneOf, repeat, withTrivia, createComponentParser, type ParserInput, type TryConsumer } from '../../syntax/index';
import { ValueStage } from '../../value-processing/index';
import { LengthLiteral } from '../../values/numeric-literal/index';
import {
  AutoValue, LengthPercentageValue, type WholeValueContents, type MathContext, type Value,
} from '../../values/index';
import type { PropertyContext } from '../base-property';
import { Shorthand } from '../shorthand';
import { BuiltInProperty, type BuiltInPropertyDefinition } from '../builtin-property';

/** The physical margin shorthand, expanding values in top/right/bottom/left order. */
// https://drafts.csswg.org/css-box-4/#margin-shorthand
export class MarginShorthand extends Shorthand<MarginSideValue> {
  constructor() {
    super('margin', [
      marginTopProperty, marginRightProperty, marginBottomProperty, marginLeftProperty,
    ]);
  }

  protected override parseValues(input: ParserInput, context: PropertyContext): MarginSideValue[] | null {
    const values = parseMarginValues(input, context);
    if (values === null) return null;
    const [top, right = top, bottom = top, left = right] = values;
    return [top, right, bottom, left];
  }

  protected override serializeValues(values: WholeValueContents<Value>[]): string {
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
    return resolved instanceof LengthPercentageValue && resolved.repr instanceof LengthLiteral && resolved.repr.unit === ''
      ? new LengthPercentageValue(new LengthLiteral(0, 'px'))
      : resolved;
  },
);
const parseMarginSideValue = createComponentParser(withTrivia(marginSideValueConsumer));
const parseMarginValues = createComponentParser(repeat(withTrivia(marginSideValueConsumer), 1, 4));

/** Shared grammar and metadata for the four physical margin longhands. */
// https://drafts.csswg.org/css-box-4/#margin-physical
const marginSideDefinition: Omit<BuiltInPropertyDefinition<MarginSideValue>, 'name'> = {
  parse: parseMarginSideValue,
  inherits: false,
  initialValue: new LengthPercentageValue(new LengthLiteral(0, 'px')),
  appliesTo() {
    // TODO: Exclude internal table elements and ruby base/annotation containers using box classification.
    throw new InternalError('Margin applicability requires box classification');
  },
  animationType: {
    // The auto branch requests discrete fallback; numeric pairs use their existing operations.
    interpolate(from, to, progress, context) {
      const fromInner = from.ordinaryValue();
      const toInner = to.ordinaryValue();
      if (fromInner instanceof AutoValue || toInner instanceof AutoValue) return null;
      return from.withValue(fromInner.interpolate(toInner, progress, context), to);
    },
    add(underlying, effect, context) {
      const underlyingInner = underlying.ordinaryValue();
      const effectInner = effect.ordinaryValue();
      if (underlyingInner instanceof AutoValue || effectInner instanceof AutoValue) return null;
      return underlying.withValue(underlyingInner.add(effectInner, context), effect);
    },
    accumulate(underlying, effect, context) {
      const underlyingInner = underlying.ordinaryValue();
      const effectInner = effect.ordinaryValue();
      if (underlyingInner instanceof AutoValue || effectInner instanceof AutoValue) return null;
      return underlying.withValue(underlyingInner.accumulate(effectInner, context), effect);
    },
  },
  percentages: {
    resolveAt: ValueStage.Used,
    reference: (context) => context.containingBlockInlineSize === undefined
      ? undefined : new LengthLiteral(context.containingBlockInlineSize, 'px'),
  },
  // https://drafts.csswg.org/cssom/#resolved-values
  resolvedValueStage() {
    // TODO: Use Used when applicable and resolved display is neither none nor contents; otherwise Computed.
    throw new InternalError('Margin resolved-value stage requires property applicability and resolved display');
  },
  logicalGroup: { name: 'margin', mapping: 'physical' },
};

export const marginTopProperty = new BuiltInProperty({ name: 'margin-top', ...marginSideDefinition });
export const marginRightProperty = new BuiltInProperty({ name: 'margin-right', ...marginSideDefinition });
export const marginBottomProperty = new BuiltInProperty({ name: 'margin-bottom', ...marginSideDefinition });
export const marginLeftProperty = new BuiltInProperty({ name: 'margin-left', ...marginSideDefinition });

export const marginShorthand = new MarginShorthand();
