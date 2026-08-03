import { type ComponentCursor, type TryComponentConsumerResult } from '../parser/component-cursor';
import { withTrivia } from '../parser/component-grammar';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import type { ValueStage } from '../value-processing';
import { createKeywordConsumer } from './keyword';
import type { PropertyValue } from './property-value';

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
  resolve: (stage: ValueStage, context: Context) => PropertyValue<Value, Context>;
  serialize: () => string;
};

export function parseCssWideValue<Value = unknown, Context = unknown>(
  input: ParserInput,
  context: unknown = undefined,
): CssWideValue<Value, Context> | null {
  return parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeCssWideValue<Value, Context>),
    context,
  );
}

export function tryConsumeCssWideValue<Value = unknown, Context = unknown>(
  c: ComponentCursor,
): TryComponentConsumerResult<CssWideValue<Value, Context>> {
  const keyword = tryConsumeCssWideKeyword(c);

  if (keyword === null) return null;

  return createCssWideValue(keyword);
}

const tryConsumeCssWideKeyword = createKeywordConsumer(...CSS_WIDE_KEYWORDS);

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
