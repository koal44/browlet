import { asciiLower } from '../../shared/css';
import type { ComponentCursor } from '../parser/component-cursor';
import { tryConsumeIdentToken } from '../parser/component-consumers';
import {
  isBad, ok,
  type TryComponentConsumer, type TryComponentConsumerResult,
} from '../parser/component-try-consumer';

export function createKeywordConsumer<
  const Keywords extends readonly [string, ...string[]],
>(
  ...keywords: Keywords
): TryComponentConsumer<Keywords[number]> {
  const normalized = keywords.map(
    (keyword) => [asciiLower(keyword), keyword] as const,
  );

  return (c: ComponentCursor): TryComponentConsumerResult<Keywords[number]> => {
    const start = c.pos();
    const ident = tryConsumeIdentToken(c);

    if (ident === null || isBad(ident)) {
      return ident;
    }

    const value = asciiLower(ident.value.value);

    for (const [text, keyword] of normalized) {
      if (value === text) {
        return ok(keyword);
      }
    }

    c.restore(start);
    return null;
  };
}
