import type { TryConsumer } from '../syntax/index';

import type { ValueStage } from './stage';

export type ValueDefinition<Value, Context = unknown> = {
  consume: TryConsumer<Value, Context>;
  resolve: (value: Value, stage: ValueStage, context: Context) => Value;
  serialize: (value: Value) => string;
  custom?: boolean;
};
