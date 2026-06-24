import type { ComponentCursor } from '../parser/component-cursor';
import { tryConsumeKeywordIn } from './keyword';

export type AutoValue = {
  type: 'auto';
};

export function tryParseAuto(c: ComponentCursor): AutoValue | null {
  const keyword = tryConsumeKeywordIn(c, ['auto'] as const);
  return keyword === null ? null : { type: 'auto' };
}
