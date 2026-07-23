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

export type AnglePercentageValue = AnglePercentageLiteral | MathValue;

export function parseAnglePercentage(
  input: ParserInput,
  context: CalculationContext = {},
): AnglePercentageValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeAnglePercentage),
      context,
    ),
    'angle-percentage',
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
        percentageType: 'angle',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => ok(value),
  );
}

export const tryConsumeAnglePercentage = createAnglePercentageConsumer();

export function serializeAnglePercentage(
  value: AnglePercentageValue,
  context: CalculationSerializationContext = {},
): string {
  return value.type === 'math'
    ? serializeMathValue(value, context)
    : serializeAnglePercentageLiteral(value);
}

export function addAnglePercentages(
  a: AnglePercentageValue,
  b: AnglePercentageValue,
  context: CalculationContext = {},
): AnglePercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryAddAnglePercentageLiterals(a, b);

    if (result !== null) {
      return result;
    }
  }

  const calculationContext = anglePercentageCalculationContext(context);

  return addMathFunctions(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
  );
}

export function interpolateAnglePercentages(
  a: AnglePercentageValue,
  b: AnglePercentageValue,
  p: number,
  context: CalculationContext = {},
): AnglePercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryInterpolateAnglePercentageLiterals(a, b, p);

    if (result !== null) {
      return result;
    }
  }

  const calculationContext = anglePercentageCalculationContext(context);

  return interpolateMathFunctions(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    p,
    calculationContext,
  );
}

export function accumulateAnglePercentages(
  a: AnglePercentageValue,
  b: AnglePercentageValue,
  context: CalculationContext = {},
): AnglePercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryAccumulateAnglePercentageLiterals(a, b);

    if (result !== null) {
      return result;
    }
  }

  const calculationContext = anglePercentageCalculationContext(context);

  return accumulateMathFunctions(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
  );
}

function asMathValue(
  value: AnglePercentageValue,
  context: CalculationContext,
): MathValue {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, context);
}

function anglePercentageCalculationContext(
  context: CalculationContext,
): CalculationContext {
  return {
    ...context,
    expectedType: 'angle-percentage',
    percentageType: 'angle',
  };
}

function anglePercentageRange(
  options: AnglePercentageConsumerOptions,
): CalculationRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}
