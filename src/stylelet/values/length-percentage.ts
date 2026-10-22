import { createNumericRange } from '../../infra/range';

import {
  one, oneOf, withTrivia, parseAsComponentGrammar,
  type ComponentValue, type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import { ValueStage } from '../value-processing/index';
import {
  LengthLiteral, PercentageLiteral, createLengthPercentageConsumer,
  type LengthPercentageLiteral, type LengthPercentageConsumerOptions,
} from './numeric-literal/index';

import type { Value } from './value';
import { MathValue, MathExpression, type MathContext } from './math-value';

/** A <length-percentage> literal or calculation with its own lifecycle operations. */
// https://drafts.csswg.org/css-values-4/#typedef-length-percentage
export class LengthPercentageValue<Representation extends LengthPercentage = LengthPercentage> implements Value<MathContext> {
  /** The literal or math value at the current lifecycle stage. */
  value: Representation;

  constructor(value: Representation) {
    this.value = value;
  }

  /** Parse one complete <length-percentage>. */
  static parse(input: ParserInput, context: MathContext): LengthPercentageValue | null {
    return parseAsComponentGrammar(input, lengthPercentageGrammar, context);
  }

  /** Consume one <length-percentage> using the default literal limits. */
  static consume(this: void, c: TokenCursor<ComponentValue, MathContext>): TryConsumerResult<LengthPercentageValue> {
    return lengthPercentageConsumer(c);
  }

  /** Apply literal limits and the corresponding calculation range to this grammar. */
  static createConsumer(options: LengthPercentageConsumerOptions = {}): TryConsumer<LengthPercentageValue, MathContext> {
    // <length-percentage> = <length> | <percentage>
    // Percentages resolve to lengths, including within math functions.
    const literalConsumer = createLengthPercentageConsumer(options);

    return oneOf([
      one(literalConsumer),
      one(MathValue.createConsumer({
        expectedType: 'length-percentage',
        percentHint: 'length',
        range: createNumericRange(options.min, options.max),
      })),
    ], ([parsed]) => new LengthPercentageValue(parsed));
  }

  /** Resolve with the current context, preserving identity when the representation is unchanged. */
  resolve(stage: ValueStage, context: MathContext = {}): LengthPercentageValue {
    const previous = this.value;
    if (previous instanceof MathValue) {
      const resolved = previous.resolve(stage, lengthPercentageMathContext(context));
      const value = resolved.value instanceof MathExpression ? resolved : resolved.value;
      return value === previous ? this : new LengthPercentageValue(value);
    }

    if (stage < ValueStage.Computed || (previous.type === 'length' && previous.unit === 'px')) return this;

    const reference = context.percentageReferenceValue;
    const resolved = previous instanceof LengthLiteral
      ? previous.tryResolve(context.length)
      : reference?.type === 'length' ? new LengthLiteral(reference.value * previous.value / 100, 'px') : null;
    return resolved === null ? this : new LengthPercentageValue(resolved);
  }

  /** Serialize the current representation without resolving it. */
  serialize(): string {
    return this.value.serialize();
  }

  /** Add compatible literals directly, retaining other combinations as math. */
  add(other: LengthPercentageValue, context: MathContext = {}): LengthPercentageValue {
    if (this.value instanceof PercentageLiteral && other.value instanceof PercentageLiteral) {
      return new LengthPercentageValue(this.value.add(other.value));
    }
    if (this.value instanceof LengthLiteral && other.value instanceof LengthLiteral && this.value.unit === other.value.unit) {
      return new LengthPercentageValue(this.value.add(other.value));
    }
    const mathContext = lengthPercentageMathContext(context);
    return new LengthPercentageValue(
      this.#asMathValue(mathContext).add(other.#asMathValue(mathContext), mathContext),
    );
  }

  /** Interpolate compatible literals directly, retaining other combinations as math. */
  interpolate(other: LengthPercentageValue, progress: number, context: MathContext = {}): LengthPercentageValue {
    if (this.value instanceof PercentageLiteral && other.value instanceof PercentageLiteral) {
      return new LengthPercentageValue(this.value.interpolate(other.value, progress));
    }
    if (this.value instanceof LengthLiteral && other.value instanceof LengthLiteral && this.value.unit === other.value.unit) {
      return new LengthPercentageValue(this.value.interpolate(other.value, progress));
    }
    const mathContext = lengthPercentageMathContext(context);
    return new LengthPercentageValue(
      this.#asMathValue(mathContext).interpolate(other.#asMathValue(mathContext), progress, mathContext),
    );
  }

  /** Accumulation of length-percentages is addition. */
  accumulate(other: LengthPercentageValue, context: MathContext = {}): LengthPercentageValue {
    return this.add(other, context);
  }

  #asMathValue(context: MathContext): MathValue<'length-percentage'> {
    return this.value instanceof MathValue
      ? this.value : MathValue.fromLiteral(this.value, 'length-percentage', context);
  }
}

/** Literal or calculation accepted by this numeric grammar. */
type LengthPercentage = LengthPercentageLiteral | MathValue<'length-percentage'>;

function lengthPercentageMathContext(context: MathContext): MathContext {
  return { ...context, percentHint: 'length' };
}

const lengthPercentageConsumer = LengthPercentageValue.createConsumer();
const lengthPercentageGrammar = withTrivia(lengthPercentageConsumer);
