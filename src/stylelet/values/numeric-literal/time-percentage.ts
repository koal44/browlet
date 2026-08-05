import { withTrivia } from '../../syntax/component-grammar';
import {
  type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult,
} from '../../syntax/component-cursor';
import { createComponentParser, type ParserInput } from '../../syntax/parser';
import {
  canonicalizeTime, serializeTime, consumeTime, type CanonicalTimeLiteral,
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
  return timePercentageParser(input, context);
}

export function consumeTimePercentage(
  c: ComponentCursor,
): TryComponentConsumerResult<TimePercentageLiteral> {
  return timePercentageConsumer(c);
}

export type TimePercentageConsumerOptions =
  DimensionPercentageConsumerOptions;

export function createTimePercentageConsumer(
  options: TimePercentageConsumerOptions = {},
): TryComponentConsumer<TimePercentageLiteral> {
  return createDimensionPercentageConsumer(
    consumeTime,
    'Time-percentage',
    options,
  );
}

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

// <time-percentage> = [ <time> | <percentage> ]
const timePercentageConsumer = createTimePercentageConsumer();
const timePercentageParser = createComponentParser(withTrivia(timePercentageConsumer));
