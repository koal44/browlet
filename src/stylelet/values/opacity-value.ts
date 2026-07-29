import { clamp } from '../../shared/util';
import { one, oneOf, withComponentTrivia } from '../parser/component-grammar';
import {
  ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { ValueStage } from '../value-processing';
import type { MathContext } from './math-value';
import {
  accumulateNumbers, addNumbers, interpolateNumbers, resolveNumber, serializeNumber,
  tryConsumeNumber, type NumberValue,
} from './number';
import {
  resolvePercentage, serializePercentage, tryConsumePercentage,
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
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeOpacityValue),
      context,
    ),
    'opacity value',
  );
}

export const tryConsumeOpacityValue: TryComponentConsumer<OpacityValue> = oneOf(
  [
    one(tryConsumeNumber),
    one(tryConsumePercentage),
  ],
  ([value]) => ok(resolveOpacityValue(value, ValueStage.Declared)),
);

export function resolveOpacityValue(
  value: OpacityValue,
  stage: ValueStage,
  context: MathContext = {},
): OpacityValue {
  const calculationContext: MathContext = {
    ...context,
    unwrapMathAt: context.unwrapMathAt ?? ValueStage.Computed,
  };
  const resolved = isNumberOpacityValue(value)
    ? resolveNumber(value, stage, calculationContext)
    : resolvePercentage(value, stage, calculationContext);

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
