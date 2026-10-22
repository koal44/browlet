import { createNumericRange } from '../../infra/range';

import {
  one, oneOf, withTrivia, parseAsComponentGrammar,
  type ComponentValue, type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';
import { TimeLiteral, type TimeConsumerOptions } from './numeric-literal/index';

import type { Value } from './value';
import { MathValue, type MathContext } from './math-value';

/** A <time> literal or calculation with its own lifecycle operations. */
// https://drafts.csswg.org/css-values-4/#time
export class TimeValue<Representation extends Time = Time> implements Value<MathContext> {
  /** The literal or math value at the current lifecycle stage. */
  value: Representation;

  constructor(value: Representation) {
    this.value = value;
  }

  /** Parse one complete <time>. */
  static parse(input: ParserInput, context: MathContext): TimeValue | null {
    return parseAsComponentGrammar(input, timeGrammar, context);
  }

  /** Consume one <time> using the default literal limits. */
  static consume(this: void, c: TokenCursor<ComponentValue, MathContext>): TryConsumerResult<TimeValue> {
    return timeConsumer(c);
  }

  /** Apply literal limits and the corresponding calculation range to this grammar. */
  static createConsumer(options: TimeConsumerOptions = {}): TryConsumer<TimeValue, MathContext> {
    const literalConsumer = TimeLiteral.createConsumer(options);

    return oneOf([
      one(literalConsumer),
      one(MathValue.createConsumer({
        expectedType: 'time',
        range: createNumericRange(options.min, options.max),
      })),
    ], ([parsed]) => new TimeValue(parsed));
  }

  /** Resolve with the current context, preserving identity when the representation is unchanged. */
  resolve(stage: ValueStage, context: MathContext = {}): TimeValue {
    const previous = this.value;
    const resolved = previous.resolve(stage, context);
    return resolved === previous ? this : new TimeValue(resolved);
  }

  /** Serialize the current representation without resolving it. */
  serialize(): string {
    return this.value.serialize();
  }

  /** Add compatible literals directly, retaining other combinations as math. */
  add(other: TimeValue, context: MathContext = {}): TimeValue {
    if (this.value instanceof TimeLiteral && other.value instanceof TimeLiteral && this.value.unit === other.value.unit) {
      return new TimeValue(this.value.add(other.value));
    }
    return new TimeValue(
      this.asMathValue(context).add(other.asMathValue(context), context),
    );
  }

  /** Interpolate compatible literals directly, retaining other combinations as math. */
  interpolate(other: TimeValue, progress: number, context: MathContext = {}): TimeValue {
    if (this.value instanceof TimeLiteral && other.value instanceof TimeLiteral && this.value.unit === other.value.unit) {
      return new TimeValue(this.value.interpolate(other.value, progress));
    }
    return new TimeValue(
      this.asMathValue(context).interpolate(other.asMathValue(context), progress, context),
    );
  }

  /** Accumulation is addition. */
  accumulate(other: TimeValue, context: MathContext = {}): TimeValue {
    return this.add(other, context);
  }

  private asMathValue(context: MathContext): MathValue<'time'> {
    return this.value instanceof MathValue
      ? this.value : MathValue.fromLiteral(this.value, 'time', context);
  }
}

/** Literal or calculation accepted by this numeric grammar. */
type Time = TimeLiteral | MathValue<'time'>;

const timeConsumer = TimeValue.createConsumer();
const timeGrammar = withTrivia(timeConsumer);
