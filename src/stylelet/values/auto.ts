import {
  type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult,
} from '../syntax/component-cursor';
import { adaptConsumer } from '../syntax/component-grammar';
import { createKeywordConsumer } from './keyword';

/*
 * auto
 */

export type AutoValue = {
  type: 'auto';
};

export function consumeAuto(
  c: ComponentCursor,
): TryComponentConsumerResult<AutoValue> {
  return autoConsumer(c);
}

export function serializeAuto(value: AutoValue): string {
  return value.type;
}

// auto
const autoConsumer: TryComponentConsumer<AutoValue> = adaptConsumer(
  createKeywordConsumer('auto'),
  () => ({ type: 'auto' }),
);
