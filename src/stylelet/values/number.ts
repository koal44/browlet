import {
  one, oneOf, withTrivia, createComponentParser,
  type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import type { ValueStage, ValueDefinition } from '../value-processing/index';
import {
  accumulateNumbers as accumulateNumberLiterals, addNumbers as addNumberLiterals,
  createNumberConsumer as createNumberLiteralConsumer, interpolateNumbers as interpolateNumberLiterals,
  serializeNumber as serializeNumberLiteral,
  type NumberConsumerOptions as NumberLiteralConsumerOptions, type NumberLiteral,
} from './numeric-literal/index';

import {
  accumulateMathValues, addMathValues, createMathValueConsumer, createMathValueFromLiteral,
  interpolateMathValues, resolveMathValue, serializeMathValue, type MathContext, type MathRange,
  type MathValue,
} from './math-value';

/*
 * <number> = <number-token> | <math-function>
 */

export type NumberValue = NumberLiteral | MathValue<'number'>;

export const numberDef: ValueDefinition<NumberValue, MathContext> = {
  consume: consumeNumber,
  resolve: resolveNumber,
  serialize: serializeNumber,
};

export function parseNumber(
  input: ParserInput,
  context: MathContext = {},
): NumberValue | null {
  return numberParser(input, context);
}

export function consumeNumber(
  c: TokenCursor,
): TryConsumerResult<NumberValue> {
  return numberConsumer(c);
}

export type NumberConsumerOptions = NumberLiteralConsumerOptions;

export function createNumberConsumer(
  options: NumberConsumerOptions = {},
): TryConsumer<NumberValue> {
  const literalConsumer = createNumberLiteralConsumer(options);
  const range = numberRange(options);

  return oneOf(
    [
      one(literalConsumer),
      one(createMathValueConsumer({
        expectedType: 'number',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => value,
  );
}

export function resolveNumber(
  value: NumberValue,
  stage: ValueStage,
  context: MathContext = {},
): NumberValue {
  if (value.type !== 'math') {
    return value;
  }

  return resolveMathValue(value, stage, context);
}

export function serializeNumber(
  value: NumberValue,
): string {
  return value.type === 'math'
    ? serializeMathValue(value)
    : serializeNumberLiteral(value);
}

export function addNumbers(
  a: NumberValue,
  b: NumberValue,
  context: MathContext = {},
): NumberValue {
  if (a.type === 'number' && b.type === 'number') {
    return addNumberLiterals(a, b);
  }

  return addMathValues(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

export function interpolateNumbers(
  a: NumberValue,
  b: NumberValue,
  p: number,
  context: MathContext = {},
): NumberValue {
  if (a.type === 'number' && b.type === 'number') {
    return interpolateNumberLiterals(a, b, p);
  }

  return interpolateMathValues(
    asMathValue(a, context),
    asMathValue(b, context),
    p,
    context,
  );
}

export function accumulateNumbers(
  a: NumberValue,
  b: NumberValue,
  context: MathContext = {},
): NumberValue {
  if (a.type === 'number' && b.type === 'number') {
    return accumulateNumberLiterals(a, b);
  }

  return accumulateMathValues(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

function asMathValue(
  value: NumberValue,
  context: MathContext,
): MathValue<'number'> {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, 'number', context);
}

function numberRange(
  options: NumberConsumerOptions,
): MathRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}

// <number> = <number-token> | <math-function>
const numberConsumer = createNumberConsumer();
const numberParser = createComponentParser(withTrivia(numberConsumer));
