import {
  consumePercentageToken, adaptConsumer, withTrivia, createComponentParser,
  type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../../syntax/index';
import type { ValueStage } from '../../value-processing/index';
import type { Value } from '../value';

import { serializeCssNumber } from './number';

/** A literal <percentage> with its numeric magnitude and arithmetic operations. */
// https://drafts.csswg.org/css-values-4/#percentages
export class PercentageLiteral implements Value {
  /** The CSS numeric category. */
  type = 'percentage' as const;
  /** The magnitude expressed by the literal. */
  value: number;

  constructor(value: number) {
    this.value = value;
  }

  /** Parse a complete literal. */
  static parse(input: ParserInput, context: unknown): PercentageLiteral | null {
    return percentageParser(input, context);
  }

  /** Consume one literal with the default range. */
  static consume(this: void, c: TokenCursor): TryConsumerResult<PercentageLiteral> {
    return percentageConsumer(c);
  }

  /** Configure the inclusive literal bounds once for a consuming grammar. */
  static createConsumer(options: PercentageConsumerOptions = {}): TryConsumer<PercentageLiteral> {
    const min = options.min ?? -Infinity;
    const max = options.max ?? Infinity;

    return adaptConsumer(consumePercentageToken, (token) =>
      token.value < min || token.value > max ? null : new PercentageLiteral(token.value),
    );
  }

  /** This literal has no contextual conversion of its own. */
  resolve(_stage: ValueStage, _context: unknown): PercentageLiteral {
    return this;
  }

  /** Serialize the retained magnitude without resolving it. */
  serialize(): string {
    return `${serializeCssNumber(this.value)}%`;
  }

  /** Add two literals of this numeric category. */
  // https://drafts.csswg.org/css-values-4/#combine-percentage
  add(other: PercentageLiteral): PercentageLiteral {
    return new PercentageLiteral(this.value + other.value);
  }

  /** Interpolate the magnitudes. */
  interpolate(other: PercentageLiteral, progress: number): PercentageLiteral {
    return new PercentageLiteral((1 - progress) * this.value + progress * other.value);
  }

  /** Accumulation of these literals is addition. */
  accumulate(other: PercentageLiteral): PercentageLiteral {
    return this.add(other);
  }
}

export type PercentageConsumerOptions = {
  min?: number;
  max?: number;
};

const percentageConsumer = PercentageLiteral.createConsumer();
const percentageParser = createComponentParser(withTrivia(percentageConsumer));
