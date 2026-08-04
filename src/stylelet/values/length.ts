import { one, oneOf, withTrivia } from '../parser/component-grammar';
import { type TryComponentConsumer } from '../parser/component-cursor';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { ValueStage } from '../value-processing';
import type { ValueDefinition } from './value-definition';
import {
  accumulateMathValues, addMathValues, createMathValueConsumer, createMathValueFromLiteral,
  interpolateMathValues, resolveMathValue, serializeMathValue, type MathContext, type MathRange,
  type MathValue,
} from './math-value';
import {
  accumulateDimensions, addDimensions,
  interpolateDimensions,
} from './numeric-literal/dimension';
import {
  createLengthConsumer as createLengthLiteralConsumer, serializeLength as serializeLengthLiteral,
  tryResolveLength, type LengthConsumerOptions, type LengthLiteral,
} from './numeric-literal/length';

/*
 * <length> =
 *   <dimension-token with a length unit> | <zero> | <math-function>
 */

export type LengthValue = LengthLiteral | MathValue<'length'>;

export function parseLength(
  input: ParserInput,
  context: MathContext = {},
): LengthValue | null {
  return parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeLength),
    context,
  );
}

export function createLengthConsumer(
  options: LengthConsumerOptions = {},
): TryComponentConsumer<LengthValue> {
  const tryConsumeLiteral = createLengthLiteralConsumer(options);
  const range = lengthRange(options);

  return oneOf(
    [
      one(tryConsumeLiteral),
      one(createMathValueConsumer({
        expectedType: 'length',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => value,
  );
}

export const tryConsumeLength = createLengthConsumer();

export const lengthDef: ValueDefinition<LengthValue, MathContext> = {
  tryConsume: tryConsumeLength,
  resolve: resolveLength,
  serialize: serializeLength,
};

export function resolveLength(
  value: LengthValue,
  stage: ValueStage,
  context: MathContext = {},
): LengthValue {
  if (value.type === 'math') {
    return resolveMathValue(value, stage, context);
  }

  if (stage < ValueStage.Computed) return value;

  return tryResolveLength(value, context.length) ?? value;
}

export function serializeLength(
  value: LengthValue,
): string {
  return value.type === 'math'
    ? serializeMathValue(value)
    : serializeLengthLiteral(value);
}

export function addLengths(
  a: LengthValue,
  b: LengthValue,
  context: MathContext = {},
): LengthValue {
  if (a.type === 'length' && b.type === 'length') {
    return addDimensions(a, b);
  }

  return addMathValues(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

export function interpolateLengths(
  a: LengthValue,
  b: LengthValue,
  p: number,
  context: MathContext = {},
): LengthValue {
  if (a.type === 'length' && b.type === 'length') {
    return interpolateDimensions(a, b, p);
  }

  return interpolateMathValues(
    asMathValue(a, context),
    asMathValue(b, context),
    p,
    context,
  );
}

export function accumulateLengths(
  a: LengthValue,
  b: LengthValue,
  context: MathContext = {},
): LengthValue {
  if (a.type === 'length' && b.type === 'length') {
    return accumulateDimensions(a, b);
  }

  return accumulateMathValues(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

function asMathValue(
  value: LengthValue,
  context: MathContext,
): MathValue<'length'> {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, 'length', context);
}


function lengthRange(
  options: LengthConsumerOptions,
): MathRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}
