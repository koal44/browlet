import {
  HashTokenFlag, NumericSign, NumberTokenFlag, TokenKind,
  type BlockKind, type BraceBlock, type BracketBlock, type ComponentBlock, type ComponentValue,
  type DelimToken, type FunctionBlock, type IdentToken, type ParensBlock,
  type PreservedToken, type SimpleBlock, type SimpleBlockKind, type StaticToken, type Token,
} from './tokens';

export {
  type BlockKind,
  type BraceBlock,
  type BracketBlock,
  type ComponentBlock,
  type ComponentValue,
  type FunctionBlock,
  type ParensBlock,
  type PreservedToken,
  type SimpleBlock,
  type SimpleBlockKind,
};

type PreservedTokenKind = PreservedToken['type'];

export function isTokenKind<K extends PreservedTokenKind>(
  component: Token,
  kind: K,
): component is Extract<PreservedToken, { type: K; }> {
  return component.type === kind;
}

export function isIdentToken(component: Token): component is IdentToken {
  return isTokenKind(component, TokenKind.Ident);
}

export function isDelimToken(component: Token, delim: string): component is DelimToken {
  return isTokenKind(component, TokenKind.Delim) && component.value === delim;
}

export function isWhitespaceToken(
  component: Token,
): component is StaticToken<TokenKind.Whitespace> {
  return isTokenKind(component, TokenKind.Whitespace);
}

export function isComponentBlock(component: Token): component is ComponentBlock {
  switch (component.type) {
    case TokenKind.BraceBlock:
    case TokenKind.BracketBlock:
    case TokenKind.ParensBlock:
    case TokenKind.FunctionBlock:
      return true;

    default:
      return false;
  }
}

export function isComponentValue(token: Token): token is ComponentValue {
  switch (token.type) {
    case TokenKind.Function:
    case TokenKind.LeftBrace:
    case TokenKind.LeftBracket:
    case TokenKind.LeftParen:
    case TokenKind.EOF:
      return false;

    default:
      return true;
  }
}

export function isBlockKind<K extends BlockKind>(
  component: Token,
  kind: K,
): component is Extract<ComponentBlock, { type: K; }> {
  return component.type === kind;
}

export function isBraceBlock(component: Token): component is BraceBlock {
  return isBlockKind(component, TokenKind.BraceBlock);
}

export function isBracketBlock(component: Token): component is BracketBlock {
  return isBlockKind(component, TokenKind.BracketBlock);
}

export function isParensBlock(component: Token): component is ParensBlock {
  return isBlockKind(component, TokenKind.ParensBlock);
}

export function isFunctionBlock(component: Token): component is FunctionBlock {
  return isBlockKind(component, TokenKind.FunctionBlock);
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
  switch (value.type) {
    case TokenKind.BraceBlock:
      return `{${serializeComponentValues(value.value)}}`;

    case TokenKind.BracketBlock:
      return `[${serializeComponentValues(value.value)}]`;

    case TokenKind.ParensBlock:
      return `(${serializeComponentValues(value.value)})`;

    case TokenKind.FunctionBlock:
      return `${serializeCssIdentifier(value.name)}(${serializeComponentValues(value.value)})`;

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
      return serializeNumericToken(value.value, value.sign, value.flag);

    case TokenKind.Percentage:
      return `${serializeNumericToken(value.value, value.sign)}%`;

    case TokenKind.Dimension:
      return (
        serializeNumericToken(value.value, value.sign, value.flag) +
        serializeCssDimensionUnit(value.unit)
      );

    case TokenKind.UnicodeRange:
      return value.start === value.end
        ? `U+${value.start.toString(16)}`
        : `U+${value.start.toString(16)}-${value.end.toString(16)}`;

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

function serializeNumericToken(
  value: number,
  sign: NumericSign,
  flag?: NumberTokenFlag,
): string {
  let result: string;

  if (sign === NumericSign.Minus && (value >= 0 || Object.is(value, -0))) {
    result = `-${String(Math.abs(value))}`;
  } else {
    result = String(value);

    if (sign === NumericSign.Plus && value >= 0) {
      result = `+${result}`;
    }
  }

  if (
    flag === NumberTokenFlag.Number &&
    !result.includes('.') &&
    !/[eE]/.test(result)
  ) {
    result += '.0';
  }

  return result;
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
  switch (value.type) {
    case TokenKind.FunctionBlock:
      return TokenSerializationType.Function;

    case TokenKind.ParensBlock:
      return TokenSerializationType.OpenParen;

    case TokenKind.BraceBlock:
    case TokenKind.BracketBlock:
      return TokenSerializationType.Other;

    default:
      return tokenSerializationType(value);
  }
}

function lastTokenSerializationType(value: ComponentValue): TokenSerializationType {
  return isComponentBlock(value)
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
  switch (value.type) {
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

    case TokenKind.UnicodeRange:
      return TokenSerializationType.Ident;

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
