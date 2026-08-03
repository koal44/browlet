import { asciiLower } from '../../shared/css';
import { type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult } from '../parser/component-cursor';
import { tryConsumeIdentToken } from '../parser/component-consumers';

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

    if (ident === null) return null;

    const value = asciiLower(ident.value);

    for (const [text, keyword] of normalized) {
      if (value === text) {
        return keyword;
      }
    }

    c.restore(start);
    return null;
  };
}
