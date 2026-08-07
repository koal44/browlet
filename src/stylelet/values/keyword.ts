import { asciiLower } from '../../shared/css';
import { type TryConsumer } from '../syntax/token-cursor';
import { consumeIdentToken } from '../syntax/component-consumers';
import { adaptConsumer } from '../syntax/component-grammar';

export function createKeywordConsumer<
  const Keywords extends readonly [string, ...string[]],
>(
  ...keywords: Keywords
): TryConsumer<Keywords[number]> {
  const normalized = keywords.map(
    (keyword) => [asciiLower(keyword), keyword] as const,
  );

  return adaptConsumer(consumeIdentToken, (ident) => {
    const value = asciiLower(ident.value);

    for (const [text, keyword] of normalized) {
      if (value === text) {
        return keyword;
      }
    }

    return null;
  });
}
