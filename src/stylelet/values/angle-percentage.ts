import { one, oneOf, withTrivia } from '../parser/component-grammar';
import { type TryComponentConsumer } from '../parser/component-cursor';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { ValueStage } from '../value-processing';
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
  tryResolveAnglePercentage as tryResolveAnglePercentageLiteral,
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
  if (value.type === 'math') {
    return resolveMathValue(value, stage, anglePercentageMathContext(context));
  }

  if (stage < ValueStage.Computed) {
    return value;
  }

  const reference = context.percentageReferenceValue;
  return tryResolveAnglePercentageLiteral(value, {
    percentageReferenceValue: reference?.type === 'angle' ? reference : undefined,
  }) ?? value;
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

  const mathContext = anglePercentageMathContext(context);

  return addMathValues(
    asMathValue(a, mathContext),
    asMathValue(b, mathContext),
    mathContext,
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

  const mathContext = anglePercentageMathContext(context);

  return interpolateMathValues(
    asMathValue(a, mathContext),
    asMathValue(b, mathContext),
    p,
    mathContext,
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

  const mathContext = anglePercentageMathContext(context);

  return accumulateMathValues(
    asMathValue(a, mathContext),
    asMathValue(b, mathContext),
    mathContext,
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

function anglePercentageMathContext(
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
