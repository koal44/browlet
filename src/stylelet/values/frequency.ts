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
  accumulateDimensions, addDimensions,
  interpolateDimensions,
} from './numeric-literal/dimension';
import {
  canonicalizeFrequency, createFrequencyConsumer as createFrequencyLiteralConsumer,
  serializeFrequency as serializeFrequencyLiteral,
  type FrequencyConsumerOptions, type FrequencyLiteral,
} from './numeric-literal/frequency';

/*
 * <frequency> = <dimension-token with a frequency unit> | <math-function>
 */

export type FrequencyValue = FrequencyLiteral | MathValue<'frequency'>;

export function parseFrequency(
  input: ParserInput,
  context: MathContext = {},
): FrequencyValue | null {
  return frequencyParser(input, context);
}

export function consumeFrequency(
  c: ComponentCursor,
): TryComponentConsumerResult<FrequencyValue> {
  return frequencyConsumer(c);
}

export function createFrequencyConsumer(
  options: FrequencyConsumerOptions = {},
): TryComponentConsumer<FrequencyValue> {
  const literalConsumer = createFrequencyLiteralConsumer(options);
  const range = frequencyRange(options);

  return oneOf(
    [
      one(literalConsumer),
      one(createMathValueConsumer({
        expectedType: 'frequency',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => value,
  );
}

export function resolveFrequency(
  value: FrequencyValue,
  stage: ValueStage,
  context: MathContext = {},
): FrequencyValue {
  if (value.type === 'math') {
    return resolveMathValue(value, stage, context);
  }

  return stage < ValueStage.Computed
    ? value
    : canonicalizeFrequency(value);
}

export function serializeFrequency(
  value: FrequencyValue,
): string {
  return value.type === 'math'
    ? serializeMathValue(value)
    : serializeFrequencyLiteral(value);
}

export function addFrequencies(
  a: FrequencyValue,
  b: FrequencyValue,
  context: MathContext = {},
): FrequencyValue {
  if (a.type === 'frequency' && b.type === 'frequency') {
    return addDimensions(a, b);
  }

  return addMathValues(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

export function interpolateFrequencies(
  a: FrequencyValue,
  b: FrequencyValue,
  p: number,
  context: MathContext = {},
): FrequencyValue {
  if (a.type === 'frequency' && b.type === 'frequency') {
    return interpolateDimensions(a, b, p);
  }

  return interpolateMathValues(
    asMathValue(a, context),
    asMathValue(b, context),
    p,
    context,
  );
}

export function accumulateFrequencies(
  a: FrequencyValue,
  b: FrequencyValue,
  context: MathContext = {},
): FrequencyValue {
  if (a.type === 'frequency' && b.type === 'frequency') {
    return accumulateDimensions(a, b);
  }

  return accumulateMathValues(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

function asMathValue(
  value: FrequencyValue,
  context: MathContext,
): MathValue<'frequency'> {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, 'frequency', context);
}

function frequencyRange(
  options: FrequencyConsumerOptions,
): MathRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}

// <frequency> = <dimension-token with a frequency unit> | <math-function>
const frequencyConsumer = createFrequencyConsumer();
const frequencyParser = createComponentParser(withTrivia(frequencyConsumer));
