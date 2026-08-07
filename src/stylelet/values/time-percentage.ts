import { one, oneOf, withTrivia } from '../syntax/component-grammar';
import {
  type TokenCursor, type TryConsumer, type TryConsumerResult,
} from '../syntax/token-cursor';
import { createComponentParser, type ParserInput } from '../syntax/parser';
import { ValueStage } from '../value-processing/stage';
import {
  accumulateMathValues, addMathValues, createMathValueConsumer, createMathValueFromLiteral,
  interpolateMathValues, resolveMathValue, serializeMathValue, type MathContext, type MathRange,
  type MathValue,
} from './math-value';
import {
  createTimePercentageConsumer as createTimePercentageLiteralConsumer,
  serializeTimePercentage as serializeTimePercentageLiteral,
  tryAccumulateTimePercentages as tryAccumulateTimePercentageLiterals,
  tryAddTimePercentages as tryAddTimePercentageLiterals,
  tryInterpolateTimePercentages as tryInterpolateTimePercentageLiterals,
  tryResolveTimePercentage as tryResolveTimePercentageLiteral,
  type TimePercentageConsumerOptions, type TimePercentageLiteral,
} from './numeric-literal/time-percentage';

/*
 * <time-percentage> = <time> | <percentage> | <math-function>
 */

export type TimePercentageValue =
  TimePercentageLiteral | MathValue<'time-percentage'>;

export function parseTimePercentage(
  input: ParserInput,
  context: MathContext = {},
): TimePercentageValue | null {
  return timePercentageParser(input, context);
}

export function consumeTimePercentage(
  c: TokenCursor,
): TryConsumerResult<TimePercentageValue> {
  return timePercentageConsumer(c);
}

export function createTimePercentageConsumer(
  options: TimePercentageConsumerOptions = {},
): TryConsumer<TimePercentageValue> {
  const literalConsumer = createTimePercentageLiteralConsumer(options);
  const range = timePercentageRange(options);

  return oneOf(
    [
      one(literalConsumer),
      one(createMathValueConsumer({
        expectedType: 'time-percentage',
        percentHint: 'time',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => value,
  );
}

export function resolveTimePercentage(
  value: TimePercentageValue,
  stage: ValueStage,
  context: MathContext = {},
): TimePercentageValue {
  if (value.type === 'math') {
    return resolveMathValue(value, stage, timePercentageMathContext(context));
  }

  if (stage < ValueStage.Computed) {
    return value;
  }

  const reference = context.percentageReferenceValue;
  return tryResolveTimePercentageLiteral(value, {
    percentageReferenceValue: reference?.type === 'time' ? reference : undefined,
  }) ?? value;
}

export function serializeTimePercentage(
  value: TimePercentageValue,
): string {
  return value.type === 'math'
    ? serializeMathValue(value)
    : serializeTimePercentageLiteral(value);
}

export function addTimePercentages(
  a: TimePercentageValue,
  b: TimePercentageValue,
  context: MathContext = {},
): TimePercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryAddTimePercentageLiterals(a, b);

    if (result !== null) {
      return result;
    }
  }

  const mathContext = timePercentageMathContext(context);

  return addMathValues(
    asMathValue(a, mathContext),
    asMathValue(b, mathContext),
    mathContext,
  );
}

export function interpolateTimePercentages(
  a: TimePercentageValue,
  b: TimePercentageValue,
  p: number,
  context: MathContext = {},
): TimePercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryInterpolateTimePercentageLiterals(a, b, p);

    if (result !== null) {
      return result;
    }
  }

  const mathContext = timePercentageMathContext(context);

  return interpolateMathValues(
    asMathValue(a, mathContext),
    asMathValue(b, mathContext),
    p,
    mathContext,
  );
}

export function accumulateTimePercentages(
  a: TimePercentageValue,
  b: TimePercentageValue,
  context: MathContext = {},
): TimePercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryAccumulateTimePercentageLiterals(a, b);

    if (result !== null) {
      return result;
    }
  }

  const mathContext = timePercentageMathContext(context);

  return accumulateMathValues(
    asMathValue(a, mathContext),
    asMathValue(b, mathContext),
    mathContext,
  );
}

function asMathValue(
  value: TimePercentageValue,
  context: MathContext,
): MathValue<'time-percentage'> {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, 'time-percentage', context);
}

function timePercentageMathContext(
  context: MathContext,
): MathContext {
  return {
    ...context,
    percentHint: 'time',
  };
}

function timePercentageRange(
  options: TimePercentageConsumerOptions,
): MathRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}

// <time-percentage> = <time> | <percentage> | <math-function>
const timePercentageConsumer = createTimePercentageConsumer();
const timePercentageParser = createComponentParser(withTrivia(timePercentageConsumer));
