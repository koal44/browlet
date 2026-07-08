import type { ComponentCursor } from '../parser/component-cursor';
import {
  ok,
  unwrapParseResultOrThrow,
  type TryComponentParserResult,
} from '../parser/component-try-parser';
import { tryConsumeKeywordIn } from './keyword';

export type AutoValue = {
  type: 'auto';
};

export function tryParseAuto(c: ComponentCursor): TryComponentParserResult<AutoValue> {
  const keyword = unwrapParseResultOrThrow(
    tryConsumeKeywordIn(c, ['auto'] as const),
    'auto keyword',
  );

  if (keyword === null) {
    return null;
  }

  return ok({ type: 'auto' });
}
