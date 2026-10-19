import {
  consumeIdentToken, serializeCssIdentifier, adaptConsumer, withTrivia, createComponentParser,
  type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import type { ValueDefinition } from '../value-processing/index';

/*
 * <ident> = <ident-token>
 */

export type IdentValue = {
  type: 'ident';
  value: string;
};

export const identDef: ValueDefinition<IdentValue> = {
  consume: consumeIdent,
  resolve: resolveIdent,
  serialize: serializeIdent,
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

export function resolveIdent(value: IdentValue): IdentValue {
  return value;
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
