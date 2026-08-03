import { type TryComponentConsumer } from '../parser/component-cursor';

import type { ValueStage } from '../value-processing';
import type { PropertyValue } from './property-value';

export type WholeValue<Value, Context = unknown> = {
  type: 'whole-value';
  value: Value;
  resolve: (stage: ValueStage, context: Context) => PropertyValue<Value, Context>;
  serialize: () => string;
  add?: (value: Value, context: Context) => Value;
  accumulate?: (value: Value, context: Context) => Value;
  interpolate?: (value: Value, progress: number, context: Context) => Value;
};

export function createWholeValueConsumer<Value, Context = unknown>(
  tryConsumeValue: TryComponentConsumer<Value>,
  resolveValue: (value: Value, stage: ValueStage, context: Context) => Value,
  serializeValue: (value: Value) => string,
): TryComponentConsumer<WholeValue<Value, Context>> {
  return (c) => {
    const result = tryConsumeValue(c);

    if (result === null) return null;

    return createWholeValue(result, resolveValue, serializeValue);
  };
}

function createWholeValue<Value, Context>(
  value: Value,
  resolveValue: (value: Value, stage: ValueStage, context: Context) => Value,
  serializeValue: (value: Value) => string,
): WholeValue<Value, Context> {
  return {
    type: 'whole-value',
    value,
    resolve: (stage, context) => createWholeValue(
      resolveValue(value, stage, context),
      resolveValue,
      serializeValue,
    ),
    serialize: () => serializeValue(value),
  };
}
