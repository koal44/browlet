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
export class AngleValue<Representation extends Angle = Angle> implements Value<MathContext> {
  /** The literal or math value at the current lifecycle stage. */
  value: Representation;

  constructor(value: Representation) {
    this.value = value;
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
  resolve(stage: ValueStage, context: MathContext = {}): AngleValue {
    const resolved = this.value.resolve(stage, context);
    const value = resolved instanceof MathValue && !(resolved.value instanceof MathExpression)
      ? resolved.value : resolved;
    return value === this.value ? this : new AngleValue(value);
  }

  /** Serialize the current representation without resolving it. */
  serialize(): string {
    return this.value.serialize();
  }

  /** Add compatible literals directly, retaining other combinations as math. */
  add(other: AngleValue, context: MathContext = {}): AngleValue {
    if (this.value instanceof AngleLiteral && other.value instanceof AngleLiteral && this.value.unit === other.value.unit) {
      return new AngleValue(this.value.add(other.value));
    }
    return new AngleValue(
      this.#asMathValue(context).add(other.#asMathValue(context), context),
    );
  }

  /** Interpolate compatible literals directly, retaining other combinations as math. */
  interpolate(other: AngleValue, progress: number, context: MathContext = {}): AngleValue {
    if (this.value instanceof AngleLiteral && other.value instanceof AngleLiteral && this.value.unit === other.value.unit) {
      return new AngleValue(this.value.interpolate(other.value, progress));
    }
    return new AngleValue(
      this.#asMathValue(context).interpolate(other.#asMathValue(context), progress, context),
    );
  }

  /** Accumulation of angles is addition. */
  accumulate(other: AngleValue, context: MathContext = {}): AngleValue {
    return this.add(other, context);
  }

  #asMathValue(context: MathContext): MathValue<'angle'> {
    return this.value instanceof MathValue
      ? this.value : MathValue.fromLiteral(this.value, 'angle', context);
  }
}

/** Literal or calculation accepted by this numeric grammar. */
type Angle = AngleLiteral | MathValue<'angle'>;

const angleConsumer = AngleValue.createConsumer();
const angleGrammar = withTrivia(angleConsumer);
