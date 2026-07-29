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
  accumulateDimensions, addDimensions,
  interpolateDimensions,
} from './numeric-literal/dimension';
import {
  createFrequencyConsumer as createFrequencyLiteralConsumer,
  serializeFrequency as serializeFrequencyLiteral, type FrequencyConsumerOptions,
  type FrequencyLiteral,
} from './numeric-literal/frequency';

/*
 * <frequency> = <dimension-token with a frequency unit> | <math-function>
 */

export type FrequencyValue = FrequencyLiteral | MathValue<'frequency'>;

export function parseFrequency(
  input: ParserInput,
  context: MathContext = {},
): FrequencyValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeFrequency),
      context,
    ),
    'frequency',
  );
}

export function createFrequencyConsumer(
  options: FrequencyConsumerOptions = {},
): TryComponentConsumer<FrequencyValue> {
  const tryConsumeLiteral = createFrequencyLiteralConsumer(options);
  const range = frequencyRange(options);

  return oneOf(
    [
      one(tryConsumeLiteral),
      one(createMathValueConsumer({
        expectedType: 'frequency',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => ok(value),
  );
}

export const tryConsumeFrequency = createFrequencyConsumer();

export function resolveFrequency(
  value: FrequencyValue,
  stage: ValueStage,
  context: MathContext = {},
): FrequencyValue {
  return value.type === 'math'
    ? resolveMathValue(value, stage, context)
    : value;
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
