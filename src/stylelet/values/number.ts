import { one, oneOf, withComponentTrivia } from '../parser/component-grammar';
import {
  ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import {
  accumulateMathFunctions, addMathFunctions, createMathValueFromLiteral,
  interpolateMathFunctions, serializeMathValue, tryConsumeMathValue,
  type CalculationContext, type CalculationSerializationContext,
  type MathValue,
} from './calc';
import {
  accumulateNumbers as accumulateNumberLiterals,
  addNumbers as addNumberLiterals,
  createNumberConsumer as createNumberLiteralConsumer,
  interpolateNumbers as interpolateNumberLiterals,
  serializeNumber as serializeNumberLiteral,
  type NumberConsumerOptions as NumberLiteralConsumerOptions,
  type NumberLiteral,
} from './numeric-literal/number';

/*
 * <number> = <number-token> | <math-function>
 */

export type NumberValue = NumberLiteral | MathValue;

export function parseNumber(
  input: ParserInput,
  context: CalculationContext = {},
): NumberValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeNumber),
      context,
    ),
    'number',
  );
}

export type NumberConsumerOptions = NumberLiteralConsumerOptions;

export function createNumberConsumer(
  options: NumberConsumerOptions = {},
): TryComponentConsumer<NumberValue> {
  const tryConsumeLiteral = createNumberLiteralConsumer(options);
  const range = numberRange(options);

  return oneOf(
    [
      one(tryConsumeLiteral),
      one(createMathNumberConsumer(range)),
    ],
    ([value]) => ok(value),
  );
}

export const tryConsumeNumber = createNumberConsumer();

export function serializeNumber(
  value: NumberValue,
  context: CalculationSerializationContext = {},
): string {
  return value.type === 'math'
    ? serializeMathValue(value, context)
    : serializeNumberLiteral(value);
}

export function addNumbers(
  a: NumberValue,
  b: NumberValue,
  context: CalculationContext = {},
): NumberValue {
  if (a.type === 'number' && b.type === 'number') {
    return addNumberLiterals(a, b);
  }

  return addMathFunctions(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

export function interpolateNumbers(
  a: NumberValue,
  b: NumberValue,
  p: number,
  context: CalculationContext = {},
): NumberValue {
  if (a.type === 'number' && b.type === 'number') {
    return interpolateNumberLiterals(a, b, p);
  }

  return interpolateMathFunctions(
    asMathValue(a, context),
    asMathValue(b, context),
    p,
    context,
  );
}

export function accumulateNumbers(
  a: NumberValue,
  b: NumberValue,
  context: CalculationContext = {},
): NumberValue {
  if (a.type === 'number' && b.type === 'number') {
    return accumulateNumberLiterals(a, b);
  }

  return accumulateMathFunctions(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

function asMathValue(
  value: NumberValue,
  context: CalculationContext,
): MathValue {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, context);
}

function createMathNumberConsumer(
  range: CalculationContext['range'],
): TryComponentConsumer<MathValue> {
  return (c) => {
    const outerContext = c.context;
    const calculationContext = outerContext === null || outerContext === undefined
      ? {}
      : outerContext as CalculationContext;

    try {
      c.context = {
        ...calculationContext,
        expectedType: 'number',
        ...(range === undefined ? {} : { range }),
      };

      return tryConsumeMathValue(c);
    } finally {
      c.context = outerContext;
    }
  };
}

function numberRange(
  options: NumberConsumerOptions,
): CalculationContext['range'] {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}
