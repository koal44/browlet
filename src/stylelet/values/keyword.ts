import { asciiLower } from '../../shared/css';
import { type TryComponentConsumer } from '../parser/component-cursor';
import { tryConsumeIdentToken } from '../parser/component-consumers';
import { adaptConsumer } from '../parser/component-grammar';

export function createKeywordConsumer<
  const Keywords extends readonly [string, ...string[]],
>(
  ...keywords: Keywords
): TryComponentConsumer<Keywords[number]> {
  const normalized = keywords.map(
    (keyword) => [asciiLower(keyword), keyword] as const,
  );

  return adaptConsumer(tryConsumeIdentToken, (ident) => {
    const value = asciiLower(ident.value);

    for (const [text, keyword] of normalized) {
      if (value === text) {
        return keyword;
      }
    }

    return null;
  });
}
