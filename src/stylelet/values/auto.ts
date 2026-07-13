import type { ComponentCursor } from '../parser/component-cursor';
import {
  ok,
  unwrapConsumeResultOrThrow,
  type TryComponentConsumerResult,
} from '../parser/component-try-consumer';
import { tryConsumeKeywordIn } from './keyword';

export type AutoValue = {
  type: 'auto';
};

export function tryConsumeAuto(c: ComponentCursor): TryComponentConsumerResult<AutoValue> {
  const keyword = unwrapConsumeResultOrThrow(
    tryConsumeKeywordIn(c, ['auto'] as const),
    'auto keyword',
  );

  if (keyword === null) {
    return null;
  }

  return ok({ type: 'auto' });
}
