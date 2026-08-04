import {
  type AtKeywordToken, type DelimToken, type DimensionToken, type HashToken, type IdentToken,
  type NumberToken, type PercentageToken, type StaticToken, type StringToken, type UrlToken,
  HashTokenFlag, TokenKind,
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
  let result = '';
  let previous = TokenSerializationType.Other;

  for (const value of values) {
    const next = firstTokenSerializationType(value);

    if (needsSeparator(previous, next)) result += '/**/';

    result += serializeComponentValue(value);
    previous = lastTokenSerializationType(value);
  }

  return result;
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
        return `${serializeCssIdentifier(value.name)}(${serializeComponentValues(value.value)})`;
    }
  }

  switch (value.kind) {
    case TokenKind.Ident:
      return serializeCssIdentifier(value.value);

    case TokenKind.AtKeyword:
      return `@${serializeCssIdentifier(value.value)}`;

    case TokenKind.Hash:
      return `#${value.flag === HashTokenFlag.Id
        ? serializeCssIdentifier(value.value)
        : serializeCssName(value.value)}`;

    case TokenKind.String:
      return serializeCssString(value.value);

    case TokenKind.BadString:
      return serializeBadStringToken();

    case TokenKind.Url:
      return serializeCssUrlToken(value.value);

    case TokenKind.BadUrl:
      return serializeBadUrlToken();

    case TokenKind.Delim:
      return serializeCssDelimToken(value.value);

    case TokenKind.Number:
      return value.repr;

    case TokenKind.Percentage:
      return value.repr;

    case TokenKind.Dimension:
      return value.repr;

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

export function serializeCssIdentifier(value: string): string {
  const characters = [...value];
  let result = '';

  for (let index = 0; index < characters.length; index++) {
    const character = characters[index]!;
    const codePoint = character.codePointAt(0)!;

    if (codePoint === 0) {
      result += '\uFFFD';
      continue;
    }

    if (
      (codePoint >= 0x01 && codePoint <= 0x1f) ||
      codePoint === 0x7f ||
      (index === 0 && isAsciiDigit(codePoint)) ||
      (
        index === 1 &&
        isAsciiDigit(codePoint) &&
        characters[0] === '-'
      )
    ) {
      result += `\\${codePoint.toString(16)} `;
      continue;
    }

    if (index === 0 && character === '-' && characters.length === 1) {
      result += '\\-';
      continue;
    }

    if (
      codePoint >= 0x80 ||
      character === '-' ||
      character === '_' ||
      isAsciiDigit(codePoint) ||
      isAsciiLetter(codePoint)
    ) {
      result += character;
      continue;
    }

    result += `\\${character}`;
  }

  return result;
}

export function serializeCssString(value: string): string {
  let result = '"';

  for (const character of value) {
    const codePoint = character.codePointAt(0)!;

    if (codePoint === 0) {
      result += '\uFFFD';
    } else if (
      (codePoint >= 0x01 && codePoint <= 0x1f) ||
      codePoint === 0x7f
    ) {
      result += `\\${codePoint.toString(16)} `;
    } else if (character === '"' || character === '\\') {
      result += `\\${character}`;
    } else {
      result += character;
    }
  }

  return `${result}"`;
}

function serializeCssName(value: string): string {
  let result = '';

  for (const character of value) {
    const codePoint = character.codePointAt(0)!;

    if (codePoint === 0) {
      result += '\uFFFD';
    } else if (
      (codePoint >= 0x01 && codePoint <= 0x1f) ||
      codePoint === 0x7f
    ) {
      result += `\\${codePoint.toString(16)} `;
    } else if (
      codePoint >= 0x80 ||
      character === '-' ||
      character === '_' ||
      isAsciiDigit(codePoint) ||
      isAsciiLetter(codePoint)
    ) {
      result += character;
    } else {
      result += `\\${character}`;
    }
  }

  return result;
}

function serializeCssUrlToken(value: string): string {
  let result = 'url(';

  for (const character of value) {
    const codePoint = character.codePointAt(0)!;

    if (codePoint <= 0x20 || codePoint === 0x7f) {
      result += `\\${codePoint.toString(16)} `;
    } else if (
      character === '(' ||
      character === ')' ||
      character === '"' ||
      character === "'" ||
      character === '\\'
    ) {
      result += `\\${character}`;
    } else {
      result += character;
    }
  }

  return `${result})`;
}

function serializeCssDelimToken(value: string): string {
  return value === '\\' ? '\\\n' : value;
}

export function serializeCssDimensionUnit(unit: string): string {
  const serialized = serializeCssIdentifier(unit);

  // Escape a leading e/E when adjoining the unit to a number would otherwise
  // turn the pair into scientific notation rather than a dimension token.
  if (/^[eE](?:[+-]?[0-9])/.test(unit)) {
    return `\\${unit.codePointAt(0)!.toString(16)} ${serialized.slice(1)}`;
  }

  return serialized;
}

function serializeBadStringToken(): string {
  return '"\n';
}

function serializeBadUrlToken(): string {
  return 'url(a")';
}

function isAsciiDigit(codePoint: number): boolean {
  return codePoint >= 0x30 && codePoint <= 0x39;
}

function isAsciiLetter(codePoint: number): boolean {
  return (
    (codePoint >= 0x41 && codePoint <= 0x5a) ||
    (codePoint >= 0x61 && codePoint <= 0x7a)
  );
}

function firstTokenSerializationType(value: ComponentValue): TokenSerializationType {
  if (value.type === 'block') {
    if (value.block === BlockKind.Function) return TokenSerializationType.Function;
    if (value.block === BlockKind.Parens) return TokenSerializationType.OpenParen;
    return TokenSerializationType.Other;
  }

  return tokenSerializationType(value);
}

function lastTokenSerializationType(value: ComponentValue): TokenSerializationType {
  return value.type === 'block'
    ? TokenSerializationType.Other
    : tokenSerializationType(value);
}

// CSS Syntax §9, token-pair serialization table.
function needsSeparator(
  before: TokenSerializationType,
  after: TokenSerializationType,
): boolean {
  switch (before) {
    case TokenSerializationType.Ident:
      return (
        after === TokenSerializationType.Ident ||
        after === TokenSerializationType.Function ||
        after === TokenSerializationType.Url ||
        after === TokenSerializationType.BadUrl ||
        after === TokenSerializationType.Hyphen ||
        after === TokenSerializationType.Number ||
        after === TokenSerializationType.Percentage ||
        after === TokenSerializationType.Dimension ||
        after === TokenSerializationType.CDC ||
        after === TokenSerializationType.OpenParen
      );

    case TokenSerializationType.AtKeyword:
    case TokenSerializationType.Hash:
    case TokenSerializationType.Dimension:
    case TokenSerializationType.HashDelim:
    case TokenSerializationType.Hyphen:
      return (
        after === TokenSerializationType.Ident ||
        after === TokenSerializationType.Function ||
        after === TokenSerializationType.Url ||
        after === TokenSerializationType.BadUrl ||
        after === TokenSerializationType.Hyphen ||
        after === TokenSerializationType.Number ||
        after === TokenSerializationType.Percentage ||
        after === TokenSerializationType.Dimension ||
        after === TokenSerializationType.CDC
      );

    case TokenSerializationType.Number:
      return (
        after === TokenSerializationType.Ident ||
        after === TokenSerializationType.Function ||
        after === TokenSerializationType.Url ||
        after === TokenSerializationType.BadUrl ||
        after === TokenSerializationType.Number ||
        after === TokenSerializationType.Percentage ||
        after === TokenSerializationType.Dimension ||
        after === TokenSerializationType.CDC ||
        after === TokenSerializationType.Percent
      );

    case TokenSerializationType.AtDelim:
      return (
        after === TokenSerializationType.Ident ||
        after === TokenSerializationType.Function ||
        after === TokenSerializationType.Url ||
        after === TokenSerializationType.BadUrl ||
        after === TokenSerializationType.Hyphen ||
        after === TokenSerializationType.CDC
      );

    case TokenSerializationType.Dot:
    case TokenSerializationType.Plus:
      return (
        after === TokenSerializationType.Number ||
        after === TokenSerializationType.Percentage ||
        after === TokenSerializationType.Dimension
      );

    case TokenSerializationType.Slash:
      return after === TokenSerializationType.Asterisk;

    default:
      return false;
  }
}

enum TokenSerializationType {
  Other,
  Ident,
  Function,
  Url,
  BadUrl,
  Hyphen,
  Number,
  Percentage,
  Dimension,
  CDC,
  OpenParen,
  Asterisk,
  Percent,
  AtKeyword,
  Hash,
  HashDelim,
  AtDelim,
  Dot,
  Plus,
  Slash,
}

function tokenSerializationType(value: PreservedToken): TokenSerializationType {
  switch (value.kind) {
    case TokenKind.Ident:
      return TokenSerializationType.Ident;

    case TokenKind.AtKeyword:
      return TokenSerializationType.AtKeyword;

    case TokenKind.Hash:
      return TokenSerializationType.Hash;

    case TokenKind.Url:
      return TokenSerializationType.Url;

    case TokenKind.BadUrl:
      return TokenSerializationType.BadUrl;

    case TokenKind.Number:
      return TokenSerializationType.Number;

    case TokenKind.Percentage:
      return TokenSerializationType.Percentage;

    case TokenKind.Dimension:
      return TokenSerializationType.Dimension;

    case TokenKind.CDC:
      return TokenSerializationType.CDC;

    case TokenKind.Delim:
      switch (value.value) {
        case '-': return TokenSerializationType.Hyphen;
        case '#': return TokenSerializationType.HashDelim;
        case '@': return TokenSerializationType.AtDelim;
        case '.': return TokenSerializationType.Dot;
        case '+': return TokenSerializationType.Plus;
        case '/': return TokenSerializationType.Slash;
        case '*': return TokenSerializationType.Asterisk;
        case '%': return TokenSerializationType.Percent;
      }
  }

  return TokenSerializationType.Other;
}
