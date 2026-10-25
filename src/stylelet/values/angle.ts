import { createNumericRange } from '../../infra/range';

import {
  one, oneOf, withTrivia, parseAsComponentGrammar,
  type ComponentValue, type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';
import { AngleLiteral, type AngleConsumerOptions } from './numeric-literal/index';

import type { Value } from './value';
import { MathValue, MathExpression, type MathContext } from './math-value';

/** An <angle> literal or calculation with its own lifecycle operations. */
// https://drafts.csswg.org/css-values-4/#angles
export class AngleValue<R extends Angle = Angle> implements Value<MathContext> {
  /** The literal or math value at the current lifecycle stage. */
  repr: R;

  constructor(value: R) {
    this.repr = value;
  }

  /** Parse one complete <angle>. */
  static parse(input: ParserInput, context: MathContext): AngleValue | null {
    return parseAsComponentGrammar(input, angleGrammar, context);
  }

  /** Consume one <angle> using the default literal limits. */
  static consume(this: void, c: TokenCursor<ComponentValue, MathContext>): TryConsumerResult<AngleValue> {
    return angleConsumer(c);
  }

  /** Apply literal limits and the corresponding calculation range to this grammar. */
  static createConsumer(options: AngleConsumerOptions = {}): TryConsumer<AngleValue, MathContext> {
    // <angle> is a dimension in deg, grad, rad, or turn; math functions can substitute for it.
    const literalConsumer = AngleLiteral.createConsumer(options);

    return oneOf([
      one(literalConsumer),
      one(MathValue.createConsumer({
        expectedType: 'angle',
        range: createNumericRange(options.min, options.max),
      })),
    ], ([parsed]) => new AngleValue(parsed));
  }

  /** Resolve with the current context, preserving identity when the representation is unchanged. */
  resolve(stage: ValueStage, context: MathContext): AngleValue {
    const resolved = this.repr.resolve(stage, context);
    const value = resolved instanceof MathValue && !(resolved.repr instanceof MathExpression)
      ? resolved.repr : resolved;
    return value === this.repr ? this : new AngleValue(value);
  }

  /** Serialize the current representation without resolving it. */
  serialize(): string {
    return this.repr.serialize();
  }

  /** Add compatible literals directly, retaining other combinations as math. */
  add(other: AngleValue, context: MathContext): AngleValue {
    if (this.repr instanceof AngleLiteral && other.repr instanceof AngleLiteral && this.repr.unit === other.repr.unit) {
      return new AngleValue(this.repr.add(other.repr));
    }
    return new AngleValue(
      this.#asMathValue(context).add(other.#asMathValue(context), context),
    );
  }

  /** Interpolate compatible literals directly, retaining other combinations as math. */
  interpolate(other: AngleValue, progress: number, context: MathContext): AngleValue {
    if (this.repr instanceof AngleLiteral && other.repr instanceof AngleLiteral && this.repr.unit === other.repr.unit) {
      return new AngleValue(this.repr.interpolate(other.repr, progress));
    }
    return new AngleValue(
      this.#asMathValue(context).interpolate(other.#asMathValue(context), progress, context),
    );
  }

  /** Accumulation of angles is addition. */
  accumulate(other: AngleValue, context: MathContext): AngleValue {
    return this.add(other, context);
  }

  #asMathValue(context: MathContext): MathValue<'angle'> {
    return this.repr instanceof MathValue
      ? this.repr : MathValue.fromLiteral(this.repr, 'angle', context);
  }
}

/** Literal or calculation accepted by this numeric grammar. */
type Angle = AngleLiteral | MathValue<'angle'>;

const angleConsumer = AngleValue.createConsumer();
const angleGrammar = withTrivia(angleConsumer);
