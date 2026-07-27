import { one, oneOf, withComponentTrivia } from '../parser/component-grammar';
import {
  ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
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
  createTimeConsumer as createTimeLiteralConsumer, serializeTime as serializeTimeLiteral,
  type TimeConsumerOptions, type TimeLiteral,
} from './numeric-literal/time';

/*
 * <time> = <dimension-token with a time unit> | <math-function>
 */

export type TimeValue = TimeLiteral | MathValue<'time'>;

export function parseTime(
  input: ParserInput,
  context: MathContext = {},
): TimeValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeTime),
      context,
    ),
    'time',
  );
}

export function createTimeConsumer(
  options: TimeConsumerOptions = {},
): TryComponentConsumer<TimeValue> {
  const tryConsumeLiteral = createTimeLiteralConsumer(options);
  const range = timeRange(options);

  return oneOf(
    [
      one(tryConsumeLiteral),
      one(createMathValueConsumer({
        expectedType: 'time',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => ok(value),
  );
}

export const tryConsumeTime = createTimeConsumer();

export function resolveTime(
  value: TimeValue,
  context: MathContext = {},
): TimeValue {
  return value.type === 'math'
    ? resolveMathValue(value, context)
    : value;
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
