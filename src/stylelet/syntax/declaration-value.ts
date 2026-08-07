import {
  type TokenCursor, type TryConsumerResult,
} from './token-cursor';
import { isDelimToken, isTokenKind, type ComponentValue } from './component-value';
import { parseListOfComponentValues, type ParserInput } from './parser';
import { TokenKind, type StaticToken } from './tokens';
import {
  isAnyValueContents, consumeAnyValue, type AnyValueComponent,
} from './any-value';

/*
 * <declaration-value>
 */

export type DeclarationValue = {
  type: 'declaration-value';
  components: [DeclarationComponent, ...DeclarationComponent[]];
};

export type OptionalDeclarationValue = {
  type: 'declaration-value';
  components: DeclarationComponent[];
};

export type DeclarationComponent = Exclude<
  AnyValueComponent,
  StaticToken<TokenKind.Semicolon>
>;

export function parseDeclarationValue(input: ParserInput): DeclarationValue | null {
  const components = parseListOfComponentValues(input);
  if (isNonEmptyDeclarationValueContents(components)) {
    return { type: 'declaration-value', components: components };
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
    !isNonEmptyDeclarationValueContents(value.components)
  ) {
    c.restore(start);
    return null;
  }

  return { type: 'declaration-value', components: value.components };
}

export function parseOptionalDeclarationValue(
  input: ParserInput,
): OptionalDeclarationValue | null {
  const components = parseListOfComponentValues(input);
  return isDeclarationValueContents(components)
    ? { type: 'declaration-value', components }
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
      ? { type: 'declaration-value', components: [] }
      : null;
  }

  if (!isDeclarationValueContents(value.components)) {
    c.restore(start);
    return null;
  }

  return { type: 'declaration-value', components: value.components };
}

export function isDeclarationValueContents(
  components: readonly ComponentValue[],
): components is DeclarationComponent[] {
  if (!isAnyValueContents(components)) return false;

  for (const component of components) {
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
  components: readonly ComponentValue[],
): components is [DeclarationComponent, ...DeclarationComponent[]] {
  return components.length > 0 && isDeclarationValueContents(components);
}
