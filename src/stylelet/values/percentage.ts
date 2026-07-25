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
  accumulatePercentages as accumulatePercentageLiterals,
  addPercentages as addPercentageLiterals,
  createPercentageConsumer as createPercentageLiteralConsumer,
  interpolatePercentages as interpolatePercentageLiterals,
  serializePercentage as serializePercentageLiteral,
  type PercentageConsumerOptions, type PercentageLiteral,
} from './numeric-literal/percentage';

/*
 * <percentage> = <percentage-token> | <math-function>
 */

export type PercentageValue = PercentageLiteral | MathValue;

export function parsePercentage(
  input: ParserInput,
  context: CalculationContext = {},
): PercentageValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumePercentage),
      context,
    ),
    'percentage',
  );
}

export function createPercentageConsumer(
  options: PercentageConsumerOptions = {},
): TryComponentConsumer<PercentageValue> {
  const tryConsumeLiteral = createPercentageLiteralConsumer(options);
  const range = percentageRange(options);

  return oneOf(
    [
      one(tryConsumeLiteral),
      one(createMathValueConsumer({
        expectedType: 'percentage',
        percentageType: 'percent',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => ok(value),
  );
}

export const tryConsumePercentage = createPercentageConsumer();

export function serializePercentage(
  value: PercentageValue,
  context: CalculationSerializationContext = {},
): string {
  return value.type === 'math'
    ? serializeMathValue(value, context)
    : serializePercentageLiteral(value);
}

export function addPercentages(
  a: PercentageValue,
  b: PercentageValue,
  context: CalculationContext = {},
): PercentageValue {
  if (a.type === 'percentage' && b.type === 'percentage') {
    return addPercentageLiterals(a, b);
  }

  const calculationContext = percentageCalculationContext(context);

  return addMathFunctions(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
  );
}

export function interpolatePercentages(
  a: PercentageValue,
  b: PercentageValue,
  p: number,
  context: CalculationContext = {},
): PercentageValue {
  if (a.type === 'percentage' && b.type === 'percentage') {
    return interpolatePercentageLiterals(a, b, p);
  }

  const calculationContext = percentageCalculationContext(context);

  return interpolateMathFunctions(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    p,
    calculationContext,
  );
}

export function accumulatePercentages(
  a: PercentageValue,
  b: PercentageValue,
  context: CalculationContext = {},
): PercentageValue {
  if (a.type === 'percentage' && b.type === 'percentage') {
    return accumulatePercentageLiterals(a, b);
  }

  const calculationContext = percentageCalculationContext(context);

  return accumulateMathFunctions(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
  );
}

function asMathValue(
  value: PercentageValue,
  context: CalculationContext,
): MathValue {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, 'percentage', context);
}

function percentageCalculationContext(
  context: CalculationContext,
): CalculationContext {
  return {
    ...context,
    percentageType: 'percent',
  };
}

function percentageRange(
  options: PercentageConsumerOptions,
): CalculationRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}
