import { createNumericRange } from '../../infra/range';

import {
  one, oneOf, withTrivia, parseAsComponentGrammar,
  type ComponentValue, type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';
import { NumberLiteral, type NumberConsumerOptions } from './numeric-literal/index';

import type { Value } from './value';
import { MathValue, type MathContext } from './math-value';

/** A <number> literal or calculation with its own lifecycle operations. */
// https://drafts.csswg.org/css-values-4/#numbers
export class NumberValue<R extends NumberRepresentation = NumberRepresentation> implements Value<MathContext> {
  /** The literal or math value at the current lifecycle stage. */
  repr: R;

  constructor(value: R) {
    this.repr = value;
  }

  /** Parse one complete <number>. */
  static parse(input: ParserInput, context: MathContext): NumberValue | null {
    return parseAsComponentGrammar(input, numberGrammar, context);
  }

  /** Consume one <number> using the default literal limits. */
  static consume(this: void, c: TokenCursor<ComponentValue, MathContext>): TryConsumerResult<NumberValue> {
    return numberConsumer(c);
  }

  /** Apply literal limits and the corresponding calculation range to this grammar. */
  static createConsumer(options: NumberConsumerOptions = {}): TryConsumer<NumberValue, MathContext> {
    const literalConsumer = NumberLiteral.createConsumer(options);

    return oneOf([
      one(literalConsumer),
      one(MathValue.createConsumer({
        expectedType: 'number',
        range: createNumericRange(options.min, options.max),
      })),
    ], ([parsed]) => new NumberValue(parsed));
  }

  /** Resolve with the current context, preserving identity when the representation is unchanged. */
  resolve(stage: ValueStage, context: MathContext): NumberValue {
    const previous = this.repr;
    if (previous instanceof MathValue) {
      const resolved = previous.resolve(stage, context);
      return resolved === previous ? this : new NumberValue(resolved);
    }
    return this;
  }

  /** Serialize the current representation without resolving it. */
  serialize(): string {
    return this.repr.serialize();
  }

  /** Add compatible literals directly, retaining other combinations as math. */
  add(other: NumberValue, context: MathContext): NumberValue {
    if (!(this.repr instanceof MathValue) && !(other.repr instanceof MathValue)) {
      return new NumberValue(this.repr.add(other.repr));
    }
    return new NumberValue(
      this.#asMathValue(context).add(other.#asMathValue(context), context),
    );
  }

  /** Interpolate compatible literals directly, retaining other combinations as math. */
  interpolate(other: NumberValue, progress: number, context: MathContext): NumberValue {
    if (!(this.repr instanceof MathValue) && !(other.repr instanceof MathValue)) {
      return new NumberValue(this.repr.interpolate(other.repr, progress));
    }
    return new NumberValue(
      this.#asMathValue(context).interpolate(other.#asMathValue(context), progress, context),
    );
  }

  /** Accumulation of numbers is addition. */
  accumulate(other: NumberValue, context: MathContext): NumberValue {
    return this.add(other, context);
  }

  #asMathValue(context: MathContext): MathValue<'number'> {
    return this.repr instanceof MathValue
      ? this.repr : MathValue.fromLiteral(this.repr, 'number', context);
  }
}

/** Literal or calculation accepted by this numeric grammar. */
type NumberRepresentation = NumberLiteral | MathValue<'number'>;

const numberConsumer = NumberValue.createConsumer();
const numberGrammar = withTrivia(numberConsumer);
