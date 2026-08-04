import { one, oneOf, withTrivia } from '../parser/component-grammar';
import { type TryComponentConsumer } from '../parser/component-cursor';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import type { ValueStage } from '../value-processing';
import type { ValueDefinition } from './value-definition';
import {
  accumulateMathValues, addMathValues, createMathValueConsumer, createMathValueFromLiteral,
  interpolateMathValues, resolveMathValue, resolveNumericLiteral, serializeMathValue,
  type MathContext, type MathRange, type MathValue,
} from './math-value';
import {
  createLengthPercentageConsumer as createLengthPercentageLiteralConsumer,
  serializeLengthPercentage as serializeLengthPercentageLiteral,
  tryAccumulateLengthPercentages as tryAccumulateLengthPercentageLiterals,
  tryAddLengthPercentages as tryAddLengthPercentageLiterals,
  tryInterpolateLengthPercentages as tryInterpolateLengthPercentageLiterals,
  type LengthPercentageConsumerOptions, type LengthPercentageLiteral,
} from './numeric-literal/length-percentage';

/*
 * <length-percentage> = <length> | <percentage> | <math-function>
 */

export type LengthPercentageValue =
  LengthPercentageLiteral | MathValue<'length-percentage'>;

export function parseLengthPercentage(
  input: ParserInput,
  context: MathContext = {},
): LengthPercentageValue | null {
  return parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeLengthPercentage),
    context,
  );
}

export function createLengthPercentageConsumer(
  options: LengthPercentageConsumerOptions = {},
): TryComponentConsumer<LengthPercentageValue> {
  const tryConsumeLiteral = createLengthPercentageLiteralConsumer(options);
  const range = lengthPercentageRange(options);

  return oneOf(
    [
      one(tryConsumeLiteral),
      one(createMathValueConsumer({
        expectedType: 'length-percentage',
        percentHint: 'length',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => value,
  );
}

export const tryConsumeLengthPercentage = createLengthPercentageConsumer();

export const lengthPercentageDef: ValueDefinition<LengthPercentageValue, MathContext> = {
  tryConsume: tryConsumeLengthPercentage,
  resolve: resolveLengthPercentage,
  serialize: serializeLengthPercentage,
};

export function resolveLengthPercentage(
  value: LengthPercentageValue,
  stage: ValueStage,
  context: MathContext = {},
): LengthPercentageValue {
  const calculationContext = lengthPercentageCalculationContext(context);

  if (value.type === 'math') {
    return resolveMathValue(value, stage, calculationContext);
  }

  return resolveNumericLiteral(
    value,
    'length-percentage',
    stage,
    calculationContext,
  );
}

export function serializeLengthPercentage(
  value: LengthPercentageValue,
): string {
  return value.type === 'math'
    ? serializeMathValue(value)
    : serializeLengthPercentageLiteral(value);
}

export function addLengthPercentages(
  a: LengthPercentageValue,
  b: LengthPercentageValue,
  context: MathContext = {},
): LengthPercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryAddLengthPercentageLiterals(a, b);

    if (result !== null) {
      return result;
    }
  }

  const calculationContext = lengthPercentageCalculationContext(context);

  return addMathValues(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
  );
}

export function interpolateLengthPercentages(
  a: LengthPercentageValue,
  b: LengthPercentageValue,
  p: number,
  context: MathContext = {},
): LengthPercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryInterpolateLengthPercentageLiterals(a, b, p);

    if (result !== null) {
      return result;
    }
  }

  const calculationContext = lengthPercentageCalculationContext(context);

  return interpolateMathValues(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    p,
    calculationContext,
  );
}

export function accumulateLengthPercentages(
  a: LengthPercentageValue,
  b: LengthPercentageValue,
  context: MathContext = {},
): LengthPercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryAccumulateLengthPercentageLiterals(a, b);

    if (result !== null) {
      return result;
    }
  }

  const calculationContext = lengthPercentageCalculationContext(context);

  return accumulateMathValues(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
  );
}

function asMathValue(
  value: LengthPercentageValue,
  context: MathContext,
): MathValue<'length-percentage'> {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, 'length-percentage', context);
}

function lengthPercentageCalculationContext(
  context: MathContext,
): MathContext {
  return {
    ...context,
    percentHint: 'length',
  };
}

function lengthPercentageRange(
  options: LengthPercentageConsumerOptions,
): MathRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}
