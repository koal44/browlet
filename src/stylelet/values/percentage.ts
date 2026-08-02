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
  accumulatePercentages as accumulatePercentageLiterals, addPercentages as addPercentageLiterals,
  createPercentageConsumer as createPercentageLiteralConsumer,
  interpolatePercentages as interpolatePercentageLiterals,
  serializePercentage as serializePercentageLiteral, type PercentageConsumerOptions,
  type PercentageLiteral,
} from './numeric-literal/percentage';

/*
 * <percentage> = <percentage-token> | <math-function>
 */

export type PercentageValue = PercentageLiteral | MathValue<'percentage'>;

export function parsePercentage(
  input: ParserInput,
  context: MathContext = {},
): PercentageValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withTrivia(tryConsumePercentage),
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
        percentHint: 'percent',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => ok(value),
  );
}

export const tryConsumePercentage = createPercentageConsumer();

export function resolvePercentage(
  value: PercentageValue,
  stage: ValueStage,
  context: MathContext = {},
): PercentageValue {
  return value.type === 'math'
    ? resolveMathValue(value, stage, percentageCalculationContext(context))
    : value;
}

export function serializePercentage(
  value: PercentageValue,
): string {
  return value.type === 'math'
    ? serializeMathValue(value)
    : serializePercentageLiteral(value);
}

export function addPercentages(
  a: PercentageValue,
  b: PercentageValue,
  context: MathContext = {},
): PercentageValue {
  if (a.type === 'percentage' && b.type === 'percentage') {
    return addPercentageLiterals(a, b);
  }

  const calculationContext = percentageCalculationContext(context);

  return addMathValues(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
  );
}

export function interpolatePercentages(
  a: PercentageValue,
  b: PercentageValue,
  p: number,
  context: MathContext = {},
): PercentageValue {
  if (a.type === 'percentage' && b.type === 'percentage') {
    return interpolatePercentageLiterals(a, b, p);
  }

  const calculationContext = percentageCalculationContext(context);

  return interpolateMathValues(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    p,
    calculationContext,
  );
}

export function accumulatePercentages(
  a: PercentageValue,
  b: PercentageValue,
  context: MathContext = {},
): PercentageValue {
  if (a.type === 'percentage' && b.type === 'percentage') {
    return accumulatePercentageLiterals(a, b);
  }

  const calculationContext = percentageCalculationContext(context);

  return accumulateMathValues(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
  );
}

function asMathValue(
  value: PercentageValue,
  context: MathContext,
): MathValue<'percentage'> {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, 'percentage', context);
}

function percentageCalculationContext(
  context: MathContext,
): MathContext {
  return {
    ...context,
    percentHint: 'percent',
  };
}

function percentageRange(
  options: PercentageConsumerOptions,
): MathRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}
