import { createNumericRange } from '../../infra/range';

import {
  one, oneOf, withTrivia, parseAsComponentGrammar,
  type ComponentValue, type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';
import { PercentageLiteral, type PercentageConsumerOptions } from './numeric-literal/index';

import type { Value } from './value';
import { MathValue, type MathContext } from './math-value';

/** A <percentage> literal or calculation with its own lifecycle operations. */
// https://drafts.csswg.org/css-values-4/#percentages
export class PercentageValue<R extends Percentage = Percentage> implements Value<MathContext> {
  /** The literal or math value at the current lifecycle stage. */
  repr: R;

  constructor(value: R) {
    this.repr = value;
  }

  /** Parse one complete <percentage>. */
  static parse(input: ParserInput, context: MathContext): PercentageValue | null {
    return parseAsComponentGrammar(input, percentageGrammar, context);
  }

  /** Consume one <percentage> using the default literal limits. */
  static consume(this: void, c: TokenCursor<ComponentValue, MathContext>): TryConsumerResult<PercentageValue> {
    return percentageConsumer(c);
  }

  /** Apply literal limits and the corresponding calculation range to this grammar. */
  static createConsumer(options: PercentageConsumerOptions = {}): TryConsumer<PercentageValue, MathContext> {
    const literalConsumer = PercentageLiteral.createConsumer(options);

    return oneOf([
      one(literalConsumer),
      one(MathValue.createConsumer({
        expectedType: 'percentage',
        percentHint: 'percent',
        range: createNumericRange(options.min, options.max),
      })),
    ], ([parsed]) => new PercentageValue(parsed));
  }

  /** Resolve with the current context, preserving identity when the representation is unchanged. */
  resolve(stage: ValueStage, context: MathContext = {}): PercentageValue {
    const previous = this.repr;
    if (previous instanceof MathValue) {
      const resolved = previous.resolve(stage, percentageMathContext(context));
      return resolved === previous ? this : new PercentageValue(resolved);
    }
    return this;
  }

  /** Serialize the current representation without resolving it. */
  serialize(): string {
    return this.repr.serialize();
  }

  /** Add compatible literals directly, retaining other combinations as math. */
  add(other: PercentageValue, context: MathContext = {}): PercentageValue {
    if (!(this.repr instanceof MathValue) && !(other.repr instanceof MathValue)) {
      return new PercentageValue(this.repr.add(other.repr));
    }
    const mathContext = percentageMathContext(context);
    return new PercentageValue(
      this.#asMathValue(mathContext).add(other.#asMathValue(mathContext), mathContext),
    );
  }

  /** Interpolate compatible literals directly, retaining other combinations as math. */
  interpolate(other: PercentageValue, progress: number, context: MathContext = {}): PercentageValue {
    if (!(this.repr instanceof MathValue) && !(other.repr instanceof MathValue)) {
      return new PercentageValue(this.repr.interpolate(other.repr, progress));
    }
    const mathContext = percentageMathContext(context);
    return new PercentageValue(
      this.#asMathValue(mathContext).interpolate(other.#asMathValue(mathContext), progress, mathContext),
    );
  }

  /** Accumulation is addition. */
  accumulate(other: PercentageValue, context: MathContext = {}): PercentageValue {
    return this.add(other, context);
  }

  #asMathValue(context: MathContext): MathValue<'percentage'> {
    return this.repr instanceof MathValue
      ? this.repr : MathValue.fromLiteral(this.repr, 'percentage', context);
  }
}

/** Literal or calculation accepted by this numeric grammar. */
type Percentage = PercentageLiteral | MathValue<'percentage'>;

function percentageMathContext(
  context: MathContext,
): MathContext {
  return {
    ...context,
    percentHint: 'percent',
    percentageReferenceValue: undefined,
  };
}

const percentageConsumer = PercentageValue.createConsumer();
const percentageGrammar = withTrivia(percentageConsumer);
