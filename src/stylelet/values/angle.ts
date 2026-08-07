import { one, oneOf, withTrivia } from '../syntax/component-grammar';
import {
  type TokenCursor, type TryConsumer, type TryConsumerResult,
} from '../syntax/token-cursor';
import { createComponentParser, type ParserInput } from '../syntax/parser';
import { ValueStage } from '../value-processing/stage';
import type { ValueDefinition } from '../value-processing/definition';
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
  canonicalizeAngle, createAngleConsumer as createAngleLiteralConsumer,
  serializeAngle as serializeAngleLiteral, type AngleConsumerOptions, type AngleLiteral,
} from './numeric-literal/angle';

/*
 * <angle> = <dimension-token with an angle unit> | <math-function>
 */

export type AngleValue = AngleLiteral | MathValue<'angle'>;

export const angleDef: ValueDefinition<AngleValue, MathContext> = {
  consume: consumeAngle,
  resolve: resolveAngle,
  serialize: serializeAngle,
};

export function parseAngle(
  input: ParserInput,
  context: MathContext = {},
): AngleValue | null {
  return angleParser(input, context);
}

export function consumeAngle(
  c: TokenCursor,
): TryConsumerResult<AngleValue> {
  return angleConsumer(c);
}

export function createAngleConsumer(
  options: AngleConsumerOptions = {},
): TryConsumer<AngleValue> {
  const literalConsumer = createAngleLiteralConsumer(options);
  const range = angleRange(options);

  return oneOf(
    [
      one(literalConsumer),
      one(createMathValueConsumer({
        expectedType: 'angle',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => value,
  );
}

export function resolveAngle(
  value: AngleValue,
  stage: ValueStage,
  context: MathContext = {},
): AngleValue {
  if (value.type === 'math') {
    return resolveMathValue(value, stage, context);
  }

  return stage < ValueStage.Computed
    ? value
    : canonicalizeAngle(value);
}

export function serializeAngle(
  value: AngleValue,
): string {
  return value.type === 'math'
    ? serializeMathValue(value)
    : serializeAngleLiteral(value);
}

export function addAngles(
  a: AngleValue,
  b: AngleValue,
  context: MathContext = {},
): AngleValue {
  if (a.type === 'angle' && b.type === 'angle') {
    return addDimensions(a, b);
  }

  return addMathValues(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

export function interpolateAngles(
  a: AngleValue,
  b: AngleValue,
  p: number,
  context: MathContext = {},
): AngleValue {
  if (a.type === 'angle' && b.type === 'angle') {
    return interpolateDimensions(a, b, p);
  }

  return interpolateMathValues(
    asMathValue(a, context),
    asMathValue(b, context),
    p,
    context,
  );
}

export function accumulateAngles(
  a: AngleValue,
  b: AngleValue,
  context: MathContext = {},
): AngleValue {
  if (a.type === 'angle' && b.type === 'angle') {
    return accumulateDimensions(a, b);
  }

  return accumulateMathValues(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

function asMathValue(
  value: AngleValue,
  context: MathContext,
): MathValue<'angle'> {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, 'angle', context);
}

function angleRange(
  options: AngleConsumerOptions,
): MathRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}

// <angle> = <dimension-token with an angle unit> | <math-function>
const angleConsumer = createAngleConsumer();
const angleParser = createComponentParser(withTrivia(angleConsumer));
