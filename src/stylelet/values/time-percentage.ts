import { one, oneOf, withComponentTrivia } from '../parser/component-grammar';
import {
  isBad, ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer, type TryComponentConsumerResult,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import {
  resolveTime, serializeTime, tryConsumeTime,
  type CanonicalTimeValue, type TimeValue,
} from './time';
import {
  serializePercentage, tryConsumePercentage,
  type PercentageValue,
} from './percentage';

/*
 * <time-percentage> = [ <time> | <percentage> ]
 */

export type TimePercentageValue =
  | TimeValue
  | PercentageValue;

export type TimePercentageResolutionContext = {
  /** Percentage basis in canonical seconds. */
  percentageBasis?: number;
};

export function parseTimePercentage(
  input: ParserInput,
  context: unknown = undefined,
): TimePercentageValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeTimePercentage),
      context,
    ),
    'time-percentage',
  );
}

export type TimePercentageConsumerOptions = {
  /** Inclusive lower bound on the resolved time-percentage quantity. */
  min?: number;

  /** Inclusive upper bound on the resolved time-percentage quantity. */
  max?: number;
};

export function createTimePercentageConsumer(
  options: TimePercentageConsumerOptions = {},
): TryComponentConsumer<TimePercentageValue> {
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;

  if (!canCheckRangeWithoutResolution(min, max)) {
    throw new Error(
      'Time-percentage ranges with finite nonzero bounds are not yet supported',
    );
  }

  return (c): TryComponentConsumerResult<TimePercentageValue> => {
    const start = c.pos();
    const result = tryConsumeUnrestrictedTimePercentage(c);

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

const tryConsumeUnrestrictedTimePercentage: TryComponentConsumer<TimePercentageValue> = oneOf(
  [
    one(tryConsumeTime),
    one(tryConsumePercentage),
  ],
  ([value]) => ok(value),
);

export const tryConsumeTimePercentage = createTimePercentageConsumer();

function canCheckRangeWithoutResolution(min: number, max: number): boolean {
  // All time and percentage resolutions preserve sign, so zero and infinite
  // bounds do not require a percentage basis.
  return (
    (min === -Infinity || min === 0) &&
    (max === 0 || max === Infinity)
  );
}

export function serializeTimePercentage(value: TimePercentageValue): string {
  switch (value.type) {
    case 'time':
      return serializeTime(value);
    case 'percentage':
      return serializePercentage(value);
  }
}

export function tryResolveTimePercentage(
  value: TimePercentageValue,
  context: TimePercentageResolutionContext = {},
): CanonicalTimeValue | null {
  if (value.type === 'time') {
    return resolveTime(value);
  }

  if (context.percentageBasis === undefined) {
    return null;
  }

  return {
    type: 'time',
    value: context.percentageBasis * value.value / 100,
    unit: 's',
  };
}
