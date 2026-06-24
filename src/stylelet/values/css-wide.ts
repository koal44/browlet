import { singleIdentToken, type ComponentValue } from '../parser/syntax';

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

export function tryParseCssWideValue(components: readonly ComponentValue[]): CssWideValue | null {
  const token = singleIdentToken(components);
  if (token === null) return null;

  const keyword = token.value.toLowerCase();

  switch (keyword) {
    case 'inherit':
    case 'initial':
    case 'unset':
    case 'revert':
    case 'revert-layer':
      return { type: 'css-wide', keyword };

    default:
      return null;
  }
}

export function isCssWideValue(value: unknown): value is CssWideValue {
  return !!value
    && typeof value === 'object'
    && (value as { type?: unknown; }).type === 'css-wide';
}

export function serializeCssWideValue(value: CssWideValue): string {
  return value.keyword;
}
