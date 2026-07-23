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

export type TimePercentageValue = TimePercentageLiteral | MathValue;

export function parseTimePercentage(
  input: ParserInput,
  context: CalculationContext = {},
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
        percentageType: 'time',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => ok(value),
  );
}

export const tryConsumeTimePercentage = createTimePercentageConsumer();

export function serializeTimePercentage(
  value: TimePercentageValue,
  context: CalculationSerializationContext = {},
): string {
  return value.type === 'math'
    ? serializeMathValue(value, context)
    : serializeTimePercentageLiteral(value);
}

export function addTimePercentages(
  a: TimePercentageValue,
  b: TimePercentageValue,
  context: CalculationContext = {},
): TimePercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryAddTimePercentageLiterals(a, b);

    if (result !== null) {
      return result;
    }
  }

  const calculationContext = timePercentageCalculationContext(context);

  return addMathFunctions(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
  );
}

export function interpolateTimePercentages(
  a: TimePercentageValue,
  b: TimePercentageValue,
  p: number,
  context: CalculationContext = {},
): TimePercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryInterpolateTimePercentageLiterals(a, b, p);

    if (result !== null) {
      return result;
    }
  }

  const calculationContext = timePercentageCalculationContext(context);

  return interpolateMathFunctions(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    p,
    calculationContext,
  );
}

export function accumulateTimePercentages(
  a: TimePercentageValue,
  b: TimePercentageValue,
  context: CalculationContext = {},
): TimePercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryAccumulateTimePercentageLiterals(a, b);

    if (result !== null) {
      return result;
    }
  }

  const calculationContext = timePercentageCalculationContext(context);

  return accumulateMathFunctions(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
  );
}

function asMathValue(
  value: TimePercentageValue,
  context: CalculationContext,
): MathValue {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, context);
}

function timePercentageCalculationContext(
  context: CalculationContext,
): CalculationContext {
  return {
    ...context,
    expectedType: 'time-percentage',
    percentageType: 'time',
  };
}

function timePercentageRange(
  options: TimePercentageConsumerOptions,
): CalculationRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}
