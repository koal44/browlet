import { withTrivia } from '../../parser/component-grammar';
import {
  unwrapConsumeResultOrThrow,
  type TryComponentConsumer,
} from '../../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../../parser/syntax';
import {
  canonicalizeTime, serializeTime, tryConsumeTime, type CanonicalTimeLiteral,
  type TimeLiteral,
} from './time';
import {
  createDimensionPercentageConsumer, serializeDimensionPercentage,
  tryAccumulateDimensionPercentages, tryAddDimensionPercentages, tryInterpolateDimensionPercentages,
  type DimensionPercentageConsumerOptions, type DimensionPercentageLiteral,
} from './dimension-percentage';

/*
 * <time-percentage> = [ <time> | <percentage> ]
 */

export type TimePercentageLiteral = DimensionPercentageLiteral<TimeLiteral>;

export type TimePercentageResolutionContext = {
  /** Percentage basis in canonical seconds. */
  percentageBasis?: number;
};

export function parseTimePercentage(
  input: ParserInput,
  context: unknown = undefined,
): TimePercentageLiteral | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withTrivia(tryConsumeTimePercentage),
      context,
    ),
    'time-percentage',
  );
}

export type TimePercentageConsumerOptions =
  DimensionPercentageConsumerOptions;

export function createTimePercentageConsumer(
  options: TimePercentageConsumerOptions = {},
): TryComponentConsumer<TimePercentageLiteral> {
  return createDimensionPercentageConsumer(
    tryConsumeTime,
    'Time-percentage',
    options,
  );
}

export const tryConsumeTimePercentage = createTimePercentageConsumer();

export function serializeTimePercentage(value: TimePercentageLiteral): string {
  return serializeDimensionPercentage(value, serializeTime);
}

export function tryResolveTimePercentage(
  value: TimePercentageLiteral,
  context: TimePercentageResolutionContext = {},
): CanonicalTimeLiteral | null {
  if (value.type === 'time') {
    return canonicalizeTime(value);
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
  a: TimePercentageLiteral,
  b: TimePercentageLiteral,
): TimePercentageLiteral | null {
  return tryAddDimensionPercentages(a, b);
}

export function tryInterpolateTimePercentages(
  a: TimePercentageLiteral,
  b: TimePercentageLiteral,
  p: number,
): TimePercentageLiteral | null {
  return tryInterpolateDimensionPercentages(a, b, p);
}

export function tryAccumulateTimePercentages(
  a: TimePercentageLiteral,
  b: TimePercentageLiteral,
): TimePercentageLiteral | null {
  return tryAccumulateDimensionPercentages(a, b);
}
