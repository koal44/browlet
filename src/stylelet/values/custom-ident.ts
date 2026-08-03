import { asciiLower } from '../../shared/css';
import { type ComponentCursor, type TryComponentConsumerResult } from '../parser/component-cursor';
import { withTrivia } from '../parser/component-grammar';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { CSS_WIDE_KEYWORDS } from './css-wide';
import { serializeIdentifier, tryConsumeIdent } from './ident';

export type CustomIdentValue = {
  type: 'custom-ident';
  value: string;
};

const RESERVED_CUSTOM_IDENT_KEYWORDS = [
  ...CSS_WIDE_KEYWORDS,
  'default',
] as const;

export function parseCustomIdent(
  input: ParserInput,
  excluded: readonly string[] = [],
  context: unknown = undefined,
): CustomIdentValue | null {
  return parseAsComponentGrammar(
    input,
    withTrivia((c) => tryConsumeCustomIdent(c, excluded)),
    context,
  );
}

export function tryConsumeCustomIdent(
  c: ComponentCursor,
  excluded: readonly string[] = [],
): TryComponentConsumerResult<CustomIdentValue> {
  const start = c.pos();
  const ident = tryConsumeIdent(c);

  if (ident === null) return null;

  const value = ident.value;
  const lower = asciiLower(value);

  for (const keyword of RESERVED_CUSTOM_IDENT_KEYWORDS) {
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
    value,
  };
}

export function serializeCustomIdent(value: CustomIdentValue): string {
  return serializeIdentifier(value.value);
}
