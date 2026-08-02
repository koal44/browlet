import { withTrivia } from '../../parser/component-grammar';
import {
  unwrapConsumeResultOrThrow,
  type TryComponentConsumer,
} from '../../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../../parser/syntax';
import {
  canonicalizeFrequency, serializeFrequency, tryConsumeFrequency,
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
  /** Percentage basis in canonical hertz. */
  percentageBasis?: number;
};

export function parseFrequencyPercentage(
  input: ParserInput,
  context: unknown = undefined,
): FrequencyPercentageLiteral | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withTrivia(tryConsumeFrequencyPercentage),
      context,
    ),
    'frequency-percentage',
  );
}

export type FrequencyPercentageConsumerOptions =
  DimensionPercentageConsumerOptions;

export function createFrequencyPercentageConsumer(
  options: FrequencyPercentageConsumerOptions = {},
): TryComponentConsumer<FrequencyPercentageLiteral> {
  return createDimensionPercentageConsumer(
    tryConsumeFrequency,
    'Frequency-percentage',
    options,
  );
}

export const tryConsumeFrequencyPercentage = createFrequencyPercentageConsumer();

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

  if (context.percentageBasis === undefined) {
    return null;
  }

  return {
    type: 'frequency',
    value: context.percentageBasis * value.value / 100,
    unit: 'hz',
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
