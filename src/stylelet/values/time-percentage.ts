import { withComponentTrivia } from '../parser/component-grammar';
import { unwrapConsumeResultOrThrow, type TryComponentConsumer } from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import {
  resolveTime, serializeTime, tryConsumeTime,
  type CanonicalTimeValue, type TimeValue,
} from './time';
import {
  createDimensionPercentageConsumer, serializeDimensionPercentage,
  tryAccumulateDimensionPercentages,
  tryAddDimensionPercentages, tryInterpolateDimensionPercentages,
  type DimensionPercentageConsumerOptions, type DimensionPercentageValue,
} from './dimension-percentage';

/*
 * <time-percentage> = [ <time> | <percentage> ]
 */

export type TimePercentageValue = DimensionPercentageValue<TimeValue>;

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

export type TimePercentageConsumerOptions =
  DimensionPercentageConsumerOptions;

export function createTimePercentageConsumer(
  options: TimePercentageConsumerOptions = {},
): TryComponentConsumer<TimePercentageValue> {
  return createDimensionPercentageConsumer(
    tryConsumeTime,
    'Time-percentage',
    options,
  );
}

export const tryConsumeTimePercentage = createTimePercentageConsumer();

export function serializeTimePercentage(value: TimePercentageValue): string {
  return serializeDimensionPercentage(value, serializeTime);
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

export function tryAddTimePercentages(
  a: TimePercentageValue,
  b: TimePercentageValue,
): TimePercentageValue | null {
  return tryAddDimensionPercentages(a, b);
}

export function tryInterpolateTimePercentages(
  a: TimePercentageValue,
  b: TimePercentageValue,
  p: number,
): TimePercentageValue | null {
  return tryInterpolateDimensionPercentages(a, b, p);
}

export function tryAccumulateTimePercentages(
  a: TimePercentageValue,
  b: TimePercentageValue,
): TimePercentageValue | null {
  return tryAccumulateDimensionPercentages(a, b);
}
