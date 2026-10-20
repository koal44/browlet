import {
  type TokenCursor, type TryConsumerResult,
} from './token-cursor';
import { isDelimToken, isTokenKind, type ComponentValue } from './component-value';
import { parseListOfComponentValues, type ParserInput } from './parser';
import { createTokenList, TokenKind, type StaticToken, type TokenList, type NonEmptyTokenList } from './tokens';
import {
  isAnyValueContents, consumeAnyValue, type AnyValueComponent,
} from './any-value';

/*
 * <declaration-value>
 */
// https://drafts.csswg.org/css-syntax-3/#any-value

export type DeclarationValue = {
  type: 'declaration-value';
  components: NonEmptyTokenList<DeclarationComponent>;
};

export type OptionalDeclarationValue = {
  type: 'declaration-value';
  components: TokenList<DeclarationComponent>;
};

export type DeclarationComponent = Exclude<
  AnyValueComponent,
  StaticToken<TokenKind.Semicolon>
>;

export function parseDeclarationValue(input: ParserInput, context: unknown): DeclarationValue | null {
  const list = parseListOfComponentValues(input, context);
  if (isNonEmptyDeclarationValueContents(list)) {
    return { type: 'declaration-value', components: list };
  }
  return null;
}

// <declaration-value>
export function consumeDeclarationValue(
  c: TokenCursor,
): TryConsumerResult<DeclarationValue> {
  const start = c.pos();
  const value = consumeAnyValue(c);

  if (
    value === null ||
    !hasOnlyDeclarationComponents(value.components)
  ) {
    c.restore(start);
    return null;
  }

  return { type: 'declaration-value', components: value.components };
}

export function parseOptionalDeclarationValue(
  input: ParserInput,
  context: unknown,
): OptionalDeclarationValue | null {
  const list = parseListOfComponentValues(input, context);
  return isDeclarationValueContents(list)
    ? { type: 'declaration-value', components: list }
    : null;
}

// <declaration-value>?
export function consumeOptionalDeclarationValue(
  c: TokenCursor,
): TryConsumerResult<OptionalDeclarationValue> {
  const start = c.pos();
  const value = consumeAnyValue(c);

  if (value === null) {
    return c.peek().type === TokenKind.EOF
      ? { type: 'declaration-value', components: createTokenList(c.source.text) }
      : null;
  }

  if (!hasOnlyDeclarationComponents(value.components)) {
    c.restore(start);
    return null;
  }

  return { type: 'declaration-value', components: value.components };
}

export function isDeclarationValueContents(
  list: TokenList<ComponentValue>,
): list is TokenList<DeclarationComponent> {
  return isAnyValueContents(list) && hasOnlyDeclarationComponents(list);
}

/** Check the additional top-level restrictions on already validated <any-value> contents. */
function hasOnlyDeclarationComponents(list: NonEmptyTokenList<AnyValueComponent>): list is NonEmptyTokenList<DeclarationComponent>;
function hasOnlyDeclarationComponents(list: TokenList<AnyValueComponent>): list is TokenList<DeclarationComponent>;
function hasOnlyDeclarationComponents(
  list: TokenList<AnyValueComponent>,
): list is TokenList<DeclarationComponent> {
  for (const component of list.tokens) {
    if (
      isTokenKind(component, TokenKind.Semicolon) ||
      isDelimToken(component, '!')
    ) {
      return false;
    }
  }

  return true;
}

function isNonEmptyDeclarationValueContents(
  list: TokenList<ComponentValue>,
): list is NonEmptyTokenList<DeclarationComponent> {
  return list.tokens.length > 0 && isDeclarationValueContents(list);
}
