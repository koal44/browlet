import type { Cursor } from '../../selectlet/parser/cursor';
import { tryConsumeKeywordIn } from './keyword';

export type CssWideKeyword =
  | 'inherit'
  | 'initial'
  | 'unset'
  | 'revert'
  | 'revert-layer';

export type CssWideValue = {
  type: 'css-wide';
  keyword: CssWideKeyword;
};

const cssWideKeywords = [
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
] as const;

export function tryParseCssWideValue(c: Cursor): CssWideValue | null {
  const keyword = tryConsumeKeywordIn(c, cssWideKeywords);
  return keyword === null ? null : { type: 'css-wide', keyword };
}

export function isCssWideValue(value: unknown): value is CssWideValue {
  return !!value
    && typeof value === 'object'
    && (value as { type?: unknown; }).type === 'css-wide';
}

export function serializeCssWideValue(value: CssWideValue): string {
  return value.keyword;
}
