import {
  withTrivia, parseAsComponentGrammar,
  type TokenCursor, type TryConsumerResult, type ParserInput,
} from '../syntax/index';

import { createKeywordConsumer } from './keyword';

/*
 * CSS-wide keywords:
 * inherit | initial | unset | revert | revert-layer
 */

export const CSS_WIDE_KEYWORDS = [
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
] as const;

export type CssWideKeyword = (typeof CSS_WIDE_KEYWORDS)[number];

export type CssWideValue = {
  type: 'css-wide';
  keyword: CssWideKeyword;
};

export function parseCssWideValue(
  input: ParserInput,
  context: unknown,
): CssWideValue | null {
  return parseAsComponentGrammar(
    input,
    withTrivia(consumeCssWideValue),
    context,
  );
}

export function consumeCssWideValue(
  c: TokenCursor,
): TryConsumerResult<CssWideValue> {
  const keyword = cssWideKeywordConsumer(c);

  if (keyword === null) return null;

  return { type: 'css-wide', keyword };
}

// <css-wide-keyword> = inherit | initial | unset | revert | revert-layer
const cssWideKeywordConsumer = createKeywordConsumer(...CSS_WIDE_KEYWORDS);
