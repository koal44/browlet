import { clamp } from '../../infra/util';

import {
  one, oneOf, withTrivia, createComponentParser,
  type ComponentValue, type TokenCursor, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import { ValueStage } from '../value-processing/index';
import { NumberLiteral, PercentageLiteral } from './numeric-literal/index';

import type { Value } from './value';
import { MathValue, MathExpression, type MathContext } from './math-value';
import { NumberValue } from './number';
import { PercentageValue } from './percentage';

/** An opacity with percentage conversion and computed-stage clamping. */
// https://drafts.csswg.org/css-color-4/#transparency
export class OpacityValue<R extends Opacity = Opacity> implements Value<MathContext> {
  /** The retained number or percentage, including an unresolved calculation. */
  repr: R;

  constructor(value: R) {
    this.repr = value;
  }

  /** Parse a complete <opacity-value>. */
  static parse(this: void, input: ParserInput, context: MathContext): OpacityValue | null {
    return opacityValueParser(input, context);
  }

  /** Consume one opacity and prepare its declared representation. */
  static consume(this: void, c: TokenCursor<ComponentValue, MathContext>): TryConsumerResult<OpacityValue> {
    return opacityValueConsumer(c);
  }

  /** Convert resolved percentages to numbers and clamp from the computed stage onward. */
  resolve(stage: ValueStage, context: MathContext = {}): OpacityValue {
    const resolved = this.repr.resolve(stage, {
      ...context,
      unwrapMathAt: context.unwrapMathAt ?? ValueStage.Computed,
    });
    const numeric = resolved.repr;
    const literal = numeric instanceof MathValue ? numeric.repr : numeric;
    if (literal instanceof MathExpression) {
      return resolved === this.repr ? this : new OpacityValue(resolved);
    }

    const magnitude = literal instanceof PercentageLiteral ? literal.value / 100 : literal.value;
    const number = stage < ValueStage.Computed ? magnitude : clamp(magnitude, 0, 1);
    if (numeric instanceof NumberLiteral && Object.is(number, numeric.value)) {
      return resolved === this.repr ? this : new OpacityValue(resolved);
    }
    return new OpacityValue(new NumberValue(new NumberLiteral(number)));
  }

  /** Serialize the current representation without conversion or clamping. */
  serialize(): string {
    return this.repr.serialize();
  }

  /** Add opacities in their number scale; resolution applies the stage's limits. */
  add(other: OpacityValue, context: MathContext = {}): OpacityValue {
    return new OpacityValue(this.#asNumber().add(other.#asNumber(), context));
  }

  /** Interpolate opacities in their number scale. */
  interpolate(other: OpacityValue, progress: number, context: MathContext = {}): OpacityValue {
    return new OpacityValue(this.#asNumber().interpolate(other.#asNumber(), progress, context));
  }

  /** Accumulation is addition. */
  accumulate(other: OpacityValue, context: MathContext = {}): OpacityValue {
    return this.add(other, context);
  }

  #asNumber(): NumberValue {
    if (this.repr instanceof NumberValue) return this.repr;
    const percentage = this.repr.repr;
    return new NumberValue(percentage instanceof MathValue
      ? percentage.toNumber(1 / 100, 1)
      : new NumberLiteral(percentage.value / 100));
  }
}

type Opacity = NumberValue | PercentageValue;

// <opacity-value> = <number> | <percentage>
const opacityValueConsumer = oneOf(
  [one(NumberValue.consume), one(PercentageValue.consume)],
  ([value], context: MathContext) => new OpacityValue(value).resolve(ValueStage.Declared, context),
);
const opacityValueParser = createComponentParser(withTrivia(opacityValueConsumer));
