import type { ComponentCursor } from '../parser/component-cursor';
import { asciiLower } from '../../utils/css';
import { consumeComponentTrivia, isIdentToken } from '../parser/syntax';

export function tryConsumeKeywordIn<K extends string>(
  c: ComponentCursor,
  keywords: readonly K[],
): K | null {
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
      return keyword;
    }
  }

  c.restore(start);
  return null;
}
