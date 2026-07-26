import { clamp } from '../../shared/util';
import { one, oneOf, withComponentTrivia } from '../parser/component-grammar';
import {
  ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { isAtOrBeyondValueStage } from '../value-processing';
import type { CalculationContext } from './calc';
import {
  accumulateNumbers, addNumbers, interpolateNumbers,
  resolveNumber, serializeNumber, tryConsumeNumber,
  type NumberValue,
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
  context: CalculationContext = {},
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
  ([value]) => ok(value),
);

export function resolveOpacityValue(
  value: OpacityValue,
  context: CalculationContext = {},
): OpacityValue {
  const stage = context.stage ?? 'declared';
  const calculationContext: CalculationContext = {
    ...context,
    unwrapMathAt: context.unwrapMathAt ?? 'computed',
  };
  const resolved = isNumberOpacityValue(value)
    ? resolveNumber(value, calculationContext)
    : resolvePercentage(value, calculationContext);

  if (
    resolved.type === 'math' ||
    !isAtOrBeyondValueStage(stage, 'computed')
  ) {
    return resolved;
  }

  const number = resolved.type === 'percentage'
    ? resolved.value / 100
    : resolved.value;

  return {
    type: 'number',
    value: clamp(number, 0, 1),
  };
}

export function serializeOpacityValue(value: OpacityValue): string {
  if (value.type === 'percentage') {
    return serializeNumber({
      type: 'number',
      value: value.value / 100,
    });
  }

  return isNumberOpacityValue(value)
    ? serializeNumber(value)
    : serializePercentage(value);
}

export function addOpacities(
  a: NumberValue,
  b: NumberValue,
  context: CalculationContext = {},
): NumberValue {
  return addNumbers(a, b, context);
}

export function interpolateOpacities(
  a: NumberValue,
  b: NumberValue,
  p: number,
  context: CalculationContext = {},
): NumberValue {
  return interpolateNumbers(a, b, p, context);
}

export function accumulateOpacities(
  a: NumberValue,
  b: NumberValue,
  context: CalculationContext = {},
): NumberValue {
  return accumulateNumbers(a, b, context);
}

function isNumberOpacityValue(
  value: OpacityValue,
): value is NumberValue {
  return value.type === 'number' || (
    value.type === 'math' &&
    value.restrictions.expectedType === 'number'
  );
}
