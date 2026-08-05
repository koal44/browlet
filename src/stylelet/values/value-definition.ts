import type { TryComponentConsumer } from '../parser/component-cursor';
import type { ValueStage } from '../value-processing';

export type ValueDefinition<Value, Context = unknown> = {
  tryConsume: TryComponentConsumer<Value>;
  resolve: (value: Value, stage: ValueStage, context: Context) => Value;
  serialize: (value: Value) => string;
  parseAt?: ValueStage;
  onParseFailure?: 'guaranteed-invalid';
};
