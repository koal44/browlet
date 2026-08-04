import { withTrivia } from '../../parser/component-grammar';
import { type TryComponentConsumer } from '../../parser/component-cursor';
import { parseAsComponentGrammar, type ParserInput } from '../../parser/syntax';
import {
  serializeLength, tryConsumeLength, tryResolveLength, type CanonicalLengthLiteral,
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
  return parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeLengthPercentage),
    context,
  );
}

export type LengthPercentageConsumerOptions =
  DimensionPercentageConsumerOptions;

export function createLengthPercentageConsumer(
  options: LengthPercentageConsumerOptions = {},
): TryComponentConsumer<LengthPercentageLiteral> {
  return createDimensionPercentageConsumer(
    tryConsumeLength,
    'Length-percentage',
    options,
  );
}

export const tryConsumeLengthPercentage = createLengthPercentageConsumer();

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
