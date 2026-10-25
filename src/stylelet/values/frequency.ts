import { createNumericRange } from '../../infra/range';

import {
  one, oneOf, withTrivia, parseAsComponentGrammar,
  type ComponentValue, type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';
import { FrequencyLiteral, type FrequencyConsumerOptions } from './numeric-literal/index';

import type { Value } from './value';
import { MathValue, MathExpression, type MathContext } from './math-value';

/** A <frequency> literal or calculation with its own lifecycle operations. */
// https://drafts.csswg.org/css-values-4/#frequency
export class FrequencyValue<R extends Frequency = Frequency> implements Value<MathContext> {
  /** The literal or math value at the current lifecycle stage. */
  repr: R;

  constructor(value: R) {
    this.repr = value;
  }

  /** Parse one complete <frequency>. */
  static parse(input: ParserInput, context: MathContext): FrequencyValue | null {
    return parseAsComponentGrammar(input, frequencyGrammar, context);
  }

  /** Consume one <frequency> using the default literal limits. */
  static consume(this: void, c: TokenCursor<ComponentValue, MathContext>): TryConsumerResult<FrequencyValue> {
    return frequencyConsumer(c);
  }

  /** Apply literal limits and the corresponding calculation range to this grammar. */
  static createConsumer(options: FrequencyConsumerOptions = {}): TryConsumer<FrequencyValue, MathContext> {
    // <frequency> is a dimension in Hz or kHz; math functions can substitute for it.
    const literalConsumer = FrequencyLiteral.createConsumer(options);

    return oneOf([
      one(literalConsumer),
      one(MathValue.createConsumer({
        expectedType: 'frequency',
        range: createNumericRange(options.min, options.max),
      })),
    ], ([parsed]) => new FrequencyValue(parsed));
  }

  /** Resolve with the current context, preserving identity when the representation is unchanged. */
  resolve(stage: ValueStage, context: MathContext): FrequencyValue {
    const resolved = this.repr.resolve(stage, context);
    const value = resolved instanceof MathValue && !(resolved.repr instanceof MathExpression)
      ? resolved.repr : resolved;
    return value === this.repr ? this : new FrequencyValue(value);
  }

  /** Serialize the current representation without resolving it. */
  serialize(): string {
    return this.repr.serialize();
  }

  /** Add compatible literals directly, retaining other combinations as math. */
  add(other: FrequencyValue, context: MathContext): FrequencyValue {
    if (this.repr instanceof FrequencyLiteral && other.repr instanceof FrequencyLiteral && this.repr.unit === other.repr.unit) {
      return new FrequencyValue(this.repr.add(other.repr));
    }
    return new FrequencyValue(
      this.#asMathValue(context).add(other.#asMathValue(context), context),
    );
  }

  /** Interpolate compatible literals directly, retaining other combinations as math. */
  interpolate(other: FrequencyValue, progress: number, context: MathContext): FrequencyValue {
    if (this.repr instanceof FrequencyLiteral && other.repr instanceof FrequencyLiteral && this.repr.unit === other.repr.unit) {
      return new FrequencyValue(this.repr.interpolate(other.repr, progress));
    }
    return new FrequencyValue(
      this.#asMathValue(context).interpolate(other.#asMathValue(context), progress, context),
    );
  }

  /** Accumulation of frequencies is addition. */
  accumulate(other: FrequencyValue, context: MathContext): FrequencyValue {
    return this.add(other, context);
  }

  #asMathValue(context: MathContext): MathValue<'frequency'> {
    return this.repr instanceof MathValue
      ? this.repr : MathValue.fromLiteral(this.repr, 'frequency', context);
  }
}

/** Literal or calculation accepted by this numeric grammar. */
type Frequency = FrequencyLiteral | MathValue<'frequency'>;

const frequencyConsumer = FrequencyValue.createConsumer();
const frequencyGrammar = withTrivia(frequencyConsumer);
