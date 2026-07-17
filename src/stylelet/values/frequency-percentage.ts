import { withComponentTrivia } from '../parser/component-grammar';
import { unwrapConsumeResultOrThrow, type TryComponentConsumer } from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import {
  resolveFrequency, serializeFrequency, tryConsumeFrequency,
  type CanonicalFrequencyValue, type FrequencyValue,
} from './frequency';
import {
  createDimensionPercentageConsumer, serializeDimensionPercentage,
  tryAddDimensionPercentages, tryInterpolateDimensionPercentages,
  type DimensionPercentageConsumerOptions, type DimensionPercentageValue,
} from './dimension-percentage';

/*
 * <frequency-percentage> = [ <frequency> | <percentage> ]
 */

export type FrequencyPercentageValue =
  DimensionPercentageValue<FrequencyValue>;

export type FrequencyPercentageResolutionContext = {
  /** Percentage basis in canonical hertz. */
  percentageBasis?: number;
};

export function parseFrequencyPercentage(
  input: ParserInput,
  context: unknown = undefined,
): FrequencyPercentageValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeFrequencyPercentage),
      context,
    ),
    'frequency-percentage',
  );
}

export type FrequencyPercentageConsumerOptions =
  DimensionPercentageConsumerOptions;

export function createFrequencyPercentageConsumer(
  options: FrequencyPercentageConsumerOptions = {},
): TryComponentConsumer<FrequencyPercentageValue> {
  return createDimensionPercentageConsumer(
    tryConsumeFrequency,
    'Frequency-percentage',
    options,
  );
}

export const tryConsumeFrequencyPercentage = createFrequencyPercentageConsumer();

export function serializeFrequencyPercentage(
  value: FrequencyPercentageValue,
): string {
  return serializeDimensionPercentage(value, serializeFrequency);
}

export function tryResolveFrequencyPercentage(
  value: FrequencyPercentageValue,
  context: FrequencyPercentageResolutionContext = {},
): CanonicalFrequencyValue | null {
  if (value.type === 'frequency') {
    return resolveFrequency(value);
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
  a: FrequencyPercentageValue,
  b: FrequencyPercentageValue,
): FrequencyPercentageValue | null {
  return tryAddDimensionPercentages(a, b);
}

export function tryInterpolateFrequencyPercentages(
  a: FrequencyPercentageValue,
  b: FrequencyPercentageValue,
  p: number,
): FrequencyPercentageValue | null {
  return tryInterpolateDimensionPercentages(a, b, p);
}
