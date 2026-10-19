import { adaptConsumer, type TokenCursor, type TryConsumer, type TryConsumerResult } from '../syntax/index';

import { createKeywordConsumer } from './keyword';

/*
 * auto
 */

export type AutoValue = {
  type: 'auto';
};

export function consumeAuto(
  c: TokenCursor,
): TryConsumerResult<AutoValue> {
  return autoConsumer(c);
}

export function serializeAuto(value: AutoValue): string {
  return value.type;
}

// auto
const autoConsumer: TryConsumer<AutoValue> = adaptConsumer(
  createKeywordConsumer('auto'),
  () => ({ type: 'auto' }),
);
