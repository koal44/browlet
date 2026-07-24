import type { ComponentCursor } from '../parser/component-cursor';
import {
  ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumerResult,
} from '../parser/component-try-consumer';
import { createKeywordConsumer } from './keyword';

export type AutoValue = {
  type: 'auto';
};

export function tryConsumeAuto(c: ComponentCursor): TryComponentConsumerResult<AutoValue> {
  const keyword = unwrapConsumeResultOrThrow(
    tryConsumeAutoKeyword(c),
    'auto keyword',
  );

  if (keyword === null) {
    return null;
  }

  return ok({ type: 'auto' });
}

const tryConsumeAutoKeyword = createKeywordConsumer('auto');

export function serializeAuto(value: AutoValue): string {
  return value.type;
}
