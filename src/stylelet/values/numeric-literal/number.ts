import {
  consumeNumberToken, adaptConsumer, withTrivia, createComponentParser,
  type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../../syntax/index';
import type { ValueStage } from '../../value-processing/index';
import type { Value } from '../value';

import { serializeCssInteger } from './integer';

/** A literal <number> with its numeric magnitude and arithmetic operations. */
// https://drafts.csswg.org/css-values-4/#numbers
export class NumberLiteral implements Value {
  /** The CSS numeric category. */
  type = 'number' as const;
  /** The magnitude expressed by the literal. */
  value: number;

  constructor(value: number) {
    this.value = value;
  }

  /** Parse a complete literal. */
  static parse(input: ParserInput, context: unknown): NumberLiteral | null {
    return numberParser(input, context);
  }

  /** Consume one literal with the default range. */
  static consume(this: void, c: TokenCursor): TryConsumerResult<NumberLiteral> {
    return numberConsumer(c);
  }

  /** Configure the inclusive literal bounds once for a consuming grammar. */
  static createConsumer(options: NumberConsumerOptions = {}): TryConsumer<NumberLiteral> {
    const min = options.min ?? -Infinity;
    const max = options.max ?? Infinity;

    return adaptConsumer(consumeNumberToken, (token) =>
      token.value < min || token.value > max ? null : new NumberLiteral(token.value),
    );
  }

  /** This literal has no contextual conversion of its own. */
  resolve(_stage: ValueStage, _context: unknown): NumberLiteral {
    return this;
  }

  /** Serialize the retained magnitude without resolving it. */
  serialize(): string {
    return serializeCssNumber(this.value);
  }

  /** Add two literals of this numeric category. */
  // https://drafts.csswg.org/css-values-4/#combine-number
  add(other: NumberLiteral): NumberLiteral {
    return new NumberLiteral(this.value + other.value);
  }

  /** Interpolate the magnitudes. */
  interpolate(other: NumberLiteral, progress: number): NumberLiteral {
    return new NumberLiteral((1 - progress) * this.value + progress * other.value);
  }

  /** Accumulation of these literals is addition. */
  accumulate(other: NumberLiteral): NumberLiteral {
    return this.add(other);
  }
}

export type NumberConsumerOptions = {
  min?: number;
  max?: number;
};

// CSSOM leaves decimal tie-breaking undefined. Exact ties use CSS rounding toward positive infinity.
// https://drafts.csswg.org/cssom/#serialize-a-css-component-value
export function serializeCssNumber(value: number): string {
  if (Number.isInteger(value)) {
    return serializeCssInteger(value);
  }

  const rounded = Math.round(value * 1_000_000) / 1_000_000;

  return Object.is(rounded, -0) ? '0' : String(rounded);
}

const numberConsumer = NumberLiteral.createConsumer();
const numberParser = createComponentParser(withTrivia(numberConsumer));
