import { asciiLower } from '../../utils/css';
import type { ComponentCursor } from '../parser/component-cursor';
import { consumeComponentTrivia } from '../parser/component';
import { isIdentToken } from '../parser/syntax';

export type CustomIdentValue = {
  type: 'custom-ident';
  value: string;
};

const CSS_WIDE_KEYWORDS = [
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
] as const;

export function tryParseCustomIdent(
  c: ComponentCursor,
  excluded: readonly string[] = [],
): CustomIdentValue | null {
  const start = c.pos();

  consumeComponentTrivia(c);

  const comp = c.next();

  if (!isIdentToken(comp)) {
    c.restore(start);
    return null;
  }

  const lower = asciiLower(comp.value);

  for (const keyword of CSS_WIDE_KEYWORDS) {
    if (lower === keyword) {
      c.restore(start);
      return null;
    }
  }

  for (const keyword of excluded) {
    if (lower === asciiLower(keyword)) {
      c.restore(start);
      return null;
    }
  }

  return {
    type: 'custom-ident',
    value: comp.value,
  };
}

export function serializeCustomIdent(value: CustomIdentValue): string {
  // This is intentionally minimal for now. We should replace this with a real
  // CSS identifier serializer when tests force escaping behavior.
  return value.value;
}
