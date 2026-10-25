import { createNumericRange } from '../../infra/range';

import {
  one, oneOf, withTrivia, parseAsComponentGrammar,
  type ComponentValue, type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import { ValueStage } from '../value-processing/index';
import { LengthLiteral, type LengthConsumerOptions } from './numeric-literal/index';

import type { Value } from './value';
import { MathValue, type MathContext } from './math-value';

/** A <length> literal or calculation with its own lifecycle operations. */
// https://drafts.csswg.org/css-values-4/#lengths
export class LengthValue<R extends Length = Length> implements Value<MathContext> {
  /** The literal or math value at the current lifecycle stage. */
  repr: R;

  constructor(value: R) {
    this.repr = value;
  }

  /** Parse one complete <length>. */
  static parse(input: ParserInput, context: MathContext): LengthValue | null {
    return parseAsComponentGrammar(input, lengthGrammar, context);
  }

  /** Consume one <length> using the default literal limits. */
  static consume(this: void, c: TokenCursor<ComponentValue, MathContext>): TryConsumerResult<LengthValue> {
    return lengthConsumer(c);
  }

  /** Apply literal limits and the corresponding calculation range to this grammar. */
  static createConsumer(options: LengthConsumerOptions = {}): TryConsumer<LengthValue, MathContext> {
    const literalConsumer = LengthLiteral.createConsumer(options);

    return oneOf([
      one(literalConsumer),
      one(MathValue.createConsumer({
        expectedType: 'length',
        range: createNumericRange(options.min, options.max),
      })),
    ], ([parsed]) => new LengthValue(parsed));
  }

  /** Resolve with the current context, preserving identity when the representation is unchanged. */
  resolve(stage: ValueStage, context: MathContext): LengthValue {
    const previous = this.repr;
    if (previous instanceof MathValue) {
      const resolved = previous.resolve(stage, context);
      return resolved === previous ? this : new LengthValue(resolved);
    }

    if (stage < ValueStage.Computed || previous.unit === 'px') return this;

    const resolved = previous.tryResolve(context.length);
    return resolved === null ? this : new LengthValue(resolved);
  }

  /** Serialize the current representation without resolving it. */
  serialize(): string {
    return this.repr.serialize();
  }

  /** Add compatible literals directly, retaining other combinations as math. */
  add(other: LengthValue, context: MathContext): LengthValue {
    if (!(this.repr instanceof MathValue) && !(other.repr instanceof MathValue) && this.repr.unit === other.repr.unit) {
      return new LengthValue(this.repr.add(other.repr));
    }
    return new LengthValue(
      this.#asMathValue(context).add(other.#asMathValue(context), context),
    );
  }

  /** Interpolate compatible literals directly, retaining other combinations as math. */
  interpolate(other: LengthValue, progress: number, context: MathContext): LengthValue {
    if (!(this.repr instanceof MathValue) && !(other.repr instanceof MathValue) && this.repr.unit === other.repr.unit) {
      return new LengthValue(this.repr.interpolate(other.repr, progress));
    }
    return new LengthValue(
      this.#asMathValue(context).interpolate(other.#asMathValue(context), progress, context),
    );
  }

  /** Accumulation of lengths is addition. */
  accumulate(other: LengthValue, context: MathContext): LengthValue {
    return this.add(other, context);
  }

  #asMathValue(context: MathContext): MathValue<'length'> {
    return this.repr instanceof MathValue
      ? this.repr : MathValue.fromLiteral(this.repr, 'length', context);
  }
}

const lengthConsumer = LengthValue.createConsumer();

const lengthGrammar = withTrivia(lengthConsumer);

/** Literal or calculation accepted by this numeric grammar. */
type Length = LengthLiteral | MathValue<'length'>;
