import { one, oneOf, withComponentTrivia } from '../parser/component-grammar';
import {
  ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import {
  accumulateMathValues, addMathValues,
  createMathValueConsumer, createMathValueFromLiteral,
  interpolateMathValues, resolveMathValue, serializeMathValue,
  type MathContext, type MathRange, type MathValue,
} from './math-value';
import { accumulateDimensions, addDimensions, interpolateDimensions } from './numeric-literal/dimension';
import {
  createAngleConsumer as createAngleLiteralConsumer,
  serializeAngle as serializeAngleLiteral,
  type AngleConsumerOptions, type AngleLiteral,
} from './numeric-literal/angle';

/*
 * <angle> = <dimension-token with an angle unit> | <math-function>
 */

export type AngleValue = AngleLiteral | MathValue<'angle'>;

export function parseAngle(
  input: ParserInput,
  context: MathContext = {},
): AngleValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeAngle),
      context,
    ),
    'angle',
  );
}

export function createAngleConsumer(
  options: AngleConsumerOptions = {},
): TryComponentConsumer<AngleValue> {
  const tryConsumeLiteral = createAngleLiteralConsumer(options);
  const range = angleRange(options);

  return oneOf(
    [
      one(tryConsumeLiteral),
      one(createMathValueConsumer({
        expectedType: 'angle',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => ok(value),
  );
}

export const tryConsumeAngle = createAngleConsumer();

export function resolveAngle(
  value: AngleValue,
  context: MathContext = {},
): AngleValue {
  return value.type === 'math'
    ? resolveMathValue(value, context)
    : value;
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
