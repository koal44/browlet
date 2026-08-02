import { one, oneOf, withTrivia } from '../parser/component-grammar';
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

export type FrequencyPercentageValue =
  FrequencyPercentageLiteral | MathValue<'frequency-percentage'>;

export function parseFrequencyPercentage(
  input: ParserInput,
  context: MathContext = {},
): FrequencyPercentageValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withTrivia(tryConsumeFrequencyPercentage),
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
        percentHint: 'frequency',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => ok(value),
  );
}

export const tryConsumeFrequencyPercentage =
  createFrequencyPercentageConsumer();

export function resolveFrequencyPercentage(
  value: FrequencyPercentageValue,
  stage: ValueStage,
  context: MathContext = {},
): FrequencyPercentageValue {
  return value.type === 'math'
    ? resolveMathValue(
      value,
      stage,
      frequencyPercentageCalculationContext(context),
    )
    : value;
}

export function serializeFrequencyPercentage(
  value: FrequencyPercentageValue,
): string {
  return value.type === 'math'
    ? serializeMathValue(value)
    : serializeFrequencyPercentageLiteral(value);
}

export function addFrequencyPercentages(
  a: FrequencyPercentageValue,
  b: FrequencyPercentageValue,
  context: MathContext = {},
): FrequencyPercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryAddFrequencyPercentageLiterals(a, b);

    if (result !== null) {
      return result;
    }
  }

  const calculationContext = frequencyPercentageCalculationContext(context);

  return addMathValues(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
  );
}

export function interpolateFrequencyPercentages(
  a: FrequencyPercentageValue,
  b: FrequencyPercentageValue,
  p: number,
  context: MathContext = {},
): FrequencyPercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryInterpolateFrequencyPercentageLiterals(a, b, p);

    if (result !== null) {
      return result;
    }
  }

  const calculationContext = frequencyPercentageCalculationContext(context);

  return interpolateMathValues(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    p,
    calculationContext,
  );
}

export function accumulateFrequencyPercentages(
  a: FrequencyPercentageValue,
  b: FrequencyPercentageValue,
  context: MathContext = {},
): FrequencyPercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryAccumulateFrequencyPercentageLiterals(a, b);

    if (result !== null) {
      return result;
    }
  }

  const calculationContext = frequencyPercentageCalculationContext(context);

  return accumulateMathValues(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
  );
}

function asMathValue(
  value: FrequencyPercentageValue,
  context: MathContext,
): MathValue<'frequency-percentage'> {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, 'frequency-percentage', context);
}

function frequencyPercentageCalculationContext(
  context: MathContext,
): MathContext {
  return {
    ...context,
    percentHint: 'frequency',
  };
}

function frequencyPercentageRange(
  options: FrequencyPercentageConsumerOptions,
): MathRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}
