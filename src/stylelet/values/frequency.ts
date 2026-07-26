import { one, oneOf, withComponentTrivia } from '../parser/component-grammar';
import {
  ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import {
  accumulateMathFunctions, addMathFunctions,
  createMathValueConsumer, createMathValueFromLiteral,
  interpolateMathFunctions, resolveMathValue, serializeMathValue,
  type CalculationContext, type CalculationRange,
  type CalculationSerializationContext, type MathValue,
} from './calc';
import { accumulateDimensions, addDimensions, interpolateDimensions } from './numeric-literal/dimension';
import {
  createFrequencyConsumer as createFrequencyLiteralConsumer,
  serializeFrequency as serializeFrequencyLiteral,
  type FrequencyConsumerOptions, type FrequencyLiteral,
} from './numeric-literal/frequency';

/*
 * <frequency> = <dimension-token with a frequency unit> | <math-function>
 */

export type FrequencyValue = FrequencyLiteral | MathValue<'frequency'>;

export function parseFrequency(
  input: ParserInput,
  context: CalculationContext = {},
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
  context: CalculationContext = {},
): FrequencyValue {
  return value.type === 'math'
    ? resolveMathValue(value, context)
    : value;
}

export function serializeFrequency(
  value: FrequencyValue,
  context: CalculationSerializationContext = {},
): string {
  return value.type === 'math'
    ? serializeMathValue(value, context)
    : serializeFrequencyLiteral(value);
}

export function addFrequencies(
  a: FrequencyValue,
  b: FrequencyValue,
  context: CalculationContext = {},
): FrequencyValue {
  if (a.type === 'frequency' && b.type === 'frequency') {
    return addDimensions(a, b);
  }

  return addMathFunctions(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

export function interpolateFrequencies(
  a: FrequencyValue,
  b: FrequencyValue,
  p: number,
  context: CalculationContext = {},
): FrequencyValue {
  if (a.type === 'frequency' && b.type === 'frequency') {
    return interpolateDimensions(a, b, p);
  }

  return interpolateMathFunctions(
    asMathValue(a, context),
    asMathValue(b, context),
    p,
    context,
  );
}

export function accumulateFrequencies(
  a: FrequencyValue,
  b: FrequencyValue,
  context: CalculationContext = {},
): FrequencyValue {
  if (a.type === 'frequency' && b.type === 'frequency') {
    return accumulateDimensions(a, b);
  }

  return accumulateMathFunctions(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

function asMathValue(
  value: FrequencyValue,
  context: CalculationContext,
): MathValue<'frequency'> {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, 'frequency', context);
}

function frequencyRange(
  options: FrequencyConsumerOptions,
): CalculationRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}
