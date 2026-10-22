import {
  consumeIntegerToken, adaptConsumer, withTrivia, createComponentParser,
  type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../../syntax/index';
import type { ValueStage } from '../../value-processing/index';
import type { Value } from '../value';

/** A literal <integer> with its numeric magnitude and arithmetic operations. */
// https://drafts.csswg.org/css-values-4/#integers
export class IntegerLiteral implements Value {
  /** The CSS numeric category. */
  type = 'integer' as const;
  /** The magnitude expressed by the literal. */
  value: number;

  constructor(value: number) {
    this.value = value;
  }

  /** Parse a complete literal. */
  static parse(input: ParserInput, context: unknown): IntegerLiteral | null {
    return integerParser(input, context);
  }

  /** Consume one literal with the default range. */
  static consume(this: void, c: TokenCursor): TryConsumerResult<IntegerLiteral> {
    return integerConsumer(c);
  }

  /** Configure the inclusive literal bounds once for a consuming grammar. */
  static createConsumer(options: IntegerConsumerOptions = {}): TryConsumer<IntegerLiteral> {
    const min = options.min ?? -Infinity;
    const max = options.max ?? Infinity;

    return adaptConsumer(consumeIntegerToken, (token) =>
      token.value < min || token.value > max ? null : new IntegerLiteral(token.value),
    );
  }

  /** This literal has no contextual conversion of its own. */
  resolve(_stage: ValueStage, _context: unknown): IntegerLiteral {
    return this;
  }

  /** Serialize the retained magnitude without resolving it. */
  serialize(): string {
    return serializeCssInteger(this.value);
  }

  /** Add two literals of this numeric category. */
  // https://drafts.csswg.org/css-values-4/#combine-integer
  add(other: IntegerLiteral): IntegerLiteral {
    return integerResult(this.value + other.value);
  }

  /** Interpolate the magnitudes, rounding ties toward positive infinity. */
  interpolate(other: IntegerLiteral, progress: number): IntegerLiteral {
    return integerResult(Math.round((1 - progress) * this.value + progress * other.value));
  }

  /** Accumulation of these literals is addition. */
  accumulate(other: IntegerLiteral): IntegerLiteral {
    return this.add(other);
  }
}

export type IntegerConsumerOptions = {
  min?: number;
  max?: number;
};

export function serializeCssInteger(value: number): string {
  if (Number.isSafeInteger(value)) {
    return Object.is(value, -0) ? '0' : String(value);
  }

  return BigInt(value).toString();
}

function integerResult(value: number): IntegerLiteral {
  return new IntegerLiteral(value === 0 ? 0 : value);
}

const integerConsumer = IntegerLiteral.createConsumer();
const integerParser = createComponentParser(withTrivia(integerConsumer));
