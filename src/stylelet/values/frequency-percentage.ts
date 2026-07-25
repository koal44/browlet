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
  createFrequencyPercentageConsumer as createFrequencyPercentageLiteralConsumer,
  serializeFrequencyPercentage as serializeFrequencyPercentageLiteral,
  tryAccumulateFrequencyPercentages as tryAccumulateFrequencyPercentageLiterals,
  tryAddFrequencyPercentages as tryAddFrequencyPercentageLiterals,
  tryInterpolateFrequencyPercentages as tryInterpolateFrequencyPercentageLiterals,
  type FrequencyPercentageConsumerOptions, type FrequencyPercentageLiteral,
} from './numeric-literal/frequency-percentage';

/*
 * <frequency-percentage> = <frequency> | <percentage> | <math-function>
 */

export type FrequencyPercentageValue = FrequencyPercentageLiteral | MathValue;

export function parseFrequencyPercentage(
  input: ParserInput,
  context: CalculationContext = {},
): FrequencyPercentageValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeFrequencyPercentage),
      context,
    ),
    'frequency-percentage',
  );
}

export function createFrequencyPercentageConsumer(
  options: FrequencyPercentageConsumerOptions = {},
): TryComponentConsumer<FrequencyPercentageValue> {
  const tryConsumeLiteral = createFrequencyPercentageLiteralConsumer(options);
  const range = frequencyPercentageRange(options);

  return oneOf(
    [
      one(tryConsumeLiteral),
      one(createMathValueConsumer({
        expectedType: 'frequency-percentage',
        percentageType: 'frequency',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => ok(value),
  );
}

export const tryConsumeFrequencyPercentage =
  createFrequencyPercentageConsumer();

export function serializeFrequencyPercentage(
  value: FrequencyPercentageValue,
  context: CalculationSerializationContext = {},
): string {
  return value.type === 'math'
    ? serializeMathValue(value, context)
    : serializeFrequencyPercentageLiteral(value);
}

export function addFrequencyPercentages(
  a: FrequencyPercentageValue,
  b: FrequencyPercentageValue,
  context: CalculationContext = {},
): FrequencyPercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryAddFrequencyPercentageLiterals(a, b);

    if (result !== null) {
      return result;
    }
  }

  const calculationContext = frequencyPercentageCalculationContext(context);

  return addMathFunctions(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
  );
}

export function interpolateFrequencyPercentages(
  a: FrequencyPercentageValue,
  b: FrequencyPercentageValue,
  p: number,
  context: CalculationContext = {},
): FrequencyPercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryInterpolateFrequencyPercentageLiterals(a, b, p);

    if (result !== null) {
      return result;
    }
  }

  const calculationContext = frequencyPercentageCalculationContext(context);

  return interpolateMathFunctions(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    p,
    calculationContext,
  );
}

export function accumulateFrequencyPercentages(
  a: FrequencyPercentageValue,
  b: FrequencyPercentageValue,
  context: CalculationContext = {},
): FrequencyPercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryAccumulateFrequencyPercentageLiterals(a, b);

    if (result !== null) {
      return result;
    }
  }

  const calculationContext = frequencyPercentageCalculationContext(context);

  return accumulateMathFunctions(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
  );
}

function asMathValue(
  value: FrequencyPercentageValue,
  context: CalculationContext,
): MathValue {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, 'frequency-percentage', context);
}

function frequencyPercentageCalculationContext(
  context: CalculationContext,
): CalculationContext {
  return {
    ...context,
    percentageType: 'frequency',
  };
}

function frequencyPercentageRange(
  options: FrequencyPercentageConsumerOptions,
): CalculationRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}
