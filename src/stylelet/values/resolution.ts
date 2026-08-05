import { one, oneOf, withTrivia } from '../syntax/component-grammar';
import {
  type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult,
} from '../syntax/component-cursor';
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
  canonicalizeResolution, createResolutionConsumer as createResolutionLiteralConsumer,
  serializeResolution as serializeResolutionLiteral, type ResolutionConsumerOptions,
  type ResolutionLiteral,
} from './numeric-literal/resolution';

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
  c: ComponentCursor,
): TryComponentConsumerResult<ResolutionValue> {
  return resolutionConsumer(c);
}

export function createResolutionConsumer(
  options: ResolutionConsumerOptions = {},
): TryComponentConsumer<ResolutionValue> {
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
