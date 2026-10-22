import { asciiLower } from '../../infra/ascii';

import type { TokenList, NonEmptyTokenList } from './token-list';
import {
  HashTokenFlag, NumericSign, NumberTokenFlag, TokenKind, isNonAsciiIdentCodePoint,
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

/** A component allowed by <any-value>, including recursively validated block contents. */
export type AnyValueComponent =
  | Exclude<PreservedToken, InvalidAnyValueToken>
  | { type: SimpleBlockKind; value: AnyValueContents; }
  | FunctionBlock<AnyValueContents>;

/** Validated component contents; nested blocks may be empty. */
export type AnyValueContents = TokenList<AnyValueComponent>;

/** A function block whose contents match the nonempty <any-value> production. */
export type AnyValueFunctionBlock = FunctionBlock<NonEmptyTokenList<AnyValueComponent>>;

type InvalidAnyValueToken =
  | StaticToken<TokenKind.BadString>
  | StaticToken<TokenKind.BadUrl>
  | StaticToken<TokenKind.RightParen>
  | StaticToken<TokenKind.RightBracket>
  | StaticToken<TokenKind.RightBrace>;

export function isTokenKind<K extends PreservedTokenKind>(
  token: Token,
  kind: K,
): token is Extract<PreservedToken, { type: K; }> {
  return token.type === kind;
}

export function isIdentToken(token: Token): token is IdentToken {
  return isTokenKind(token, TokenKind.Ident);
}

export function isDelimToken(token: Token, delim: string): token is DelimToken {
  return isTokenKind(token, TokenKind.Delim) && token.value === delim;
}

export function isWhitespaceToken(
  token: Token,
): token is StaticToken<TokenKind.Whitespace> {
  return isTokenKind(token, TokenKind.Whitespace);
}

export function isComponentBlock(token: Token): token is ComponentBlock {
  switch (token.type) {
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
  token: Token,
  kind: K,
): token is Extract<ComponentBlock, { type: K; }> {
  return token.type === kind;
}

export function isBraceBlock(token: Token): token is BraceBlock {
  return isBlockKind(token, TokenKind.BraceBlock);
}

export function isBracketBlock(token: Token): token is BracketBlock {
  return isBlockKind(token, TokenKind.BracketBlock);
}

export function isParensBlock(token: Token): token is ParensBlock {
  return isBlockKind(token, TokenKind.ParensBlock);
}

export function isFunctionBlock(token: Token): token is FunctionBlock {
  return isBlockKind(token, TokenKind.FunctionBlock);
}

/** Check a function's nonempty contents without constructing a value or replacing its list. */
export function isAnyValueFunctionBlock(token: Token): token is AnyValueFunctionBlock {
  return isFunctionBlock(token) && token.value.tokens.length > 0 && isAnyValueContents(token.value);
}

/** Validate opaque contents, accepting empty nested blocks and rejecting malformed tokens. */
// https://drafts.csswg.org/css-syntax-3/#any-value
export function isAnyValueContents(list: TokenList<ComponentValue>): list is AnyValueContents {
  return list.tokens.every(isAnyValueComponent);
}

/** Check the <any-value> token restrictions recursively through blocks. */
export function isAnyValueComponent(token: Token): token is AnyValueComponent {
  if (isComponentBlock(token)) return isAnyValueContents(token.value);

  switch (token.type) {
    case TokenKind.BadString:
    case TokenKind.BadUrl:
    case TokenKind.RightParen:
    case TokenKind.RightBracket:
    case TokenKind.RightBrace:
    case TokenKind.EOF:
      return false;
    default:
      return true;
  }
}

/** Serializes components so reparsing preserves their structure and token flags. */
// https://drafts.csswg.org/css-syntax-3/#serialization
export function serializeComponentValues(components: ComponentValue[]): string {
  let result = '';
  let previous = TokenSerializationType.Other;

  for (const component of components) {
    const next = firstTokenSerializationType(component);

    if (needsSeparator(previous, next)) result += '/**/';

    result += serializeComponentValue(component);
    previous = lastTokenSerializationType(component);
  }

  return result;
}

function serializeComponentValue(component: ComponentValue): string {
  switch (component.type) {
    case TokenKind.BraceBlock:
      return `{${serializeComponentValues(component.value.tokens)}}`;

    case TokenKind.BracketBlock:
      return `[${serializeComponentValues(component.value.tokens)}]`;

    case TokenKind.ParensBlock:
      return `(${serializeComponentValues(component.value.tokens)})`;

    case TokenKind.FunctionBlock:
      return `${serializeCssIdentifier(component.name)}(${serializeComponentValues(component.value.tokens)})`;

    case TokenKind.Ident:
      return serializeCssIdentifier(component.value);

    case TokenKind.AtKeyword:
      return `@${serializeCssIdentifier(component.value)}`;

    case TokenKind.Hash:
      return `#${component.flag === HashTokenFlag.Id
        ? serializeCssIdentifier(component.value)
        : serializeCssName(component.value)}`;

    case TokenKind.String:
      return serializeCssString(component.value);

    case TokenKind.BadString:
      return serializeBadStringToken();

    case TokenKind.Url:
      return serializeCssUrlToken(component.value);

    case TokenKind.BadUrl:
      return serializeBadUrlToken();

    case TokenKind.Delim:
      return serializeCssDelimToken(component.value);

    case TokenKind.Number:
      return serializeNumericToken(component.value, component.sign, component.flag);

    case TokenKind.Percentage:
      return `${serializeNumericToken(component.value, component.sign)}%`;

    case TokenKind.Dimension:
      return (
        serializeNumericToken(component.value, component.sign, component.flag) +
        serializeCssDimensionUnit(component.unit)
      );

    case TokenKind.UnicodeRange:
      return component.start === component.end
        ? `U+${component.start.toString(16)}`
        : `U+${component.start.toString(16)}-${component.end.toString(16)}`;

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

/** Preserves the numeric token's value, explicit sign, and integer/number flag. */
function serializeNumericToken(
  value: number,
  sign: NumericSign,
  flag?: NumberTokenFlag,
): string {
  let result: string;

  if (!Number.isFinite(value)) {
    // Overflow still needs a numeric spelling. Keep its stored value and flag;
    // supported value ranges belong to interpretation, not serialization.
    // 1e309 overflows binary64; integer tokens spell it without an exponent.
    result = flag === NumberTokenFlag.Integer ? `1${'0'.repeat(309)}` : '1e309';
    if (value < 0) result = `-${result}`;
  } else if (flag === NumberTokenFlag.Integer && Math.abs(value) >= 1e21) {
    // String(number) uses exponent notation here, which would change the flag.
    result = BigInt(value).toString();
  } else {
    result = String(value);
  }

  if (sign === NumericSign.Minus && (value >= 0 || Object.is(value, -0))) {
    result = `-${result}`;
  } else if (sign === NumericSign.Plus && value >= 0) {
    result = `+${result}`;
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

/** Escapes a decoded identifier for use in CSS syntax. */
// https://drafts.csswg.org/cssom/#serialize-an-identifier
// SPEC_CLASH(css-non-ascii-ident-serialization): Follow Syntax's restricted ranges;
// CSSOM and browsers emit all non-ASCII characters literally. Escape excluded
// characters so our tokenizer can recover the identifier. See syntax/ROADMAP.md.
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
      isNonAsciiIdentCodePoint(codePoint) ||
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

/** Format an interpreted function; its grammar supplies serialized contents at the current value stage. */
// https://drafts.csswg.org/cssom/#serialize-a-function
export function serializeCssFunction(name: string, contents: string): string {
  return `${serializeCssIdentifier(asciiLower(name))}(${contents})`;
}

/** Serializes a CSS string, including its surrounding double quotes. */
// https://drafts.csswg.org/cssom/#serialize-a-string
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

/** Serialize a local font name; font lookup and descriptor interpretation are separate work. */
// https://drafts.csswg.org/cssom/#serialize-a-local
export function serializeCssLocal(name: string): string {
  return serializeCssFunction('local', serializeCssString(name));
}

/** Escapes a name without the leading-character restrictions of an identifier. */
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
      isNonAsciiIdentCodePoint(codePoint) ||
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

function firstTokenSerializationType(component: ComponentValue): TokenSerializationType {
  switch (component.type) {
    case TokenKind.FunctionBlock:
      return TokenSerializationType.Function;

    case TokenKind.ParensBlock:
      return TokenSerializationType.OpenParen;

    case TokenKind.BraceBlock:
    case TokenKind.BracketBlock:
      return TokenSerializationType.Other;

    default:
      return tokenSerializationType(component);
  }
}

function lastTokenSerializationType(component: ComponentValue): TokenSerializationType {
  return isComponentBlock(component)
    ? TokenSerializationType.Other
    : tokenSerializationType(component);
}

// https://drafts.csswg.org/css-syntax-3/#serialization
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

    case TokenSerializationType.LessThan:
      // The informative pair table omits this three-token hazard: < ! --.
      // Separating < and ! also prevents a following --name from making a CDO.
      return after === TokenSerializationType.Exclamation;

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
  LessThan,
  Exclamation,
}

function tokenSerializationType(token: PreservedToken): TokenSerializationType {
  switch (token.type) {
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
      switch (token.value) {
        case '-': return TokenSerializationType.Hyphen;
        case '#': return TokenSerializationType.HashDelim;
        case '@': return TokenSerializationType.AtDelim;
        case '.': return TokenSerializationType.Dot;
        case '+': return TokenSerializationType.Plus;
        case '/': return TokenSerializationType.Slash;
        case '*': return TokenSerializationType.Asterisk;
        case '%': return TokenSerializationType.Percent;
        case '<': return TokenSerializationType.LessThan;
        case '!': return TokenSerializationType.Exclamation;
      }
  }

  return TokenSerializationType.Other;
}
