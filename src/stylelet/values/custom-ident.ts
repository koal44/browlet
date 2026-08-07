import { asciiLower } from '../../shared/css';
import {
  type TokenCursor, type TryConsumer, type TryConsumerResult,
} from '../syntax/token-cursor';
import { adaptConsumer, withTrivia } from '../syntax/component-grammar';
import { parseAsComponentGrammar, type ParserInput } from '../syntax/parser';
import { CSS_WIDE_KEYWORDS } from './css-wide';
import { serializeCssIdentifier } from '../syntax/component-value';
import { consumeIdent } from './ident';
import type { ValueDefinition } from '../value-processing/definition';

export type CustomIdentValue = {
  type: 'custom-ident';
  value: string;
};

export const customIdentDef: ValueDefinition<CustomIdentValue> = {
  consume: consumeCustomIdent,
  resolve: (value) => value,
  serialize: serializeCustomIdent,
};

const RESERVED_CUSTOM_IDENT_KEYWORDS: ReadonlySet<string> = new Set([
  ...CSS_WIDE_KEYWORDS,
  'default',
]);

export function parseCustomIdent(
  input: ParserInput,
  excluded: readonly string[] = [],
  context: unknown = undefined,
): CustomIdentValue | null {
  return parseAsComponentGrammar(
    input,
    withTrivia(createCustomIdentConsumer(excluded)),
    context,
  );
}

export function consumeCustomIdent(
  c: TokenCursor,
): TryConsumerResult<CustomIdentValue> {
  return customIdentConsumer(c);
}

export function createCustomIdentConsumer(
  excluded: readonly string[] = [],
): TryConsumer<CustomIdentValue> {
  const excludedKeywords = new Set(excluded.map(asciiLower));

  return adaptConsumer(consumeIdent, ({ value }) => {
    const lower = asciiLower(value);

    return RESERVED_CUSTOM_IDENT_KEYWORDS.has(lower) || excludedKeywords.has(lower)
      ? null
      : { type: 'custom-ident' as const, value };
  });
}

export function serializeCustomIdent(value: CustomIdentValue): string {
  return serializeCssIdentifier(value.value);
}

// <custom-ident>
const customIdentConsumer = createCustomIdentConsumer();
