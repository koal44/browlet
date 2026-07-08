import type { ComponentCursor } from '../parser/component-cursor';
import { asciiLower } from '../../utils/css';
import { consumeComponentTrivia, isIdentToken } from '../parser/syntax';
import {
  ok,
  type TryComponentParserResult,
} from '../parser/component-try-parser';

export function tryConsumeKeywordIn<K extends string>(
  c: ComponentCursor,
  keywords: readonly K[],
): TryComponentParserResult<K> {
  const start = c.pos();

  consumeComponentTrivia(c);

  const comp = c.next();

  if (!isIdentToken(comp)) {
    c.restore(start);
    return null;
  }

  const lower = asciiLower(comp.value);

  for (const keyword of keywords) {
    if (lower === keyword) {
      return ok(keyword);
    }
  }

  c.restore(start);
  return null;
}
