import { createNumericRange } from '../../infra/range';

import {
  one, oneOf, withTrivia, parseAsComponentGrammar,
  type ComponentValue, type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import { ValueStage } from '../value-processing/index';
import {
  FrequencyLiteral, PercentageLiteral, createFrequencyPercentageConsumer,
  type FrequencyPercentageLiteral, type FrequencyPercentageConsumerOptions,
} from './numeric-literal/index';

import type { Value } from './value';
import { MathValue, MathExpression, type MathContext } from './math-value';

/** A <frequency-percentage> literal or calculation with its own lifecycle operations. */
// https://drafts.csswg.org/css-values-4/#typedef-frequency-percentage
export class FrequencyPercentageValue<R extends FrequencyPercentage = FrequencyPercentage> implements Value<MathContext> {
  /** The literal or math value at the current lifecycle stage. */
  repr: R;

  constructor(value: R) {
    this.repr = value;
  }

  /** Parse one complete <frequency-percentage>. */
  static parse(input: ParserInput, context: MathContext): FrequencyPercentageValue | null {
    return parseAsComponentGrammar(input, frequencyPercentageGrammar, context);
  }

  /** Consume one <frequency-percentage> using the default literal limits. */
  static consume(this: void, c: TokenCursor<ComponentValue, MathContext>): TryConsumerResult<FrequencyPercentageValue> {
    return frequencyPercentageConsumer(c);
  }

  /** Apply literal limits and the corresponding calculation range to this grammar. */
  static createConsumer(options: FrequencyPercentageConsumerOptions = {}): TryConsumer<FrequencyPercentageValue, MathContext> {
    // <frequency-percentage> = <frequency> | <percentage>
    // Percentages resolve to frequencies, including within math functions.
    const literalConsumer = createFrequencyPercentageConsumer(options);

    return oneOf([
      one(literalConsumer),
      one(MathValue.createConsumer({
        expectedType: 'frequency-percentage',
        percentHint: 'frequency',
        range: createNumericRange(options.min, options.max),
      })),
    ], ([parsed]) => new FrequencyPercentageValue(parsed));
  }

  /** Resolve with the current context, preserving identity when the representation is unchanged. */
  resolve(stage: ValueStage, context: MathContext = {}): FrequencyPercentageValue {
    const previous = this.repr;
    if (previous instanceof MathValue) {
      const resolved = previous.resolve(stage, frequencyPercentageMathContext(context));
      const value = resolved.repr instanceof MathExpression ? resolved : resolved.repr;
      return value === previous ? this : new FrequencyPercentageValue(value);
    }

    if (stage < ValueStage.Computed || (previous.type === 'frequency' && previous.unit === 'hz')) return this;

    const reference = context.percentageReferenceValue;
    const resolved = previous instanceof FrequencyLiteral
      ? previous.canonicalize()
      : reference?.type === 'frequency' ? new FrequencyLiteral(reference.value * previous.value / 100, 'hz') : null;
    return resolved === null ? this : new FrequencyPercentageValue(resolved);
  }

  /** Serialize the current representation without resolving it. */
  serialize(): string {
    return this.repr.serialize();
  }

  /** Add compatible literals directly, retaining other combinations as math. */
  add(other: FrequencyPercentageValue, context: MathContext = {}): FrequencyPercentageValue {
    if (this.repr instanceof PercentageLiteral && other.repr instanceof PercentageLiteral) {
      return new FrequencyPercentageValue(this.repr.add(other.repr));
    }
    if (this.repr instanceof FrequencyLiteral && other.repr instanceof FrequencyLiteral && this.repr.unit === other.repr.unit) {
      return new FrequencyPercentageValue(this.repr.add(other.repr));
    }
    const mathContext = frequencyPercentageMathContext(context);
    return new FrequencyPercentageValue(
      this.#asMathValue(mathContext).add(other.#asMathValue(mathContext), mathContext),
    );
  }

  /** Interpolate compatible literals directly, retaining other combinations as math. */
  interpolate(other: FrequencyPercentageValue, progress: number, context: MathContext = {}): FrequencyPercentageValue {
    if (this.repr instanceof PercentageLiteral && other.repr instanceof PercentageLiteral) {
      return new FrequencyPercentageValue(this.repr.interpolate(other.repr, progress));
    }
    if (this.repr instanceof FrequencyLiteral && other.repr instanceof FrequencyLiteral && this.repr.unit === other.repr.unit) {
      return new FrequencyPercentageValue(this.repr.interpolate(other.repr, progress));
    }
    const mathContext = frequencyPercentageMathContext(context);
    return new FrequencyPercentageValue(
      this.#asMathValue(mathContext).interpolate(other.#asMathValue(mathContext), progress, mathContext),
    );
  }

  /** Accumulation of frequency-percentages is addition. */
  accumulate(other: FrequencyPercentageValue, context: MathContext = {}): FrequencyPercentageValue {
    return this.add(other, context);
  }

  #asMathValue(context: MathContext): MathValue<'frequency-percentage'> {
    return this.repr instanceof MathValue
      ? this.repr : MathValue.fromLiteral(this.repr, 'frequency-percentage', context);
  }
}

/** Literal or calculation accepted by this numeric grammar. */
type FrequencyPercentage = FrequencyPercentageLiteral | MathValue<'frequency-percentage'>;

function frequencyPercentageMathContext(context: MathContext): MathContext {
  return { ...context, percentHint: 'frequency' };
}

const frequencyPercentageConsumer = FrequencyPercentageValue.createConsumer();
const frequencyPercentageGrammar = withTrivia(frequencyPercentageConsumer);
