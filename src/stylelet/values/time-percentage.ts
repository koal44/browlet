import { one, oneOf, withComponentTrivia } from '../parser/component-grammar';
import {
  ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import type { ValueStage } from '../value-processing';
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
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeTimePercentage),
      context,
    ),
    'time-percentage',
  );
}

export function createTimePercentageConsumer(
  options: TimePercentageConsumerOptions = {},
): TryComponentConsumer<TimePercentageValue> {
  const tryConsumeLiteral = createTimePercentageLiteralConsumer(options);
  const range = timePercentageRange(options);

  return oneOf(
    [
      one(tryConsumeLiteral),
      one(createMathValueConsumer({
        expectedType: 'time-percentage',
        percentHint: 'time',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => ok(value),
  );
}

export const tryConsumeTimePercentage = createTimePercentageConsumer();

export function resolveTimePercentage(
  value: TimePercentageValue,
  stage: ValueStage,
  context: MathContext = {},
): TimePercentageValue {
  return value.type === 'math'
    ? resolveMathValue(
      value,
      stage,
      timePercentageCalculationContext(context),
    )
    : value;
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

  const calculationContext = timePercentageCalculationContext(context);

  return addMathValues(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
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

  const calculationContext = timePercentageCalculationContext(context);

  return interpolateMathValues(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    p,
    calculationContext,
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

  const calculationContext = timePercentageCalculationContext(context);

  return accumulateMathValues(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
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

function timePercentageCalculationContext(
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
