import { createNumericRange } from '../../infra/range';

import {
  one, oneOf, withTrivia, parseAsComponentGrammar,
  type ComponentValue, type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import { ValueStage } from '../value-processing/index';
import {
  TimeLiteral, PercentageLiteral, createTimePercentageConsumer,
  type TimePercentageLiteral, type TimePercentageConsumerOptions,
} from './numeric-literal/index';

import type { Value } from './value';
import { MathValue, type MathContext } from './math-value';

/** A <time-percentage> literal or calculation with its own lifecycle operations. */
// https://drafts.csswg.org/css-values-4/#typedef-time-percentage
export class TimePercentageValue<R extends TimePercentage = TimePercentage> implements Value<MathContext> {
  /** The literal or math value at the current lifecycle stage. */
  repr: R;

  constructor(value: R) {
    this.repr = value;
  }

  /** Parse one complete <time-percentage>. */
  static parse(input: ParserInput, context: MathContext): TimePercentageValue | null {
    return parseAsComponentGrammar(input, timePercentageGrammar, context);
  }

  /** Consume one <time-percentage> using the default literal limits. */
  static consume(this: void, c: TokenCursor<ComponentValue, MathContext>): TryConsumerResult<TimePercentageValue> {
    return timePercentageConsumer(c);
  }

  /** Apply literal limits and the corresponding calculation range to this grammar. */
  static createConsumer(options: TimePercentageConsumerOptions = {}): TryConsumer<TimePercentageValue, MathContext> {
    const literalConsumer = createTimePercentageConsumer(options);

    return oneOf([
      one(literalConsumer),
      one(MathValue.createConsumer({
        expectedType: 'time-percentage',
        percentHint: 'time',
        range: createNumericRange(options.min, options.max),
      })),
    ], ([parsed]) => new TimePercentageValue(parsed));
  }

  /** Resolve with the current context, preserving identity when the representation is unchanged. */
  resolve(stage: ValueStage, context: MathContext = {}): TimePercentageValue {
    const previous = this.repr;
    if (previous instanceof MathValue) {
      const resolved = previous.resolve(stage, timePercentageMathContext(context));
      return resolved === previous ? this : new TimePercentageValue(resolved);
    }

    if (stage < ValueStage.Computed || (previous.type === 'time' && previous.unit === 's')) return this;

    const reference = context.percentageReferenceValue;
    const resolved = previous instanceof TimeLiteral
      ? previous.canonicalize()
      : reference?.type === 'time' ? new TimeLiteral(reference.value * previous.value / 100, 's') : null;
    return resolved === null ? this : new TimePercentageValue(resolved);
  }

  /** Serialize the current representation without resolving it. */
  serialize(): string {
    return this.repr.serialize();
  }

  /** Add compatible literals directly, retaining other combinations as math. */
  add(other: TimePercentageValue, context: MathContext = {}): TimePercentageValue {
    if (this.repr instanceof PercentageLiteral && other.repr instanceof PercentageLiteral) {
      return new TimePercentageValue(this.repr.add(other.repr));
    }
    if (this.repr instanceof TimeLiteral && other.repr instanceof TimeLiteral && this.repr.unit === other.repr.unit) {
      return new TimePercentageValue(this.repr.add(other.repr));
    }
    const mathContext = timePercentageMathContext(context);
    return new TimePercentageValue(
      this.#asMathValue(mathContext).add(other.#asMathValue(mathContext), mathContext),
    );
  }

  /** Interpolate compatible literals directly, retaining other combinations as math. */
  interpolate(other: TimePercentageValue, progress: number, context: MathContext = {}): TimePercentageValue {
    if (this.repr instanceof PercentageLiteral && other.repr instanceof PercentageLiteral) {
      return new TimePercentageValue(this.repr.interpolate(other.repr, progress));
    }
    if (this.repr instanceof TimeLiteral && other.repr instanceof TimeLiteral && this.repr.unit === other.repr.unit) {
      return new TimePercentageValue(this.repr.interpolate(other.repr, progress));
    }
    const mathContext = timePercentageMathContext(context);
    return new TimePercentageValue(
      this.#asMathValue(mathContext).interpolate(other.#asMathValue(mathContext), progress, mathContext),
    );
  }

  /** Accumulation is addition. */
  accumulate(other: TimePercentageValue, context: MathContext = {}): TimePercentageValue {
    return this.add(other, context);
  }

  #asMathValue(context: MathContext): MathValue<'time-percentage'> {
    return this.repr instanceof MathValue
      ? this.repr : MathValue.fromLiteral(this.repr, 'time-percentage', context);
  }
}

/** Literal or calculation accepted by this numeric grammar. */
type TimePercentage = TimePercentageLiteral | MathValue<'time-percentage'>;

// In this grammar, percentages participate in calculations as times.
function timePercentageMathContext(
  context: MathContext,
): MathContext {
  return {
    ...context,
    percentHint: 'time',
  };
}

const timePercentageConsumer = TimePercentageValue.createConsumer();
const timePercentageGrammar = withTrivia(timePercentageConsumer);
