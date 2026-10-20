import { asciiLower } from '../../infra/ascii';

import {
  adaptConsumer, withTrivia, parseAsComponentGrammar, serializeCssIdentifier,
  type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import type { ValueDefinition } from '../value-processing/index';

import { CSS_WIDE_KEYWORDS } from './css-wide';
import { consumeIdent } from './ident';

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
  excluded: string[] = [],
  context: unknown,
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
  excluded: string[] = [],
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
