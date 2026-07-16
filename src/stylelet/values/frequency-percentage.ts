import { one, oneOf, withComponentTrivia } from '../parser/component-grammar';
import {
  isBad, ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer, type TryComponentConsumerResult,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import {
  resolveFrequency, serializeFrequency, tryConsumeFrequency,
  type CanonicalFrequencyValue, type FrequencyValue,
} from './frequency';
import {
  serializePercentage, tryConsumePercentage,
  type PercentageValue,
} from './percentage';

/*
 * <frequency-percentage> = [ <frequency> | <percentage> ]
 */

export type FrequencyPercentageValue =
  | FrequencyValue
  | PercentageValue;

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

export type FrequencyPercentageConsumerOptions = {
  /** Inclusive lower bound on the resolved frequency-percentage quantity. */
  min?: number;

  /** Inclusive upper bound on the resolved frequency-percentage quantity. */
  max?: number;
};

export function createFrequencyPercentageConsumer(
  options: FrequencyPercentageConsumerOptions = {},
): TryComponentConsumer<FrequencyPercentageValue> {
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;

  if (!canCheckRangeWithoutResolution(min, max)) {
    throw new Error(
      'Frequency-percentage ranges with finite nonzero bounds are not yet supported',
    );
  }

  return (c): TryComponentConsumerResult<FrequencyPercentageValue> => {
    const start = c.pos();
    const result = tryConsumeUnrestrictedFrequencyPercentage(c);

    if (result === null || isBad(result)) {
      return result;
    }

    if (result.value.value < min || result.value.value > max) {
      c.restore(start);
      return null;
    }

    return result;
  };
}

const tryConsumeUnrestrictedFrequencyPercentage: TryComponentConsumer<FrequencyPercentageValue> = oneOf(
  [
    one(tryConsumeFrequency),
    one(tryConsumePercentage),
  ],
  ([value]) => ok(value),
);

export const tryConsumeFrequencyPercentage = createFrequencyPercentageConsumer();

function canCheckRangeWithoutResolution(min: number, max: number): boolean {
  // All frequency and percentage resolutions preserve sign, so zero and
  // infinite bounds do not require a percentage basis.
  return (
    (min === -Infinity || min === 0) &&
    (max === 0 || max === Infinity)
  );
}

export function serializeFrequencyPercentage(
  value: FrequencyPercentageValue,
): string {
  switch (value.type) {
    case 'frequency':
      return serializeFrequency(value);
    case 'percentage':
      return serializePercentage(value);
  }
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
