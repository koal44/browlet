import { one, oneOf, withComponentTrivia } from '../parser/component-grammar';
import {
  ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import {
  accumulateMathFunctions, addMathFunctions,
  createMathValueConsumer, createMathValueFromLiteral,
  interpolateMathFunctions, serializeMathValue,
  type CalculationContext, type CalculationRange,
  type CalculationSerializationContext, type MathValue,
} from './calc';
import { accumulateDimensions, addDimensions, interpolateDimensions } from './numeric-literal/dimension';
import {
  createTimeConsumer as createTimeLiteralConsumer,
  serializeTime as serializeTimeLiteral,
  type TimeConsumerOptions, type TimeLiteral,
} from './numeric-literal/time';

/*
 * <time> = <dimension-token with a time unit> | <math-function>
 */

export type TimeValue = TimeLiteral | MathValue;

export function parseTime(
  input: ParserInput,
  context: CalculationContext = {},
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

export function serializeTime(
  value: TimeValue,
  context: CalculationSerializationContext = {},
): string {
  return value.type === 'math'
    ? serializeMathValue(value, context)
    : serializeTimeLiteral(value);
}

export function addTimes(
  a: TimeValue,
  b: TimeValue,
  context: CalculationContext = {},
): TimeValue {
  if (a.type === 'time' && b.type === 'time') {
    return addDimensions(a, b);
  }

  return addMathFunctions(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

export function interpolateTimes(
  a: TimeValue,
  b: TimeValue,
  p: number,
  context: CalculationContext = {},
): TimeValue {
  if (a.type === 'time' && b.type === 'time') {
    return interpolateDimensions(a, b, p);
  }

  return interpolateMathFunctions(
    asMathValue(a, context),
    asMathValue(b, context),
    p,
    context,
  );
}

export function accumulateTimes(
  a: TimeValue,
  b: TimeValue,
  context: CalculationContext = {},
): TimeValue {
  if (a.type === 'time' && b.type === 'time') {
    return accumulateDimensions(a, b);
  }

  return accumulateMathFunctions(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

function asMathValue(
  value: TimeValue,
  context: CalculationContext,
): MathValue {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, context);
}

function timeRange(
  options: TimeConsumerOptions,
): CalculationRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}
