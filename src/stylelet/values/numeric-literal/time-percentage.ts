import { withTrivia } from '../../parser/component-grammar';
import { type TryComponentConsumer } from '../../parser/component-cursor';
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
  percentageReferenceValue?: CanonicalTimeLiteral;
};

export function parseTimePercentage(
  input: ParserInput,
  context: unknown = undefined,
): TimePercentageLiteral | null {
  return parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeTimePercentage),
    context,
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

  const reference = context.percentageReferenceValue;

  if (reference === undefined) {
    return null;
  }

  return {
    ...reference,
    value: reference.value * value.value / 100,
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
