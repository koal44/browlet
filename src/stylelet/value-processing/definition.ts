import type { TryComponentConsumer } from '../syntax/component-cursor';
import type { ValueStage } from './stage';

export type ValueDefinition<Value, Context = unknown> = {
  consume: TryComponentConsumer<Value>;
  resolve: (value: Value, stage: ValueStage, context: Context) => Value;
  serialize: (value: Value) => string;
  custom?: boolean;
};
