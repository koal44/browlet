import { type ComponentCursor, type TryComponentConsumerResult } from '../syntax/component-cursor';
import { withTrivia } from '../syntax/component-grammar';
import { parseAsComponentGrammar, type ParserInput } from '../syntax/parser';
import type { ValueStage } from '../value-processing/stage';
import { createKeywordConsumer } from './keyword';
import type { WholeValue } from './whole-value';

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

export type CssWideValue<Value = unknown, Context = unknown> = {
  type: 'css-wide';
  keyword: CssWideKeyword;
  resolve: (stage: ValueStage, context: Context) => WholeValue<Value, Context>;
  serialize: () => string;
};

export function parseCssWideValue<Value = unknown, Context = unknown>(
  input: ParserInput,
  context: unknown = undefined,
): CssWideValue<Value, Context> | null {
  return parseAsComponentGrammar(
    input,
    withTrivia(consumeCssWideValue<Value, Context>),
    context,
  );
}

export function consumeCssWideValue<Value, Context>(
  c: ComponentCursor,
): TryComponentConsumerResult<CssWideValue<Value, Context>> {
  const keyword = cssWideKeywordConsumer(c);

  if (keyword === null) return null;

  return createCssWideValue(keyword);
}

function createCssWideValue<Value, Context>(
  keyword: CssWideKeyword,
): CssWideValue<Value, Context> {
  const value: CssWideValue<Value, Context> = {
    type: 'css-wide',
    keyword,
    resolve: () => value,
    serialize: () => keyword,
  };

  return value;
}

// <css-wide-keyword> = inherit | initial | unset | revert | revert-layer
const cssWideKeywordConsumer = createKeywordConsumer(...CSS_WIDE_KEYWORDS);
