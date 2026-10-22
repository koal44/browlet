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
export class FrequencyPercentageValue<Representation extends FrequencyPercentage = FrequencyPercentage> implements Value<MathContext> {
  /** The literal or math value at the current lifecycle stage. */
  value: Representation;

  constructor(value: Representation) {
    this.value = value;
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
    const previous = this.value;
    if (previous instanceof MathValue) {
      const resolved = previous.resolve(stage, frequencyPercentageMathContext(context));
      const value = resolved.value instanceof MathExpression ? resolved : resolved.value;
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
    return this.value.serialize();
  }

  /** Add compatible literals directly, retaining other combinations as math. */
  add(other: FrequencyPercentageValue, context: MathContext = {}): FrequencyPercentageValue {
    if (this.value instanceof PercentageLiteral && other.value instanceof PercentageLiteral) {
      return new FrequencyPercentageValue(this.value.add(other.value));
    }
    if (this.value instanceof FrequencyLiteral && other.value instanceof FrequencyLiteral && this.value.unit === other.value.unit) {
      return new FrequencyPercentageValue(this.value.add(other.value));
    }
    const mathContext = frequencyPercentageMathContext(context);
    return new FrequencyPercentageValue(
      this.asMathValue(mathContext).add(other.asMathValue(mathContext), mathContext),
    );
  }

  /** Interpolate compatible literals directly, retaining other combinations as math. */
  interpolate(other: FrequencyPercentageValue, progress: number, context: MathContext = {}): FrequencyPercentageValue {
    if (this.value instanceof PercentageLiteral && other.value instanceof PercentageLiteral) {
      return new FrequencyPercentageValue(this.value.interpolate(other.value, progress));
    }
    if (this.value instanceof FrequencyLiteral && other.value instanceof FrequencyLiteral && this.value.unit === other.value.unit) {
      return new FrequencyPercentageValue(this.value.interpolate(other.value, progress));
    }
    const mathContext = frequencyPercentageMathContext(context);
    return new FrequencyPercentageValue(
      this.asMathValue(mathContext).interpolate(other.asMathValue(mathContext), progress, mathContext),
    );
  }

  /** Accumulation of frequency-percentages is addition. */
  accumulate(other: FrequencyPercentageValue, context: MathContext = {}): FrequencyPercentageValue {
    return this.add(other, context);
  }

  private asMathValue(context: MathContext): MathValue<'frequency-percentage'> {
    return this.value instanceof MathValue
      ? this.value : MathValue.fromLiteral(this.value, 'frequency-percentage', context);
  }
}

/** Literal or calculation accepted by this numeric grammar. */
type FrequencyPercentage = FrequencyPercentageLiteral | MathValue<'frequency-percentage'>;

function frequencyPercentageMathContext(context: MathContext): MathContext {
  return { ...context, percentHint: 'frequency' };
}

const frequencyPercentageConsumer = FrequencyPercentageValue.createConsumer();
const frequencyPercentageGrammar = withTrivia(frequencyPercentageConsumer);
