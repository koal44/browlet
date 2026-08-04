import { asciiLower } from '../../shared/css';
import { type TryComponentConsumer } from '../parser/component-cursor';
import { adaptConsumer, withTrivia } from '../parser/component-grammar';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { CSS_WIDE_KEYWORDS } from './css-wide';
import { serializeCssIdentifier } from '../parser/component-value';
import { tryConsumeIdent } from './ident';

export type CustomIdentValue = {
  type: 'custom-ident';
  value: string;
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

export function createCustomIdentConsumer(
  excluded: readonly string[] = [],
): TryComponentConsumer<CustomIdentValue> {
  const excludedKeywords = new Set(excluded.map(asciiLower));

  return adaptConsumer(tryConsumeIdent, ({ value }) => {
    const lower = asciiLower(value);

    return RESERVED_CUSTOM_IDENT_KEYWORDS.has(lower) || excludedKeywords.has(lower)
      ? null
      : { type: 'custom-ident' as const, value };
  });
}

export const tryConsumeCustomIdent = createCustomIdentConsumer();

export function serializeCustomIdent(value: CustomIdentValue): string {
  return serializeCssIdentifier(value.value);
}
