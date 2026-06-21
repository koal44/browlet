import type { Cursor } from '../../selectlet/parser/cursor';
import { consumeIdent } from '../../selectlet/parser/lex';
import { asciiLower } from '../../utils/css';

export function tryConsumeKeywordIn<K extends string>(c: Cursor, keywords: readonly K[]): K | null {
  const start = c.pos();

  if (!canStartAnyKeyword(c.peek(), keywords)) return null;

  const raw = consumeIdent(c);
  const lower = raw.toLowerCase();

  for (const keyword of keywords) {
    if (lower === keyword) return keyword;
  }

  c.restore(start);
  return null;
}

function canStartAnyKeyword(ch: string, keywords: readonly string[]): boolean {
  if (!ch) return false;

  // Allow escaped keyword starts, e.g. \61 uto for auto.
  if (ch === '\\') return true;

  const lower = asciiLower(ch);

  for (const keyword of keywords) {
    if (keyword && asciiLower(keyword[0]) === lower) {
      return true;
    }
  }

  return false;
}


