import { asciiLower } from '../../utils/css';
import type { ComponentCursor } from '../parser/component-cursor';
import { withComponentTrivia } from '../parser/component-grammar';
import {
  isIdentToken, parseAsComponentGrammar,
  type ParserInput,
} from '../parser/syntax';
import {
  ok,
  unwrapParseResultOrThrow,
  type TryComponentParserResult,
} from '../parser/component-try-parser';

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

export function parseCustomIdent(
  input: ParserInput,
  excluded: readonly string[] = [],
  context: unknown = undefined,
): CustomIdentValue | null {
  return unwrapParseResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia((c) => tryConsumeCustomIdent(c, excluded)),
      context,
    ),
    'custom ident',
  );
}

export function tryConsumeCustomIdent(
  c: ComponentCursor,
  excluded: readonly string[] = [],
): TryComponentParserResult<CustomIdentValue> {
  const start = c.pos();
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

  return ok({
    type: 'custom-ident',
    value: comp.value,
  });
}

export function serializeCustomIdent(value: CustomIdentValue): string {
  // This is intentionally minimal for now. We should replace this with a real
  // CSS identifier serializer when tests force escaping behavior.
  return value.value;
}
