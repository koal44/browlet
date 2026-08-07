import { withTrivia } from '../../syntax/component-grammar';
import {
  type TokenCursor, type TryConsumer, type TryConsumerResult,
} from '../../syntax/token-cursor';
import { createComponentParser, type ParserInput } from '../../syntax/parser';
import {
  serializeLength, consumeLength, tryResolveLength, type CanonicalLengthLiteral,
  type LengthResolutionContext, type LengthLiteral,
} from './length';
import {
  createDimensionPercentageConsumer, serializeDimensionPercentage,
  tryAccumulateDimensionPercentages, tryAddDimensionPercentages, tryInterpolateDimensionPercentages,
  type DimensionPercentageConsumerOptions, type DimensionPercentageLiteral,
} from './dimension-percentage';

/*
 * <length-percentage> = [ <length> | <percentage> ]
 */

export type LengthPercentageLiteral = DimensionPercentageLiteral<LengthLiteral>;

export type LengthPercentageResolutionContext = LengthResolutionContext & {
  percentageReferenceValue?: CanonicalLengthLiteral;
};

export function parseLengthPercentage(
  input: ParserInput,
  context: unknown = undefined,
): LengthPercentageLiteral | null {
  return lengthPercentageParser(input, context);
}

export function consumeLengthPercentage(
  c: TokenCursor,
): TryConsumerResult<LengthPercentageLiteral> {
  return lengthPercentageConsumer(c);
}

export type LengthPercentageConsumerOptions =
  DimensionPercentageConsumerOptions;

export function createLengthPercentageConsumer(
  options: LengthPercentageConsumerOptions = {},
): TryConsumer<LengthPercentageLiteral> {
  return createDimensionPercentageConsumer(
    consumeLength,
    'Length-percentage',
    options,
  );
}

export function serializeLengthPercentage(value: LengthPercentageLiteral): string {
  return serializeDimensionPercentage(value, serializeLength);
}

export function tryResolveLengthPercentage(
  value: LengthPercentageLiteral,
  context: LengthPercentageResolutionContext = {},
): CanonicalLengthLiteral | null {
  if (value.type === 'length') {
    return tryResolveLength(value, context);
  }

  const reference = context.percentageReferenceValue;

  if (reference === undefined) {
    return null;
  }

  return {
    ...reference,
    value: reference.value * value.value / 100,
  };
}

export function tryAddLengthPercentages(
  a: LengthPercentageLiteral,
  b: LengthPercentageLiteral,
): LengthPercentageLiteral | null {
  return tryAddDimensionPercentages(a, b);
}

export function tryInterpolateLengthPercentages(
  a: LengthPercentageLiteral,
  b: LengthPercentageLiteral,
  p: number,
): LengthPercentageLiteral | null {
  return tryInterpolateDimensionPercentages(a, b, p);
}

export function tryAccumulateLengthPercentages(
  a: LengthPercentageLiteral,
  b: LengthPercentageLiteral,
): LengthPercentageLiteral | null {
  return tryAccumulateDimensionPercentages(a, b);
}

// <length-percentage> = [ <length> | <percentage> ]
const lengthPercentageConsumer = createLengthPercentageConsumer();
const lengthPercentageParser = createComponentParser(withTrivia(lengthPercentageConsumer));
