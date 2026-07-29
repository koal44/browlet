import { one, oneOf, withComponentTrivia } from '../parser/component-grammar';
import {
  ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import type { ValueStage } from '../value-processing';
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
  createResolutionConsumer as createResolutionLiteralConsumer,
  serializeResolution as serializeResolutionLiteral, type ResolutionConsumerOptions,
  type ResolutionLiteral,
} from './numeric-literal/resolution';

/*
 * <resolution> =
 *   <nonnegative dimension-token with a resolution unit> | <math-function>
 */

export type ResolutionValue = ResolutionLiteral | MathValue<'resolution'>;

export function parseResolution(
  input: ParserInput,
  context: MathContext = {},
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
  stage: ValueStage,
  context: MathContext = {},
): ResolutionValue {
  return value.type === 'math'
    ? resolveMathValue(value, stage, context)
    : value;
}

export function serializeResolution(
  value: ResolutionValue,
): string {
  return value.type === 'math'
    ? serializeMathValue(value)
    : serializeResolutionLiteral(value);
}

export function addResolutions(
  a: ResolutionValue,
  b: ResolutionValue,
  context: MathContext = {},
): ResolutionValue {
  if (a.type === 'resolution' && b.type === 'resolution') {
    return addDimensions(a, b);
  }

  return addMathValues(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

export function interpolateResolutions(
  a: ResolutionValue,
  b: ResolutionValue,
  p: number,
  context: MathContext = {},
): ResolutionValue {
  if (a.type === 'resolution' && b.type === 'resolution') {
    return interpolateDimensions(a, b, p);
  }

  return interpolateMathValues(
    asMathValue(a, context),
    asMathValue(b, context),
    p,
    context,
  );
}

export function accumulateResolutions(
  a: ResolutionValue,
  b: ResolutionValue,
  context: MathContext = {},
): ResolutionValue {
  if (a.type === 'resolution' && b.type === 'resolution') {
    return accumulateDimensions(a, b);
  }

  return accumulateMathValues(
    asMathValue(a, context),
    asMathValue(b, context),
    context,
  );
}

function asMathValue(
  value: ResolutionValue,
  context: MathContext,
): MathValue<'resolution'> {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, 'resolution', context);
}

function resolutionRange(
  options: ResolutionConsumerOptions,
): MathRange {
  return [
    Math.max(0, options.min ?? -Infinity),
    options.max ?? Infinity,
  ];
}
