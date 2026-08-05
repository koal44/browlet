import { one, oneOf, withTrivia } from '../syntax/component-grammar';
import {
  type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult,
} from '../syntax/component-cursor';
import { createComponentParser, type ParserInput } from '../syntax/parser';
import { ValueStage } from '../value-processing/stage';
import type { ValueDefinition } from '../value-processing/definition';
import {
  accumulateMathValues, addMathValues, createMathValueConsumer, createMathValueFromLiteral,
  interpolateMathValues, resolveMathValue, serializeMathValue, type MathContext, type MathRange,
  type MathValue,
} from './math-value';
import {
  accumulateDimensions, addDimensions,
  interpolateDimensions,
} from './numeric-literal/dimension';
import {
  canonicalizeTime, createTimeConsumer as createTimeLiteralConsumer,
  serializeTime as serializeTimeLiteral, type TimeConsumerOptions, type TimeLiteral,
} from './numeric-literal/time';

/*
 * <time> = <dimension-token with a time unit> | <math-function>
 */

export type TimeValue = TimeLiteral | MathValue<'time'>;

export const timeDef: ValueDefinition<TimeValue, MathContext> = {
  consume: consumeTime,
  resolve: resolveTime,
  serialize: serializeTime,
};

export function parseTime(
  input: ParserInput,
  context: MathContext = {},
): TimeValue | null {
  return timeParser(input, context);
}

export function consumeTime(
  c: ComponentCursor,
): TryComponentConsumerResult<TimeValue> {
  return timeConsumer(c);
}

export function createTimeConsumer(
  options: TimeConsumerOptions = {},
): TryComponentConsumer<TimeValue> {
  const literalConsumer = createTimeLiteralConsumer(options);
  const range = timeRange(options);

  return oneOf(
    [
      one(literalConsumer),
      one(createMathValueConsumer({
        expectedType: 'time',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => value,
  );
}

export function resolveTime(
  value: TimeValue,
  stage: ValueStage,
  context: MathContext = {},
): TimeValue {
  if (value.type === 'math') {
    return resolveMathValue(value, stage, context);
  }

  return stage < ValueStage.Computed
    ? value
    : canonicalizeTime(value);
}

export function serializeTime(
  value: TimeValue,
): string {
  return value.type === 'math'
    ? serializeMathValue(value)
    : serializeTimeLiteral(value);
}

export function addTimes(
  a: TimeValue,
  b: TimeValue,
  context: MathContext = {},
): TimeValue {
  if (a.type === 'time' && b.type === 'time') {
    return addDimensions(a, b);
  }

  return addMathValues(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

export function interpolateTimes(
  a: TimeValue,
  b: TimeValue,
  p: number,
  context: MathContext = {},
): TimeValue {
  if (a.type === 'time' && b.type === 'time') {
    return interpolateDimensions(a, b, p);
  }

  return interpolateMathValues(
    asMathValue(a, context),
    asMathValue(b, context),
    p,
    context,
  );
}

export function accumulateTimes(
  a: TimeValue,
  b: TimeValue,
  context: MathContext = {},
): TimeValue {
  if (a.type === 'time' && b.type === 'time') {
    return accumulateDimensions(a, b);
  }

  return accumulateMathValues(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

function asMathValue(
  value: TimeValue,
  context: MathContext,
): MathValue<'time'> {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, 'time', context);
}

function timeRange(
  options: TimeConsumerOptions,
): MathRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}

// <time> = <dimension-token with a time unit> | <math-function>
const timeConsumer = createTimeConsumer();
const timeParser = createComponentParser(withTrivia(timeConsumer));
