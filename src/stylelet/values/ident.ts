import { tryConsumeIdentToken } from '../parser/component-consumers';
import { serializeCssIdentifier } from '../parser/component-value';
import { type TryComponentConsumer } from '../parser/component-cursor';
import { adaptConsumer, withTrivia } from '../parser/component-grammar';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';

export type IdentValue = {
  type: 'ident';
  value: string;
};

export function parseIdent(
  input: ParserInput,
  context: unknown = undefined,
): IdentValue | null {
  return parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeIdent),
    context,
  );
}

export const tryConsumeIdent: TryComponentConsumer<IdentValue> = adaptConsumer(
  tryConsumeIdentToken,
  (token) => ({
    type: 'ident',
    value: token.value,
  }),
);

export function serializeIdent(value: IdentValue): string {
  return serializeCssIdentifier(value.value);
}
