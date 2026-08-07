import { consumeIdentToken } from '../syntax/component-consumers';
import { serializeCssIdentifier } from '../syntax/component-value';
import {
  type TokenCursor, type TryConsumer, type TryConsumerResult,
} from '../syntax/token-cursor';
import { adaptConsumer, withTrivia } from '../syntax/component-grammar';
import { createComponentParser, type ParserInput } from '../syntax/parser';

/*
 * <ident> = <ident-token>
 */

export type IdentValue = {
  type: 'ident';
  value: string;
};

export function parseIdent(
  input: ParserInput,
  context: unknown = undefined,
): IdentValue | null {
  return identParser(input, context);
}

export function consumeIdent(
  c: TokenCursor,
): TryConsumerResult<IdentValue> {
  return identConsumer(c);
}

export function serializeIdent(value: IdentValue): string {
  return serializeCssIdentifier(value.value);
}

// <ident> = <ident-token>
const identConsumer: TryConsumer<IdentValue> = adaptConsumer(
  consumeIdentToken,
  (token) => ({
    type: 'ident',
    value: token.value,
  }),
);

const identParser = createComponentParser(withTrivia(identConsumer));
