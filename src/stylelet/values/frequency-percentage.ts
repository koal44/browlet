import { one, oneOf, withTrivia } from '../syntax/component-grammar';
import {
  type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult,
} from '../syntax/component-cursor';
import { createComponentParser, type ParserInput } from '../syntax/parser';
import { ValueStage } from '../value-processing/stage';
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
  tryResolveFrequencyPercentage as tryResolveFrequencyPercentageLiteral,
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
  return frequencyPercentageParser(input, context);
}

export function consumeFrequencyPercentage(
  c: ComponentCursor,
): TryComponentConsumerResult<FrequencyPercentageValue> {
  return frequencyPercentageConsumer(c);
}

export function createFrequencyPercentageConsumer(
  options: FrequencyPercentageConsumerOptions = {},
): TryComponentConsumer<FrequencyPercentageValue> {
  const literalConsumer = createFrequencyPercentageLiteralConsumer(options);
  const range = frequencyPercentageRange(options);

  return oneOf(
    [
      one(literalConsumer),
      one(createMathValueConsumer({
        expectedType: 'frequency-percentage',
        percentHint: 'frequency',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => value,
  );
}

export function resolveFrequencyPercentage(
  value: FrequencyPercentageValue,
  stage: ValueStage,
  context: MathContext = {},
): FrequencyPercentageValue {
  if (value.type === 'math') {
    return resolveMathValue(value, stage, frequencyPercentageMathContext(context));
  }

  if (stage < ValueStage.Computed) {
    return value;
  }

  const reference = context.percentageReferenceValue;
  return tryResolveFrequencyPercentageLiteral(value, {
    percentageReferenceValue: reference?.type === 'frequency' ? reference : undefined,
  }) ?? value;
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

  const mathContext = frequencyPercentageMathContext(context);

  return addMathValues(
    asMathValue(a, mathContext),
    asMathValue(b, mathContext),
    mathContext,
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

  const mathContext = frequencyPercentageMathContext(context);

  return interpolateMathValues(
    asMathValue(a, mathContext),
    asMathValue(b, mathContext),
    p,
    mathContext,
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

  const mathContext = frequencyPercentageMathContext(context);

  return accumulateMathValues(
    asMathValue(a, mathContext),
    asMathValue(b, mathContext),
    mathContext,
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

function frequencyPercentageMathContext(
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

// <frequency-percentage> = <frequency> | <percentage> | <math-function>
const frequencyPercentageConsumer = createFrequencyPercentageConsumer();
const frequencyPercentageParser = createComponentParser(withTrivia(frequencyPercentageConsumer));
