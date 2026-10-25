import { createNumericRange } from '../../infra/range';

import {
  one, oneOf, withTrivia, parseAsComponentGrammar,
  type ComponentValue, type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import { ValueStage } from '../value-processing/index';
import {
  AngleLiteral, PercentageLiteral, createAnglePercentageConsumer,
  type AnglePercentageLiteral, type DimensionPercentageConsumerOptions,
} from './numeric-literal/index';

import type { Value } from './value';
import { MathValue, MathExpression, type MathContext } from './math-value';

/** An <angle-percentage>, including calculations that still need a percentage reference. */
// https://drafts.csswg.org/css-values-4/#typedef-angle-percentage
export class AnglePercentageValue<R extends AnglePercentage = AnglePercentage> implements Value<MathContext> {
  /** The literal or math value at the current lifecycle stage. */
  repr: R;

  constructor(value: R) {
    this.repr = value;
  }

  /** Parse a complete <angle-percentage>. */
  static parse(input: ParserInput, context: MathContext): AnglePercentageValue | null {
    return parseAsComponentGrammar(input, anglePercentageGrammar, context);
  }

  /** Consume one <angle-percentage> using the default literal range. */
  static consume(
    this: void,
    c: TokenCursor<ComponentValue, MathContext>,
  ): TryConsumerResult<AnglePercentageValue> {
    return anglePercentageConsumer(c);
  }

  /** Bind optional literal limits to the corresponding literal and math grammars. */
  static createConsumer(
    options: DimensionPercentageConsumerOptions = {},
  ): TryConsumer<AnglePercentageValue, MathContext> {
    // <angle-percentage> = <angle> | <percentage>
    // Percentages resolve to angles, including within math functions.
    const literalConsumer = createAnglePercentageConsumer(options);

    return oneOf([
      one(literalConsumer),
      one(MathValue.createConsumer({
        expectedType: 'angle-percentage',
        percentHint: 'angle',
        range: createNumericRange(options.min, options.max),
      })),
    ], ([value]) => new AnglePercentageValue(value));
  }

  /** Resolve angles and, when supplied, their percentage reference at the requested stage. */
  resolve(stage: ValueStage, context: MathContext): AnglePercentageValue {
    const previous = this.repr;
    if (previous instanceof MathValue) {
      const resolved = previous.resolve(stage, anglePercentageMathContext(context));
      const value = resolved.repr instanceof MathExpression ? resolved : resolved.repr;
      return value === previous ? this : new AnglePercentageValue(value);
    }

    if (stage < ValueStage.Computed || (previous.type === 'angle' && previous.unit === 'deg')) return this;

    const reference = context.percentageReferenceValue;
    const resolved = previous instanceof AngleLiteral
      ? previous.canonicalize()
      : reference?.type === 'angle' ? new AngleLiteral(reference.value * previous.value / 100, 'deg') : null;
    return resolved === null ? this : new AnglePercentageValue(resolved);
  }

  /** Serialize the current literal or calculation without changing its stage. */
  serialize(): string {
    return this.repr.serialize();
  }

  /** Add directly compatible literals, retaining other combinations as math. */
  add(other: AnglePercentageValue, context: MathContext): AnglePercentageValue {
    if (this.repr instanceof PercentageLiteral && other.repr instanceof PercentageLiteral) {
      return new AnglePercentageValue(this.repr.add(other.repr));
    }
    if (this.repr instanceof AngleLiteral && other.repr instanceof AngleLiteral && this.repr.unit === other.repr.unit) {
      return new AnglePercentageValue(this.repr.add(other.repr));
    }
    const mathContext = anglePercentageMathContext(context);
    return new AnglePercentageValue(this.#asMathValue(mathContext).add(other.#asMathValue(mathContext), mathContext));
  }

  /** Interpolate directly compatible literals, retaining other combinations as math. */
  interpolate(other: AnglePercentageValue, progress: number, context: MathContext): AnglePercentageValue {
    if (this.repr instanceof PercentageLiteral && other.repr instanceof PercentageLiteral) {
      return new AnglePercentageValue(this.repr.interpolate(other.repr, progress));
    }
    if (this.repr instanceof AngleLiteral && other.repr instanceof AngleLiteral && this.repr.unit === other.repr.unit) {
      return new AnglePercentageValue(this.repr.interpolate(other.repr, progress));
    }
    const mathContext = anglePercentageMathContext(context);
    return new AnglePercentageValue(
      this.#asMathValue(mathContext).interpolate(other.#asMathValue(mathContext), progress, mathContext),
    );
  }

  /** Accumulation of angle-percentages is addition. */
  accumulate(other: AnglePercentageValue, context: MathContext): AnglePercentageValue {
    return this.add(other, context);
  }

  #asMathValue(context: MathContext): MathValue<'angle-percentage'> {
    return this.repr instanceof MathValue
      ? this.repr : MathValue.fromLiteral(this.repr, 'angle-percentage', context);
  }
}

type AnglePercentage = AnglePercentageLiteral | MathValue<'angle-percentage'>;

function anglePercentageMathContext(context: MathContext): MathContext {
  return { ...context, percentHint: 'angle' };
}

const anglePercentageConsumer = AnglePercentageValue.createConsumer();
const anglePercentageGrammar = withTrivia(anglePercentageConsumer);
