import {
  one, oneOf, withTrivia, createComponentParser,
  type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import { ValueStage, type ValueDefinition } from '../value-processing/index';
import {
  accumulateDimensions, addDimensions, interpolateDimensions, canonicalizeResolution,
  createResolutionConsumer as createResolutionLiteralConsumer,
  serializeResolution as serializeResolutionLiteral,
  type ResolutionConsumerOptions, type ResolutionLiteral,
} from './numeric-literal/index';

import {
  accumulateMathValues, addMathValues, createMathValueConsumer, createMathValueFromLiteral,
  interpolateMathValues, resolveMathValue, serializeMathValue, type MathContext, type MathRange,
  type MathValue,
} from './math-value';

/*
 * <resolution> =
 *   <nonnegative dimension-token with a resolution unit> | <math-function>
 */

export type ResolutionValue = ResolutionLiteral | MathValue<'resolution'>;

export const resolutionDef: ValueDefinition<ResolutionValue, MathContext> = {
  consume: consumeResolution,
  resolve: resolveResolution,
  serialize: serializeResolution,
};

export function parseResolution(
  input: ParserInput,
  context: MathContext = {},
): ResolutionValue | null {
  return resolutionParser(input, context);
}

export function consumeResolution(
  c: TokenCursor,
): TryConsumerResult<ResolutionValue> {
  return resolutionConsumer(c);
}

export function createResolutionConsumer(
  options: ResolutionConsumerOptions = {},
): TryConsumer<ResolutionValue> {
  const literalConsumer = createResolutionLiteralConsumer(options);

  return oneOf(
    [
      one(literalConsumer),
      one(createMathValueConsumer({
        expectedType: 'resolution',
        range: resolutionRange(options),
      })),
    ],
    ([value]) => value,
  );
}

export function resolveResolution(
  value: ResolutionValue,
  stage: ValueStage,
  context: MathContext = {},
): ResolutionValue {
  if (value.type === 'math') {
    return resolveMathValue(value, stage, context);
  }

  return stage < ValueStage.Computed
    ? value
    : canonicalizeResolution(value);
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

// <resolution> = <dimension-token with a resolution unit> | <math-function>
const resolutionConsumer = createResolutionConsumer();
const resolutionParser = createComponentParser(withTrivia(resolutionConsumer));
