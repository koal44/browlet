import { InternalError } from '../../infra/internal-error';

import {
  consumeSlashDelim, adaptConsumer, one, oneOf, opt, sequenceOf, withTrivia, createComponentParser,
  type ComponentValue, type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import type { ValueDefinition, ValueStage } from '../value-processing/index';
import { createNumberConsumer, numberLiteral, serializeCssNumber } from './numeric-literal/index';

import {
  consumeNumber, resolveNumber, serializeNumber, type NumberValue,
} from './number';
import { type MathContext } from './math-value';

/*
 * <ratio> = <number [0,∞]> [ / <number [0,∞]> ]?
 */

export type RatioValue = {
  type: 'ratio';
  numerator: number;
  denominator: number;
};

export type NumberOrRatioValue = NumberValue | RatioValue;

export const ratioDef: ValueDefinition<RatioValue> = {
  consume: consumeRatio,
  resolve: resolveRatio,
  serialize: serializeRatio,
};

export function parseRatio(
  input: ParserInput,
  context: unknown,
): RatioValue | null {
  return ratioParser(input, context);
}

export function consumeRatio(
  c: TokenCursor,
): TryConsumerResult<RatioValue> {
  return ratioConsumer(c);
}

/*
 * Factorization of the overlapping `<number> | <ratio>` grammar.
 */
export function parseNumberOrRatio(
  input: ParserInput,
  context: MathContext,
): NumberOrRatioValue | null {
  return numberOrRatioParser(input, context);
}

export function consumeNumberOrRatio(
  c: TokenCursor<ComponentValue, MathContext>,
): TryConsumerResult<NumberOrRatioValue> {
  return numberOrRatioConsumer(c);
}

export function resolveRatio(value: RatioValue): RatioValue {
  return value;
}

export function resolveNumberOrRatio(
  value: NumberOrRatioValue,
  stage: ValueStage,
  context: MathContext = {},
): NumberOrRatioValue {
  return value.type === 'ratio'
    ? resolveRatio(value)
    : resolveNumber(value, stage, context);
}

export function serializeRatio(value: RatioValue): string {
  return `${serializeCssNumber(value.numerator)} / ${serializeCssNumber(value.denominator)}`;
}

export function serializeNumberOrRatio(value: NumberOrRatioValue): string {
  return value.type === 'ratio'
    ? serializeRatio(value)
    : serializeNumber(value);
}

export function isDegenerateRatio(value: RatioValue): boolean {
  return isDegenerateRatioComponent(value.numerator) ||
    isDegenerateRatioComponent(value.denominator);
}

function isDegenerateRatioComponent(value: number): boolean {
  return value === 0 || Math.abs(value) === Infinity;
}

// CSS Values, "Combination of <ratio>".
export function interpolateRatios(
  a: RatioValue,
  b: RatioValue,
  p: number,
): RatioValue {
  if (isDegenerateRatio(a) || isDegenerateRatio(b)) {
    throw new InternalError('Degenerate ratios cannot be interpolated');
  }

  const aLog = Math.log(a.numerator / a.denominator);
  const bLog = Math.log(b.numerator / b.denominator);

  return {
    type: 'ratio',
    numerator: Math.exp((1 - p) * aLog + p * bLog),
    denominator: 1,
  };
}

// =============================================================================
// Syntax
// =============================================================================

// <number [0,∞]>
const nonnegativeNumberConsumer = createNumberConsumer({ min: 0 });

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

type RatioSyntax = {
  numerator: number;
  denominator?: number;
};

// Shared syntax for <ratio> and the overlapping <number> | <ratio> union.
const ratioSyntaxConsumer: TryConsumer<RatioSyntax> = sequenceOf(
  [
    one(nonnegativeNumberConsumer),
    opt(ratioDenominatorConsumer),
  ],
  ([[numerator], denominator]) => ({
    numerator: numerator.value,
    ...(denominator.length === 0 ? {} : { denominator: denominator[0] }),
  }),
);

// <ratio> = <number [0,∞]> [ / <number [0,∞]> ]?
const ratioConsumer: TryConsumer<RatioValue> = adaptConsumer(
  ratioSyntaxConsumer,
  ({ numerator, denominator }) => ({
    type: 'ratio',
    numerator,
    denominator: denominator ?? 1,
  }),
);

// <number> | <ratio>
const nonnegativeNumberOrRatioConsumer: TryConsumer<NumberOrRatioValue, MathContext> = adaptConsumer(
  ratioSyntaxConsumer,
  ({ numerator, denominator }) => denominator === undefined
    ? numberLiteral(numerator)
    : { type: 'ratio', numerator, denominator },
);

// The <number> alternative additionally accepts negative values, which cannot
// be the numerator of <ratio>.
const numberOrRatioConsumer: TryConsumer<NumberOrRatioValue, MathContext> = oneOf(
  [
    one(nonnegativeNumberOrRatioConsumer),
    one(consumeNumber),
  ],
  ([value]) => value,
);

const ratioParser = createComponentParser(withTrivia(ratioConsumer));
const numberOrRatioParser = createComponentParser(withTrivia(numberOrRatioConsumer));
