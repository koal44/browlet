import { type ComponentCursor, type TryComponentConsumerResult } from '../parser/component-cursor';
import { createKeywordConsumer } from './keyword';

export type AutoValue = {
  type: 'auto';
};

export function tryConsumeAuto(c: ComponentCursor): TryComponentConsumerResult<AutoValue> {
  const keyword = tryConsumeAutoKeyword(c);

  if (keyword === null) {
    return null;
  }

  return { type: 'auto' };
}

const tryConsumeAutoKeyword = createKeywordConsumer('auto');

export function serializeAuto(value: AutoValue): string {
  return value.type;
}
