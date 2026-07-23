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
  accumulateIntegers as accumulateIntegerLiterals,
  addIntegers as addIntegerLiterals,
  createIntegerConsumer as createIntegerLiteralConsumer,
  interpolateIntegers as interpolateIntegerLiterals,
  serializeInteger as serializeIntegerLiteral,
  type IntegerConsumerOptions, type IntegerLiteral,
} from './numeric-literal/integer';

/*
 * <integer> = <integer-number-token> | <math-function>
 */

export type IntegerValue = IntegerLiteral | MathValue;

export function parseInteger(
  input: ParserInput,
  context: CalculationContext = {},
): IntegerValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeInteger),
      context,
    ),
    'integer',
  );
}

export function createIntegerConsumer(
  options: IntegerConsumerOptions = {},
): TryComponentConsumer<IntegerValue> {
  const tryConsumeLiteral = createIntegerLiteralConsumer(options);
  const range = integerRange(options);

  return oneOf(
    [
      one(tryConsumeLiteral),
      one(createMathValueConsumer({
        expectedType: 'integer',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => ok(value),
  );
}

export const tryConsumeInteger = createIntegerConsumer();

export function serializeInteger(
  value: IntegerValue,
  context: CalculationSerializationContext = {},
): string {
  return value.type === 'math'
    ? serializeMathValue(value, context)
    : serializeIntegerLiteral(value);
}

export function addIntegers(
  a: IntegerValue,
  b: IntegerValue,
  context: CalculationContext = {},
): IntegerValue {
  if (a.type === 'integer' && b.type === 'integer') {
    return addIntegerLiterals(a, b);
  }

  const calculationContext = integerCalculationContext(context);

  return addMathFunctions(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
  );
}

export function interpolateIntegers(
  a: IntegerValue,
  b: IntegerValue,
  p: number,
  context: CalculationContext = {},
): IntegerValue {
  if (a.type === 'integer' && b.type === 'integer') {
    return interpolateIntegerLiterals(a, b, p);
  }

  const calculationContext = integerCalculationContext(context);

  return interpolateMathFunctions(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    p,
    calculationContext,
  );
}

export function accumulateIntegers(
  a: IntegerValue,
  b: IntegerValue,
  context: CalculationContext = {},
): IntegerValue {
  if (a.type === 'integer' && b.type === 'integer') {
    return accumulateIntegerLiterals(a, b);
  }

  const calculationContext = integerCalculationContext(context);

  return accumulateMathFunctions(
    asMathValue(a, calculationContext),
    asMathValue(b, calculationContext),
    calculationContext,
  );
}

function asMathValue(
  value: IntegerValue,
  context: CalculationContext,
): MathValue {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, context);
}

function integerCalculationContext(
  context: CalculationContext,
): CalculationContext {
  return {
    ...context,
    expectedType: 'integer',
  };
}

function integerRange(
  options: IntegerConsumerOptions,
): CalculationRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}
