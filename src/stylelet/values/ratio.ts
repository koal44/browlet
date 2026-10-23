import { InternalError } from '../../infra/internal-error';

import {
  consumeSlashDelim, adaptConsumer, one, oneOf, opt, sequenceOf, withTrivia, createComponentParser,
  type ComponentValue, type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';
import { NumberLiteral, serializeCssNumber } from './numeric-literal/index';

import type { Value } from './value';
import { NumberValue } from './number';
import type { MathContext } from './math-value';

/** A ratio retaining both components, including degenerate ratios. */
// https://drafts.csswg.org/css-values-4/#ratios
export class RatioValue implements Value {
  /** The numerator and denominator as specified. */
  repr: Ratio;

  constructor(value: Ratio) {
    this.repr = value;
  }

  /** Parse a complete <ratio>. */
  static parse(input: ParserInput, context: unknown): RatioValue | null {
    return ratioParser(input, context);
  }

  /** Consume a nonnegative numerator and optional nonnegative denominator. */
  static consume(this: void, c: TokenCursor): TryConsumerResult<RatioValue> {
    return ratioConsumer(c);
  }

  /** A ratio needs no contextual conversion. */
  resolve(_stage: ValueStage, _context: unknown): RatioValue {
    return this;
  }

  /** Serialize both retained components without reducing the ratio. */
  serialize(): string {
    const { numerator, denominator } = this.repr;
    return `${serializeCssNumber(numerator)} / ${serializeCssNumber(denominator)}`;
  }

  /** Whether either component is zero or infinite. */
  isDegenerate(): boolean {
    const { numerator, denominator } = this.repr;
    return isDegenerateRatioComponent(numerator) || isDegenerateRatioComponent(denominator);
  }

  /** Interpolate nondegenerate ratios in logarithmic space. */
  // https://drafts.csswg.org/css-values-4/#combine-ratio
  interpolate(other: RatioValue, progress: number): RatioValue {
    if (this.isDegenerate() || other.isDegenerate()) {
      throw new InternalError('Degenerate ratios cannot be interpolated');
    }
    const a = this.repr;
    const b = other.repr;
    const aLog = Math.log(a.numerator / a.denominator);
    const bLog = Math.log(b.numerator / b.denominator);
    return new RatioValue({ numerator: Math.exp((1 - progress) * aLog + progress * bLog), denominator: 1 });
  }
}

type Ratio = {
  numerator: number;
  denominator: number;
};

export type NumberOrRatioValue = NumberValue | RatioValue;

/** Parse the overlapping <number> | <ratio> grammar without another value container. */
export function parseNumberOrRatio(input: ParserInput, context: MathContext): NumberOrRatioValue | null {
  return numberOrRatioParser(input, context);
}

/** A slash selects the ratio alternative; otherwise retain a number. */
export function consumeNumberOrRatio(c: TokenCursor<ComponentValue, MathContext>): TryConsumerResult<NumberOrRatioValue> {
  return numberOrRatioConsumer(c);
}

function isDegenerateRatioComponent(value: number): boolean {
  return value === 0 || Math.abs(value) === Infinity;
}

type RatioSyntax = {
  numerator: NumberLiteral;
  denominator: number | undefined;
};

// <ratio> = <number [0,∞]> [ / <number [0,∞]> ]?

// <number [0,∞]>
const nonnegativeNumberConsumer = NumberLiteral.createConsumer({ min: 0 });

/*
 * Implementation factorization of <ratio>:
 * <ratio-denominator> = / <number [0,∞]>
 */
const ratioDenominatorConsumer: TryConsumer<number> = sequenceOf(
  [
    one(withTrivia(consumeSlashDelim)),
    one(withTrivia(nonnegativeNumberConsumer)),
  ],
  ([, [denominator]]) => denominator.value,
);

// Shared syntax for <ratio> and the overlapping <number> | <ratio> union.
const ratioSyntaxConsumer: TryConsumer<RatioSyntax> = sequenceOf(
  [
    one(nonnegativeNumberConsumer),
    opt(ratioDenominatorConsumer),
  ],
  ([[numerator], denominator]) => ({
    numerator,
    denominator: denominator[0],
  }),
);

const ratioConsumer: TryConsumer<RatioValue> = adaptConsumer(
  ratioSyntaxConsumer,
  ({ numerator, denominator }) => new RatioValue({
    numerator: numerator.value,
    denominator: denominator ?? 1,
  }),
);

// <number> | <ratio>
const nonnegativeNumberOrRatioConsumer: TryConsumer<NumberOrRatioValue, MathContext> = adaptConsumer(
  ratioSyntaxConsumer,
  ({ numerator, denominator }) => denominator === undefined
    ? new NumberValue(numerator)
    : new RatioValue({ numerator: numerator.value, denominator }),
);

// The <number> alternative additionally accepts negative values, which cannot
// be the numerator of <ratio>.
const numberOrRatioConsumer: TryConsumer<NumberOrRatioValue, MathContext> = oneOf(
  [
    one(nonnegativeNumberOrRatioConsumer),
    one(NumberValue.consume),
  ],
  ([value]) => value,
);

const ratioParser = createComponentParser(withTrivia(ratioConsumer));
const numberOrRatioParser = createComponentParser(withTrivia(numberOrRatioConsumer));
