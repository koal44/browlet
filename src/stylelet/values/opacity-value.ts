import { clamp } from '../../shared/util';
import { one, oneOf, withTrivia } from '../syntax/component-grammar';
import { type TokenCursor, type TryConsumerResult } from '../syntax/token-cursor';
import { createComponentParser, type ParserInput } from '../syntax/parser';
import { ValueStage } from '../value-processing/stage';
import type { MathContext } from './math-value';
import {
  accumulateNumbers, addNumbers, interpolateNumbers, resolveNumber, serializeNumber,
  consumeNumber, type NumberValue,
} from './number';
import {
  resolvePercentage, serializePercentage, consumePercentage,
  type PercentageValue,
} from './percentage';

/*
 * <opacity-value> = <number> | <percentage>
 */

export type OpacityValue = NumberValue | PercentageValue;

export function parseOpacityValue(
  input: ParserInput,
  context: MathContext = {},
): OpacityValue | null {
  return opacityValueParser(input, context);
}

export function consumeOpacityValue(
  c: TokenCursor,
): TryConsumerResult<OpacityValue> {
  return opacityValueConsumer(c);
}

export function resolveOpacityValue(
  value: OpacityValue,
  stage: ValueStage,
  context: MathContext = {},
): OpacityValue {
  const mathContext: MathContext = {
    ...context,
    unwrapMathAt: context.unwrapMathAt ?? ValueStage.Computed,
  };
  const resolved = isNumberOpacityValue(value)
    ? resolveNumber(value, stage, mathContext)
    : resolvePercentage(value, stage, mathContext);

  if (resolved.type === 'math') {
    return resolved;
  }

  const number = resolved.type === 'percentage'
    ? resolved.value / 100
    : resolved.value;

  return {
    type: 'number',
    value: stage < ValueStage.Computed
      ? number
      : clamp(number, 0, 1),
  };
}

export function serializeOpacityValue(value: OpacityValue): string {
  return isNumberOpacityValue(value)
    ? serializeNumber(value)
    : serializePercentage(value);
}

export function addOpacities(
  a: NumberValue,
  b: NumberValue,
  context: MathContext = {},
): NumberValue {
  return addNumbers(a, b, context);
}

export function interpolateOpacities(
  a: NumberValue,
  b: NumberValue,
  p: number,
  context: MathContext = {},
): NumberValue {
  return interpolateNumbers(a, b, p, context);
}

export function accumulateOpacities(
  a: NumberValue,
  b: NumberValue,
  context: MathContext = {},
): NumberValue {
  return accumulateNumbers(a, b, context);
}

function isNumberOpacityValue(
  value: OpacityValue,
): value is NumberValue {
  return value.type === 'number' || (
    value.type === 'math' &&
    value.valueType === 'number'
  );
}

// <opacity-value> = <number> | <percentage>
const opacityValueConsumer = oneOf(
  [
    one(consumeNumber),
    one(consumePercentage),
  ],
  ([value]) => resolveOpacityValue(value, ValueStage.Declared),
);

const opacityValueParser = createComponentParser(withTrivia(opacityValueConsumer));
