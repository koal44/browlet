import { withTrivia } from '../../syntax/component-grammar';
import {
  type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult,
} from '../../syntax/component-cursor';
import { createComponentParser, type ParserInput } from '../../syntax/parser';
import {
  canonicalizeFrequency, serializeFrequency, consumeFrequency,
  type CanonicalFrequencyLiteral,
  type FrequencyLiteral,
} from './frequency';
import {
  createDimensionPercentageConsumer, serializeDimensionPercentage,
  tryAccumulateDimensionPercentages, tryAddDimensionPercentages, tryInterpolateDimensionPercentages,
  type DimensionPercentageConsumerOptions, type DimensionPercentageLiteral,
} from './dimension-percentage';

/*
 * <frequency-percentage> = [ <frequency> | <percentage> ]
 */

export type FrequencyPercentageLiteral =
  DimensionPercentageLiteral<FrequencyLiteral>;

export type FrequencyPercentageResolutionContext = {
  percentageReferenceValue?: CanonicalFrequencyLiteral;
};

export function parseFrequencyPercentage(
  input: ParserInput,
  context: unknown = undefined,
): FrequencyPercentageLiteral | null {
  return frequencyPercentageParser(input, context);
}

export function consumeFrequencyPercentage(
  c: ComponentCursor,
): TryComponentConsumerResult<FrequencyPercentageLiteral> {
  return frequencyPercentageConsumer(c);
}

export type FrequencyPercentageConsumerOptions =
  DimensionPercentageConsumerOptions;

export function createFrequencyPercentageConsumer(
  options: FrequencyPercentageConsumerOptions = {},
): TryComponentConsumer<FrequencyPercentageLiteral> {
  return createDimensionPercentageConsumer(
    consumeFrequency,
    'Frequency-percentage',
    options,
  );
}

export function serializeFrequencyPercentage(
  value: FrequencyPercentageLiteral,
): string {
  return serializeDimensionPercentage(value, serializeFrequency);
}

export function tryResolveFrequencyPercentage(
  value: FrequencyPercentageLiteral,
  context: FrequencyPercentageResolutionContext = {},
): CanonicalFrequencyLiteral | null {
  if (value.type === 'frequency') {
    return canonicalizeFrequency(value);
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

export function tryAddFrequencyPercentages(
  a: FrequencyPercentageLiteral,
  b: FrequencyPercentageLiteral,
): FrequencyPercentageLiteral | null {
  return tryAddDimensionPercentages(a, b);
}

export function tryInterpolateFrequencyPercentages(
  a: FrequencyPercentageLiteral,
  b: FrequencyPercentageLiteral,
  p: number,
): FrequencyPercentageLiteral | null {
  return tryInterpolateDimensionPercentages(a, b, p);
}

export function tryAccumulateFrequencyPercentages(
  a: FrequencyPercentageLiteral,
  b: FrequencyPercentageLiteral,
): FrequencyPercentageLiteral | null {
  return tryAccumulateDimensionPercentages(a, b);
}

// <frequency-percentage> = [ <frequency> | <percentage> ]
const frequencyPercentageConsumer = createFrequencyPercentageConsumer();
const frequencyPercentageParser = createComponentParser(withTrivia(frequencyPercentageConsumer));
