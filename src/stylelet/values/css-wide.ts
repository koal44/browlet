import { singleIdentToken, type ComponentValue } from '../parser/syntax';

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

export function parseCssWideValue(components: readonly ComponentValue[]): CssWideValue | null {
  const token = singleIdentToken(components);
  if (token === null) return null;

  const keyword = token.value.toLowerCase();

  return isCssWideKeyword(keyword)
    ? { type: 'css-wide', keyword }
    : null;
}

export function isCssWideValue(value: unknown): value is CssWideValue {
  return !!value
    && typeof value === 'object'
    && (value as { type?: unknown; }).type === 'css-wide';
}

export function serializeCssWideValue(value: CssWideValue): string {
  return value.keyword;
}

function isCssWideKeyword(value: string): value is CssWideKeyword {
  return CSS_WIDE_KEYWORDS.some((keyword) => keyword === value);
}
