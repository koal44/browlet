import {
  one, oneOf, withTrivia, parseAsComponentGrammar,
  type ComponentValue, type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';
import { ResolutionLiteral, type ResolutionConsumerOptions } from './numeric-literal/index';

import type { Value } from './value';
import { MathValue, type MathContext } from './math-value';

/** A <resolution> literal or calculation with its own lifecycle operations. */
// https://drafts.csswg.org/css-values-4/#resolution-value
export class ResolutionValue<R extends Resolution = Resolution> implements Value<MathContext> {
  /** The literal or math value at the current lifecycle stage. */
  repr: R;

  constructor(value: R) {
    this.repr = value;
  }

  /** Parse one complete <resolution>. */
  static parse(input: ParserInput, context: MathContext): ResolutionValue | null {
    return parseAsComponentGrammar(input, resolutionGrammar, context);
  }

  /** Consume one <resolution> using the default literal limits. */
  static consume(this: void, c: TokenCursor<ComponentValue, MathContext>): TryConsumerResult<ResolutionValue> {
    return resolutionConsumer(c);
  }

  /** Apply literal limits and the corresponding calculation range to this grammar. */
  static createConsumer(options: ResolutionConsumerOptions = {}): TryConsumer<ResolutionValue, MathContext> {
    const literalConsumer = ResolutionLiteral.createConsumer(options);

    return oneOf([
      one(literalConsumer),
      one(MathValue.createConsumer({
        expectedType: 'resolution',
        range: [Math.max(0, options.min ?? 0), options.max ?? Infinity],
      })),
    ], ([parsed]) => new ResolutionValue(parsed));
  }

  /** Resolve with the current context, preserving identity when the representation is unchanged. */
  resolve(stage: ValueStage, context: MathContext): ResolutionValue {
    const previous = this.repr;
    const resolved = previous.resolve(stage, context);
    return resolved === previous ? this : new ResolutionValue(resolved);
  }

  /** Serialize the current representation without resolving it. */
  serialize(): string {
    return this.repr.serialize();
  }

  /** Add compatible literals directly, retaining other combinations as math. */
  add(other: ResolutionValue, context: MathContext): ResolutionValue {
    if (this.repr instanceof ResolutionLiteral && other.repr instanceof ResolutionLiteral && this.repr.unit === other.repr.unit) {
      return new ResolutionValue(this.repr.add(other.repr));
    }
    return new ResolutionValue(
      this.#asMathValue(context).add(other.#asMathValue(context), context),
    );
  }

  /** Interpolate compatible literals directly, retaining other combinations as math. */
  interpolate(other: ResolutionValue, progress: number, context: MathContext): ResolutionValue {
    if (this.repr instanceof ResolutionLiteral && other.repr instanceof ResolutionLiteral && this.repr.unit === other.repr.unit) {
      return new ResolutionValue(this.repr.interpolate(other.repr, progress));
    }
    return new ResolutionValue(
      this.#asMathValue(context).interpolate(other.#asMathValue(context), progress, context),
    );
  }

  /** Accumulation is addition. */
  accumulate(other: ResolutionValue, context: MathContext): ResolutionValue {
    return this.add(other, context);
  }

  #asMathValue(context: MathContext): MathValue<'resolution'> {
    return this.repr instanceof MathValue
      ? this.repr : MathValue.fromLiteral(this.repr, 'resolution', context);
  }
}

/** Literal or calculation accepted by this numeric grammar. */
type Resolution = ResolutionLiteral | MathValue<'resolution'>;

const resolutionConsumer = ResolutionValue.createConsumer();
const resolutionGrammar = withTrivia(resolutionConsumer);
