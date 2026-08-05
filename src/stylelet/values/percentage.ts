import { one, oneOf, withTrivia } from '../syntax/component-grammar';
import {
  type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult,
} from '../syntax/component-cursor';
import { createComponentParser, type ParserInput } from '../syntax/parser';
import type { ValueStage } from '../value-processing/stage';
import type { ValueDefinition } from '../value-processing/definition';
import {
  accumulateMathValues, addMathValues, createMathValueConsumer, createMathValueFromLiteral,
  interpolateMathValues, resolveMathValue, serializeMathValue, type MathContext, type MathRange,
  type MathValue,
} from './math-value';
import {
  accumulatePercentages as accumulatePercentageLiterals, addPercentages as addPercentageLiterals,
  createPercentageConsumer as createPercentageLiteralConsumer,
  interpolatePercentages as interpolatePercentageLiterals,
  serializePercentage as serializePercentageLiteral, type PercentageConsumerOptions,
  type PercentageLiteral,
} from './numeric-literal/percentage';

/*
 * <percentage> = <percentage-token> | <math-function>
 */

export type PercentageValue = PercentageLiteral | MathValue<'percentage'>;

export const percentageDef: ValueDefinition<PercentageValue, MathContext> = {
  consume: consumePercentage,
  resolve: resolvePercentage,
  serialize: serializePercentage,
};

export function parsePercentage(
  input: ParserInput,
  context: MathContext = {},
): PercentageValue | null {
  return percentageParser(input, context);
}

export function consumePercentage(
  c: ComponentCursor,
): TryComponentConsumerResult<PercentageValue> {
  return percentageConsumer(c);
}

export function createPercentageConsumer(
  options: PercentageConsumerOptions = {},
): TryComponentConsumer<PercentageValue> {
  const literalConsumer = createPercentageLiteralConsumer(options);
  const range = percentageRange(options);

  return oneOf(
    [
      one(literalConsumer),
      one(createMathValueConsumer({
        expectedType: 'percentage',
        percentHint: 'percent',
        ...(range === undefined ? {} : { range }),
      })),
    ],
    ([value]) => value,
  );
}

export function resolvePercentage(
  value: PercentageValue,
  stage: ValueStage,
  context: MathContext = {},
): PercentageValue {
  return value.type === 'math'
    ? resolveMathValue(value, stage, percentageMathContext(context))
    : value;
}

export function serializePercentage(
  value: PercentageValue,
): string {
  return value.type === 'math'
    ? serializeMathValue(value)
    : serializePercentageLiteral(value);
}

export function addPercentages(
  a: PercentageValue,
  b: PercentageValue,
  context: MathContext = {},
): PercentageValue {
  if (a.type === 'percentage' && b.type === 'percentage') {
    return addPercentageLiterals(a, b);
  }

  const mathContext = percentageMathContext(context);

  return addMathValues(
    asMathValue(a, mathContext),
    asMathValue(b, mathContext),
    mathContext,
  );
}

export function interpolatePercentages(
  a: PercentageValue,
  b: PercentageValue,
  p: number,
  context: MathContext = {},
): PercentageValue {
  if (a.type === 'percentage' && b.type === 'percentage') {
    return interpolatePercentageLiterals(a, b, p);
  }

  const mathContext = percentageMathContext(context);

  return interpolateMathValues(
    asMathValue(a, mathContext),
    asMathValue(b, mathContext),
    p,
    mathContext,
  );
}

export function accumulatePercentages(
  a: PercentageValue,
  b: PercentageValue,
  context: MathContext = {},
): PercentageValue {
  if (a.type === 'percentage' && b.type === 'percentage') {
    return accumulatePercentageLiterals(a, b);
  }

  const mathContext = percentageMathContext(context);

  return accumulateMathValues(
    asMathValue(a, mathContext),
    asMathValue(b, mathContext),
    mathContext,
  );
}

function asMathValue(
  value: PercentageValue,
  context: MathContext,
): MathValue<'percentage'> {
  return value.type === 'math'
    ? value
    : createMathValueFromLiteral(value, 'percentage', context);
}

function percentageMathContext(
  context: MathContext,
): MathContext {
  return {
    ...context,
    percentHint: 'percent',
    percentageReferenceValue: undefined,
  };
}

function percentageRange(
  options: PercentageConsumerOptions,
): MathRange | undefined {
  if (options.min === undefined && options.max === undefined) {
    return undefined;
  }

  return [
    options.min ?? -Infinity,
    options.max ?? Infinity,
  ];
}

// <percentage> = <percentage-token> | <math-function>
const percentageConsumer = createPercentageConsumer();
const percentageParser = createComponentParser(withTrivia(percentageConsumer));
