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
  context: CalculationContext = {},
): LengthPercentageValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeLengthPercentage),
      context,
    ),
    'length-percentage',
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
        percentageType: 'length',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => ok(value),
  );
}

export const tryConsumeLengthPercentage = createLengthPercentageConsumer();

export function resolveLengthPercentage(
  value: LengthPercentageValue,
  context: CalculationContext = {},
): LengthPercentageValue {
  return value.type === 'math'
    ? resolveMathValue(value, lengthPercentageCalculationContext(context))
    : value;
}

export function serializeLengthPercentage(
  value: LengthPercentageValue,
  context: CalculationSerializationContext = {},
): string {
  return value.type === 'math'
    ? serializeMathValue(value, context)
    : serializeLengthPercentageLiteral(value);
}

export function addLengthPercentages(
  a: LengthPercentageValue,
  b: LengthPercentageValue,
  context: CalculationContext = {},
): LengthPercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryAddLengthPercentageLiterals(a, b);

    if (result !== null) {
      return result;
    }
  }

  const calculationContext = lengthPercentageCalculationContext(context);

  return addMathFunctions(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
  );
}

export function interpolateLengthPercentages(
  a: LengthPercentageValue,
  b: LengthPercentageValue,
  p: number,
  context: CalculationContext = {},
): LengthPercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryInterpolateLengthPercentageLiterals(a, b, p);

    if (result !== null) {
      return result;
    }
  }

  const calculationContext = lengthPercentageCalculationContext(context);

  return interpolateMathFunctions(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    p,
    calculationContext,
  );
}

export function accumulateLengthPercentages(
  a: LengthPercentageValue,
  b: LengthPercentageValue,
  context: CalculationContext = {},
): LengthPercentageValue {
  if (a.type !== 'math' && b.type !== 'math') {
    const result = tryAccumulateLengthPercentageLiterals(a, b);

    if (result !== null) {
      return result;
    }
  }

  const calculationContext = lengthPercentageCalculationContext(context);

  return accumulateMathFunctions(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
  );
}

function asMathValue(
  value: LengthPercentageValue,
  context: CalculationContext,
): MathValue<'length-percentage'> {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, 'length-percentage', context);
}

function lengthPercentageCalculationContext(
  context: CalculationContext,
): CalculationContext {
  return {
    ...context,
    percentageType: 'length',
  };
}

function lengthPercentageRange(
  options: LengthPercentageConsumerOptions,
): CalculationRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}
