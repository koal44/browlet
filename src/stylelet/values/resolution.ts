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
import { accumulateDimensions, addDimensions, interpolateDimensions } from './numeric-literal/dimension';
import {
  createResolutionConsumer as createResolutionLiteralConsumer,
  serializeResolution as serializeResolutionLiteral,
  type ResolutionConsumerOptions, type ResolutionLiteral,
} from './numeric-literal/resolution';

/*
 * <resolution> =
 *   <nonnegative dimension-token with a resolution unit> | <math-function>
 */

export type ResolutionValue = ResolutionLiteral | MathValue<'resolution'>;

export function parseResolution(
  input: ParserInput,
  context: CalculationContext = {},
): ResolutionValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeResolution),
      context,
    ),
    'resolution',
  );
}

export function createResolutionConsumer(
  options: ResolutionConsumerOptions = {},
): TryComponentConsumer<ResolutionValue> {
  const tryConsumeLiteral = createResolutionLiteralConsumer(options);

  return oneOf(
    [
      one(tryConsumeLiteral),
      one(createMathValueConsumer({
        expectedType: 'resolution',
        range: resolutionRange(options),
      })),
    ],
    ([value]) => ok(value),
  );
}

export const tryConsumeResolution = createResolutionConsumer();

export function resolveResolution(
  value: ResolutionValue,
  context: CalculationContext = {},
): ResolutionValue {
  return value.type === 'math'
    ? resolveMathValue(value, context)
    : value;
}

export function serializeResolution(
  value: ResolutionValue,
  context: CalculationSerializationContext = {},
): string {
  return value.type === 'math'
    ? serializeMathValue(value, context)
    : serializeResolutionLiteral(value);
}

export function addResolutions(
  a: ResolutionValue,
  b: ResolutionValue,
  context: CalculationContext = {},
): ResolutionValue {
  if (a.type === 'resolution' && b.type === 'resolution') {
    return addDimensions(a, b);
  }

  return addMathFunctions(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

export function interpolateResolutions(
  a: ResolutionValue,
  b: ResolutionValue,
  p: number,
  context: CalculationContext = {},
): ResolutionValue {
  if (a.type === 'resolution' && b.type === 'resolution') {
    return interpolateDimensions(a, b, p);
  }

  return interpolateMathFunctions(
    asMathValue(a, context),
    asMathValue(b, context),
    p,
    context,
  );
}

export function accumulateResolutions(
  a: ResolutionValue,
  b: ResolutionValue,
  context: CalculationContext = {},
): ResolutionValue {
  if (a.type === 'resolution' && b.type === 'resolution') {
    return accumulateDimensions(a, b);
  }

  return accumulateMathFunctions(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

function asMathValue(
  value: ResolutionValue,
  context: CalculationContext,
): MathValue<'resolution'> {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, 'resolution', context);
}

function resolutionRange(
  options: ResolutionConsumerOptions,
): CalculationRange {
  return [
    Math.max(0, options.min ?? -Infinity),
    options.max ?? Infinity,
  ];
}
