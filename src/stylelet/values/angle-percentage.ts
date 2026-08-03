import { one, oneOf, withTrivia } from '../parser/component-grammar';
import { type TryComponentConsumer } from '../parser/component-cursor';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import type { ValueStage } from '../value-processing';
import {
  accumulateMathValues, addMathValues, createMathValueConsumer, createMathValueFromLiteral,
  interpolateMathValues, resolveMathValue, serializeMathValue, type MathContext, type MathRange,
  type MathValue,
} from './math-value';
import {
  createAnglePercentageConsumer as createAnglePercentageLiteralConsumer,
  serializeAnglePercentage as serializeAnglePercentageLiteral,
  tryAccumulateAnglePercentages as tryAccumulateAnglePercentageLiterals,
  tryAddAnglePercentages as tryAddAnglePercentageLiterals,
  tryInterpolateAnglePercentages as tryInterpolateAnglePercentageLiterals,
  type AnglePercentageConsumerOptions, type AnglePercentageLiteral,
} from './numeric-literal/angle-percentage';

/*
 * <angle-percentage> = <angle> | <percentage> | <math-function>
 */

export type AnglePercentageValue =
  AnglePercentageLiteral | MathValue<'angle-percentage'>;

export function parseAnglePercentage(
  input: ParserInput,
  context: MathContext = {},
): AnglePercentageValue | null {
  return parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeAnglePercentage),
    context,
  );
}

export function createAnglePercentageConsumer(
  options: AnglePercentageConsumerOptions = {},
): TryComponentConsumer<AnglePercentageValue> {
  const tryConsumeLiteral = createAnglePercentageLiteralConsumer(options);
  const range = anglePercentageRange(options);

  return oneOf(
    [
      one(tryConsumeLiteral),
      one(createMathValueConsumer({
        expectedType: 'angle-percentage',
        percentHint: 'angle',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => value,
  );
}

export const tryConsumeAnglePercentage = createAnglePercentageConsumer();

export function resolveAnglePercentage(
  value: AnglePercentageValue,
  stage: ValueStage,
  context: MathContext = {},
): AnglePercentageValue {
  return value.type === 'math'
    ? resolveMathValue(
      value,
      stage,
      anglePercentageCalculationContext(context),
    )
    : value;
}

export function serializeAnglePercentage(
  value: AnglePercentageValue,
): string {
  return value.type === 'math'
    ? serializeMathValue(value)
    : serializeAnglePercentageLiteral(value);
}

export function addAnglePercentages(
  a: AnglePercentageValue,
  b: AnglePercentageValue,
  context: MathContext = {},
): AnglePercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryAddAnglePercentageLiterals(a, b);

    if (result !== null) {
      return result;
    }
  }

  const calculationContext = anglePercentageCalculationContext(context);

  return addMathValues(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
  );
}

export function interpolateAnglePercentages(
  a: AnglePercentageValue,
  b: AnglePercentageValue,
  p: number,
  context: MathContext = {},
): AnglePercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryInterpolateAnglePercentageLiterals(a, b, p);

    if (result !== null) {
      return result;
    }
  }

  const calculationContext = anglePercentageCalculationContext(context);

  return interpolateMathValues(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    p,
    calculationContext,
  );
}

export function accumulateAnglePercentages(
  a: AnglePercentageValue,
  b: AnglePercentageValue,
  context: MathContext = {},
): AnglePercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryAccumulateAnglePercentageLiterals(a, b);

    if (result !== null) {
      return result;
    }
  }

  const calculationContext = anglePercentageCalculationContext(context);

  return accumulateMathValues(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
  );
}

function asMathValue(
  value: AnglePercentageValue,
  context: MathContext,
): MathValue<'angle-percentage'> {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, 'angle-percentage', context);
}

function anglePercentageCalculationContext(
  context: MathContext,
): MathContext {
  return {
    ...context,
    percentHint: 'angle',
  };
}

function anglePercentageRange(
  options: AnglePercentageConsumerOptions,
): MathRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}
