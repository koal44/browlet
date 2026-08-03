import { isDelimToken, isTokenKind, type ComponentValue } from '../parser/component-value';
import { parseListOfComponentValues, type ParserInput } from '../parser/syntax';
import { TokenKind, type StaticToken } from '../parser/tokens';
import { isAnyValueComponents, type AnyValueComponent } from './any-value';

export type DeclarationValue = {
  type: 'declaration-value';
  components: DeclarationValueComponents;
};

export type DeclarationValueComponents = [
  DeclarationValueComponent,
  ...DeclarationValueComponent[],
];

export type DeclarationValueComponent = Exclude<
  AnyValueComponent,
  StaticToken<TokenKind.Semicolon>
>;

export function parseDeclarationValue(input: ParserInput): DeclarationValue | null {
  const components = parseListOfComponentValues(input);
  return isDeclarationValueComponents(components)
    ? { type: 'declaration-value', components }
    : null;
}

export function isDeclarationValueComponents(
  components: readonly ComponentValue[],
): components is DeclarationValueComponents {
  if (!isAnyValueComponents(components)) return false;

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
