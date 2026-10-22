import { createNumericRange } from '../../infra/range';

import {
  one, oneOf, withTrivia, parseAsComponentGrammar,
  type ComponentValue, type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';
import { IntegerLiteral, type IntegerConsumerOptions } from './numeric-literal/index';

import type { Value } from './value';
import { MathValue, type MathContext } from './math-value';

/** A <integer> literal or calculation with its own lifecycle operations. */
// https://drafts.csswg.org/css-values-4/#integers
export class IntegerValue<Representation extends Integer = Integer> implements Value<MathContext> {
  /** The literal or math value at the current lifecycle stage. */
  value: Representation;

  constructor(value: Representation) {
    this.value = value;
  }

  /** Parse one complete <integer>. */
  static parse(input: ParserInput, context: MathContext): IntegerValue | null {
    return parseAsComponentGrammar(input, integerGrammar, context);
  }

  /** Consume one <integer> using the default literal limits. */
  static consume(this: void, c: TokenCursor<ComponentValue, MathContext>): TryConsumerResult<IntegerValue> {
    return integerConsumer(c);
  }

  /** Apply literal limits and the corresponding calculation range to this grammar. */
  static createConsumer(options: IntegerConsumerOptions = {}): TryConsumer<IntegerValue, MathContext> {
    const literalConsumer = IntegerLiteral.createConsumer(options);

    return oneOf([
      one(literalConsumer),
      one(MathValue.createConsumer({
        expectedType: 'integer',
        range: createNumericRange(options.min, options.max),
      })),
    ], ([parsed]) => new IntegerValue(parsed));
  }

  /** Resolve with the current context, preserving identity when the representation is unchanged. */
  resolve(stage: ValueStage, context: MathContext = {}): IntegerValue {
    const previous = this.value;
    if (previous instanceof MathValue) {
      const resolved = previous.resolve(stage, context);
      return resolved === previous ? this : new IntegerValue(resolved);
    }
    return this;
  }

  /** Serialize the current representation without resolving it. */
  serialize(): string {
    return this.value.serialize();
  }

  /** Add compatible literals directly, retaining other combinations as math. */
  add(other: IntegerValue, context: MathContext = {}): IntegerValue {
    if (!(this.value instanceof MathValue) && !(other.value instanceof MathValue)) {
      return new IntegerValue(this.value.add(other.value));
    }
    return new IntegerValue(
      this.asMathValue(context).add(other.asMathValue(context), context),
    );
  }

  /** Interpolate compatible literals directly, retaining other combinations as math. */
  interpolate(other: IntegerValue, progress: number, context: MathContext = {}): IntegerValue {
    if (!(this.value instanceof MathValue) && !(other.value instanceof MathValue)) {
      return new IntegerValue(this.value.interpolate(other.value, progress));
    }
    return new IntegerValue(
      this.asMathValue(context).interpolate(other.asMathValue(context), progress, context),
    );
  }

  /** Accumulation of integers is addition. */
  accumulate(other: IntegerValue, context: MathContext = {}): IntegerValue {
    return this.add(other, context);
  }

  private asMathValue(context: MathContext): MathValue<'integer'> {
    return this.value instanceof MathValue
      ? this.value : MathValue.fromLiteral(this.value, 'integer', context);
  }
}

/** Literal or calculation accepted by this numeric grammar. */
type Integer = IntegerLiteral | MathValue<'integer'>;

const integerConsumer = IntegerValue.createConsumer();
const integerGrammar = withTrivia(integerConsumer);
