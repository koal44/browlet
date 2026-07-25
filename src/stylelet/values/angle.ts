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
import { accumulateDimensions, addDimensions, interpolateDimensions } from './numeric-literal/dimension';
import {
  createAngleConsumer as createAngleLiteralConsumer,
  serializeAngle as serializeAngleLiteral,
  type AngleConsumerOptions, type AngleLiteral,
} from './numeric-literal/angle';

/*
 * <angle> = <dimension-token with an angle unit> | <math-function>
 */

export type AngleValue = AngleLiteral | MathValue;

export function parseAngle(
  input: ParserInput,
  context: CalculationContext = {},
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

export function serializeAngle(
  value: AngleValue,
  context: CalculationSerializationContext = {},
): string {
  return value.type === 'math'
    ? serializeMathValue(value, context)
    : serializeAngleLiteral(value);
}

export function addAngles(
  a: AngleValue,
  b: AngleValue,
  context: CalculationContext = {},
): AngleValue {
  if (a.type === 'angle' && b.type === 'angle') {
    return addDimensions(a, b);
  }

  return addMathFunctions(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

export function interpolateAngles(
  a: AngleValue,
  b: AngleValue,
  p: number,
  context: CalculationContext = {},
): AngleValue {
  if (a.type === 'angle' && b.type === 'angle') {
    return interpolateDimensions(a, b, p);
  }

  return interpolateMathFunctions(
    asMathValue(a, context),
    asMathValue(b, context),
    p,
    context,
  );
}

export function accumulateAngles(
  a: AngleValue,
  b: AngleValue,
  context: CalculationContext = {},
): AngleValue {
  if (a.type === 'angle' && b.type === 'angle') {
    return accumulateDimensions(a, b);
  }

  return accumulateMathFunctions(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

function asMathValue(
  value: AngleValue,
  context: CalculationContext,
): MathValue {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, 'angle', context);
}

function angleRange(
  options: AngleConsumerOptions,
): CalculationRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}
