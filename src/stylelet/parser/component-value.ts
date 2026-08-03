import { serializeCssString } from '../values/string';
import {
  type AtKeywordToken, type DelimToken, type DimensionToken, type HashToken, type IdentToken,
  type NumberToken, type PercentageToken, type StaticToken, type StringToken, type UrlToken,
  TokenKind,
} from './tokens';

export enum BlockKind {
  Brace = 1,
  Bracket,
  Parens,
  Function,
}

export type ComponentValue =
  | PreservedToken
  | ComponentBlock;

export type PreservedToken =
  | IdentToken
  | AtKeywordToken
  | HashToken
  | StringToken
  | StaticToken<TokenKind.BadString>
  | UrlToken
  | StaticToken<TokenKind.BadUrl>
  | DelimToken
  | NumberToken
  | PercentageToken
  | DimensionToken
  | StaticToken<TokenKind.Whitespace>
  | StaticToken<TokenKind.CDO>
  | StaticToken<TokenKind.CDC>
  | StaticToken<TokenKind.Colon>
  | StaticToken<TokenKind.Semicolon>
  | StaticToken<TokenKind.Comma>
  | StaticToken<TokenKind.RightBracket>
  | StaticToken<TokenKind.RightParen>
  | StaticToken<TokenKind.RightBrace>;

export type ComponentBlock =
  | SimpleBlock<ComponentValue[]>
  | FunctionBlock<ComponentValue[]>;

export type SimpleBlock<Contents = ComponentValue[]> =
  | BraceBlock<Contents>
  | BracketBlock<Contents>
  | ParensBlock<Contents>;

export type SimpleBlockKind =
  | BlockKind.Brace
  | BlockKind.Bracket
  | BlockKind.Parens;

export type BraceBlock<Contents = ComponentValue[]> = {
  type: 'block';
  block: BlockKind.Brace;
  value: Contents;
};

export type BracketBlock<Contents = ComponentValue[]> = {
  type: 'block';
  block: BlockKind.Bracket;
  value: Contents;
};

export type ParensBlock<Contents = ComponentValue[]> = {
  type: 'block';
  block: BlockKind.Parens;
  value: Contents;
};

export type FunctionBlock<Contents = ComponentValue[]> = {
  type: 'block';
  block: BlockKind.Function;
  name: string;
  value: Contents;
};

type PreservedTokenKind = PreservedToken['kind'];

export function isTokenKind<K extends PreservedTokenKind>(
  component: ComponentValue | null,
  kind: K,
): component is Extract<PreservedToken, { kind: K; }> {
  return component !== null && component.type === 'token' && component.kind === kind;
}

export function isIdentToken(component: ComponentValue | null): component is IdentToken {
  return isTokenKind(component, TokenKind.Ident);
}

export function isDelimToken(component: ComponentValue | null, delim: string): component is DelimToken {
  return isTokenKind(component, TokenKind.Delim) && component.value === delim;
}

export function isWhitespaceToken(
  component: ComponentValue | null,
): component is StaticToken<TokenKind.Whitespace> {
  return isTokenKind(component, TokenKind.Whitespace);
}

export function isComponentBlock(component: ComponentValue | null): component is ComponentBlock {
  return component !== null && component.type === 'block';
}

export function isBlockKind<K extends BlockKind>(
  component: ComponentValue | null,
  block: K,
): component is ComponentBlock & { block: K; } {
  return isComponentBlock(component) && component.block === block;
}

export function isBraceBlock(component: ComponentValue | null): component is BraceBlock {
  return isBlockKind(component, BlockKind.Brace);
}

export function isBracketBlock(component: ComponentValue | null): component is BracketBlock {
  return isBlockKind(component, BlockKind.Bracket);
}

export function isParensBlock(component: ComponentValue | null): component is ParensBlock {
  return isBlockKind(component, BlockKind.Parens);
}

export function isFunctionBlock(component: ComponentValue | null): component is FunctionBlock {
  return isBlockKind(component, BlockKind.Function);
}

export function serializeComponentValues(values: readonly ComponentValue[]): string {
  return values.map(serializeComponentValue).join('').trim();
}

function serializeComponentValue(value: ComponentValue): string {
  if (value.type === 'block') {
    switch (value.block) {
      case BlockKind.Brace:
        return `{${serializeComponentValues(value.value)}}`;

      case BlockKind.Bracket:
        return `[${serializeComponentValues(value.value)}]`;

      case BlockKind.Parens:
        return `(${serializeComponentValues(value.value)})`;

      case BlockKind.Function:
        return `${value.name}(${serializeComponentValues(value.value)})`;
    }
  }

  switch (value.kind) {
    case TokenKind.Ident:
      return value.value;

    case TokenKind.AtKeyword:
      return `@${value.value}`;

    case TokenKind.Hash:
      return `#${value.value}`;

    case TokenKind.String:
      return serializeCssString(value.value);

    case TokenKind.BadString:
      return '';

    case TokenKind.Url:
      return `url(${serializeCssString(value.value)})`;

    case TokenKind.BadUrl:
      return '';

    case TokenKind.Delim:
      return value.value;

    case TokenKind.Number:
      return value.repr;

    case TokenKind.Percentage:
      return `${value.repr}%`;

    case TokenKind.Dimension:
      return `${value.repr}${value.unit}`;

    case TokenKind.Whitespace:
      return ' ';

    case TokenKind.CDO:
      return '<!--';

    case TokenKind.CDC:
      return '-->';

    case TokenKind.Colon:
      return ':';

    case TokenKind.Semicolon:
      return ';';

    case TokenKind.Comma:
      return ',';

    case TokenKind.RightBracket:
      return ']';

    case TokenKind.RightParen:
      return ')';

    case TokenKind.RightBrace:
      return '}';
  }
}
