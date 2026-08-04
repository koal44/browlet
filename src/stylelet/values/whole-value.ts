import { type TryComponentConsumer } from '../parser/component-cursor';
import { adaptConsumer, withTrivia } from '../parser/component-grammar';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';

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

export type WholeValueParser<Value, Context = unknown> = (
  input: ParserInput,
) => WholeValue<Value, Context> | null;

export function createWholeValueParser<Value, Context = unknown>(
  tryConsumeValue: TryComponentConsumer<Value>,
  resolveValue: (value: Value, stage: ValueStage, context: Context) => Value,
  serializeValue: (value: Value) => string,
): WholeValueParser<Value, Context> {
  const tryConsumeWholeValue = createWholeValueConsumer(
    tryConsumeValue,
    resolveValue,
    serializeValue,
  );

  return (input) => parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeWholeValue),
  );
}

export function createWholeValueConsumer<Value, Context = unknown>(
  tryConsumeValue: TryComponentConsumer<Value>,
  resolveValue: (value: Value, stage: ValueStage, context: Context) => Value,
  serializeValue: (value: Value) => string,
): TryComponentConsumer<WholeValue<Value, Context>> {
  return adaptConsumer(
    tryConsumeValue,
    (value) => createWholeValue(value, resolveValue, serializeValue),
  );
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
