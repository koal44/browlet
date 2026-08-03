import { type TryComponentConsumer } from '../parser/component-cursor';
import { adaptConsumer } from '../parser/component-grammar';
import { createKeywordConsumer } from './keyword';

export type AutoValue = {
  type: 'auto';
};

export const tryConsumeAuto: TryComponentConsumer<AutoValue> = adaptConsumer(
  createKeywordConsumer('auto'),
  () => ({ type: 'auto' }),
);

export function serializeAuto(value: AutoValue): string {
  return value.type;
}
