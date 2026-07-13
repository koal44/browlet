import {
  isDelimToken, isTokenKind, parseListOfComponentValues,
  type ComponentValue, type ParserInput,
} from '../parser/syntax';
import { TokenKind, type StaticToken } from '../parser/tokens';
import { isAnyValue, type AnyValueComponent } from './any-value';

export type DeclarationValue = [
  DeclarationValueComponent,
  ...DeclarationValueComponent[],
];

export type DeclarationValueComponent = Exclude<
  AnyValueComponent,
  StaticToken<TokenKind.Semicolon>
>;

export function parseDeclarationValue(input: ParserInput): DeclarationValue | null {
  const components = parseListOfComponentValues(input);
  return isDeclarationValue(components) ? components : null;
}

export function isDeclarationValue(
  components: readonly ComponentValue[],
): components is DeclarationValue {
  if (!isAnyValue(components)) return false;

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
