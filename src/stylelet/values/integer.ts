import { one, oneOf, withComponentTrivia } from '../parser/component-grammar';
import {
  ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import {
  accumulateMathValues, addMathValues, createMathValueConsumer, createMathValueFromLiteral,
  interpolateMathValues, resolveMathValue, serializeMathValue, type MathContext, type MathRange,
  type MathValue,
} from './math-value';
import {
  accumulateIntegers as accumulateIntegerLiterals, addIntegers as addIntegerLiterals,
  createIntegerConsumer as createIntegerLiteralConsumer,
  interpolateIntegers as interpolateIntegerLiterals, serializeInteger as serializeIntegerLiteral,
  type IntegerConsumerOptions, type IntegerLiteral,
} from './numeric-literal/integer';

/*
 * <integer> = <integer-number-token> | <math-function>
 */

export type IntegerValue = IntegerLiteral | MathValue<'integer'>;

export function parseInteger(
  input: ParserInput,
  context: MathContext = {},
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

export function resolveInteger(
  value: IntegerValue,
  context: MathContext = {},
): IntegerValue {
  return value.type === 'math'
    ? resolveMathValue(value, context)
    : value;
}

export function serializeInteger(
  value: IntegerValue,
): string {
  return value.type === 'math'
    ? serializeMathValue(value)
    : serializeIntegerLiteral(value);
}

export function addIntegers(
  a: IntegerValue,
  b: IntegerValue,
  context: MathContext = {},
): IntegerValue {
  if (a.type === 'integer' && b.type === 'integer') {
    return addIntegerLiterals(a, b);
  }

  return addMathValues(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

export function interpolateIntegers(
  a: IntegerValue,
  b: IntegerValue,
  p: number,
  context: MathContext = {},
): IntegerValue {
  if (a.type === 'integer' && b.type === 'integer') {
    return interpolateIntegerLiterals(a, b, p);
  }

  return interpolateMathValues(
    asMathValue(a, context),
    asMathValue(b, context),
    p,
    context,
  );
}

export function accumulateIntegers(
  a: IntegerValue,
  b: IntegerValue,
  context: MathContext = {},
): IntegerValue {
  if (a.type === 'integer' && b.type === 'integer') {
    return accumulateIntegerLiterals(a, b);
  }

  return accumulateMathValues(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

function asMathValue(
  value: IntegerValue,
  context: MathContext,
): MathValue<'integer'> {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, 'integer', context);
}

function integerRange(
  options: IntegerConsumerOptions,
): MathRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}
