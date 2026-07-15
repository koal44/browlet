import { TextCursor } from '../../shared/text-cursor';
import { asciiLower } from '../../shared/css';

export enum TokenKind {
  Ident = 1,
  Function,
  AtKeyword,
  Hash,
  String,
  BadString,
  Url,
  BadUrl,
  Delim,
  Number,
  Percentage,
  Dimension,
  Whitespace,
  CDO,
  CDC,
  Colon,
  Semicolon,
  Comma,
  LeftBracket,
  RightBracket,
  LeftParen,
  RightParen,
  LeftBrace,
  RightBrace,
  EOF,
}

export enum HashTokenFlag {
  Unrestricted = 0,
  Id = 1,
}

export enum NumberTokenFlag {
  Integer = 0,
  Number = 1,
}

export type IdentToken = {
  kind: TokenKind.Ident;
  value: string;
};

export type FunctionToken = {
  kind: TokenKind.Function;
  value: string;
};

export type AtKeywordToken = {
  kind: TokenKind.AtKeyword;
  value: string;
};

export type HashToken = {
  kind: TokenKind.Hash;
  value: string;
  flag: HashTokenFlag;
};

export type StringToken = {
  kind: TokenKind.String;
  value: string;
};

export type UrlToken = {
  kind: TokenKind.Url;
  value: string;
};

export type DelimToken = {
  kind: TokenKind.Delim;
  value: string;
};

export type NumberToken = {
  kind: TokenKind.Number;
  value: number;
  repr: string;
  flag: NumberTokenFlag;
};

export type PercentageToken = {
  kind: TokenKind.Percentage;
  value: number;
  repr: string;
};

export type DimensionToken = {
  kind: TokenKind.Dimension;
  value: number;
  repr: string;
  flag: NumberTokenFlag;
  unit: string;
};

export type StaticTokenKind =
  | TokenKind.BadString
  | TokenKind.BadUrl
  | TokenKind.Whitespace
  | TokenKind.CDO
  | TokenKind.CDC
  | TokenKind.Colon
  | TokenKind.Semicolon
  | TokenKind.Comma
  | TokenKind.LeftBracket
  | TokenKind.RightBracket
  | TokenKind.LeftParen
  | TokenKind.RightParen
  | TokenKind.LeftBrace
  | TokenKind.RightBrace
  | TokenKind.EOF;

export type StaticToken<K extends StaticTokenKind = StaticTokenKind> = {
  kind: K;
};

export type Token =
  | IdentToken
  | FunctionToken
  | AtKeywordToken
  | HashToken
  | StringToken
  | UrlToken
  | DelimToken
  | NumberToken
  | PercentageToken
  | DimensionToken
  | StaticToken;

function staticToken<K extends StaticTokenKind>(kind: K): StaticToken<K> {
  return Object.freeze({ kind });
}

export const BadStringToken = staticToken(TokenKind.BadString);
export const BadUrlToken = staticToken(TokenKind.BadUrl);
export const WhitespaceToken = staticToken(TokenKind.Whitespace);
export const CDOToken = staticToken(TokenKind.CDO);
export const CDCToken = staticToken(TokenKind.CDC);
export const ColonToken = staticToken(TokenKind.Colon);
export const SemicolonToken = staticToken(TokenKind.Semicolon);
export const CommaToken = staticToken(TokenKind.Comma);
export const LeftBracketToken = staticToken(TokenKind.LeftBracket);
export const RightBracketToken = staticToken(TokenKind.RightBracket);
export const LeftParenToken = staticToken(TokenKind.LeftParen);
export const RightParenToken = staticToken(TokenKind.RightParen);
export const LeftBraceToken = staticToken(TokenKind.LeftBrace);
export const RightBraceToken = staticToken(TokenKind.RightBrace);
export const EOFToken = staticToken(TokenKind.EOF);

export function identToken(value: string): IdentToken {
  return { kind: TokenKind.Ident, value };
}

export function functionToken(value: string): FunctionToken {
  return { kind: TokenKind.Function, value };
}

export function atKeywordToken(value: string): AtKeywordToken {
  return { kind: TokenKind.AtKeyword, value };
}

export function hashToken(value: string, flag = HashTokenFlag.Unrestricted): HashToken {
  return { kind: TokenKind.Hash, value, flag };
}

export function stringToken(value: string): StringToken {
  return { kind: TokenKind.String, value };
}

export function urlToken(value: string): UrlToken {
  return { kind: TokenKind.Url, value };
}

export function delimToken(value: string): DelimToken {
  return { kind: TokenKind.Delim, value };
}

export function numberToken(value: number, flag = NumberTokenFlag.Integer, repr = ''): NumberToken {
  return { kind: TokenKind.Number, value, flag, repr };
}

export function percentageToken(value: number, repr = ''): PercentageToken {
  return { kind: TokenKind.Percentage, value, repr };
}

export function dimensionToken(value: number, unit: string, flag = NumberTokenFlag.Integer,
  repr = ''): DimensionToken {
  return { kind: TokenKind.Dimension, value, flag, unit, repr };
}

const LF = '\n';
const ReplacementCharacter = '\uFFFD';

export function filterCodePoints(input: string): string {
  let out = '';
  let last = 0;

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);

    // U+000D CARRIAGE RETURN (CR)
    // CRLF pairs become one LF.
    if (code === 0x000D) {
      out += input.slice(last, i) + LF;

      if (input.charCodeAt(i + 1) === 0x000A) {
        i++;
      }

      last = i + 1;
      continue;
    }

    // U+000C FORM FEED (FF)
    if (code === 0x000C) {
      out += input.slice(last, i) + LF;
      last = i + 1;
      continue;
    }

    // U+0000 NULL
    if (code === 0x0000) {
      out += input.slice(last, i) + ReplacementCharacter;
      last = i + 1;
      continue;
    }

    // Surrogates.
    //
    // A valid UTF-16 surrogate pair represents a scalar code point above U+FFFF. Only isolated surrogate code units are replaced.
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = input.charCodeAt(i + 1);

      if (next >= 0xDC00 && next <= 0xDFFF) {
        i++;
        continue;
      }

      out += input.slice(last, i) + ReplacementCharacter;
      last = i + 1;
      continue;
    }

    if (code >= 0xDC00 && code <= 0xDFFF) {
      out += input.slice(last, i) + ReplacementCharacter;
      last = i + 1;
      continue;
    }
  }

  if (last === 0) {
    return input;
  }

  return out + input.slice(last);
}

type NumericToken =
  | NumberToken
  | PercentageToken
  | DimensionToken;

type IdentLikeToken =
  | IdentToken
  | FunctionToken
  | UrlToken
  | StaticToken<TokenKind.BadUrl>;

export function tokenize(input: string): Token[] {
  const c = new TextCursor(filterCodePoints(input));
  const tokens: Token[] = [];

  while (true) {
    const token = consumeToken(c);

    if (token.kind === TokenKind.EOF) {
      return tokens;
    }

    tokens.push(token);
  }
}

// 4.3.1. Consume a token
function consumeToken(c: TextCursor): Token {
  consumeComments(c);

  const pos = c.pos();
  const ch = c.next();

  if (ch === '') {
    return EOFToken;
  }

  if (isCssWhitespace(ch)) {
    consumeWhitespace(c);
    return WhitespaceToken;
  }

  if (ch === '"') {
    return consumeStringToken(c, '"');
  }

  if (ch === '#') {
    if (isIdentCodePoint(c.peek()) || isValidEscape(c.peek(), c.peek(1))) {
      const flag = wouldStartIdentSequenceCodePoints(c.peek(), c.peek(1), c.peek(2))
        ? HashTokenFlag.Id
        : HashTokenFlag.Unrestricted;

      return hashToken(consumeIdentSequenceUnchecked(c), flag);
    }

    return delimToken(ch);
  }

  if (ch === "'") {
    return consumeStringToken(c, "'");
  }

  if (ch === '(') {
    return LeftParenToken;
  }

  if (ch === ')') {
    return RightParenToken;
  }

  if (ch === '+') {
    if (wouldStartNumberCodePoints(ch, c.peek(), c.peek(1))) {
      c.restore(pos);
      return consumeNumericToken(c);
    }

    return delimToken(ch);
  }

  if (ch === ',') {
    return CommaToken;
  }

  if (ch === '-') {
    if (wouldStartNumberCodePoints(ch, c.peek(), c.peek(1))) {
      c.restore(pos);
      return consumeNumericToken(c);
    }

    if (c.peek() === '-' && c.peek(1) === '>') {
      c.advance(2);
      return CDCToken;
    }

    if (wouldStartIdentSequenceCodePoints(ch, c.peek(), c.peek(1))) {
      c.restore(pos);
      return consumeIdentLikeToken(c);
    }

    return delimToken(ch);
  }

  if (ch === '.') {
    if (wouldStartNumberCodePoints(ch, c.peek(), c.peek(1))) {
      c.restore(pos);
      return consumeNumericToken(c);
    }

    return delimToken(ch);
  }

  if (ch === ':') {
    return ColonToken;
  }

  if (ch === ';') {
    return SemicolonToken;
  }

  if (ch === '<') {
    if (c.peek() === '!' && c.peek(1) === '-' && c.peek(2) === '-') {
      c.advance(3);
      return CDOToken;
    }

    return delimToken(ch);
  }

  if (ch === '@') {
    if (wouldStartIdentSequenceCodePoints(c.peek(), c.peek(1), c.peek(2))) {
      return atKeywordToken(consumeIdentSequenceUnchecked(c));
    }

    return delimToken(ch);
  }

  if (ch === '[') {
    return LeftBracketToken;
  }

  if (ch === '\\') {
    if (isValidEscape(ch, c.peek())) {
      c.restore(pos);
      return consumeIdentLikeToken(c);
    }

    return delimToken(ch);
  }

  if (ch === ']') {
    return RightBracketToken;
  }

  if (ch === '{') {
    return LeftBraceToken;
  }

  if (ch === '}') {
    return RightBraceToken;
  }

  if (isDigit(ch)) {
    c.restore(pos);
    return consumeNumericToken(c);
  }

  if (isIdentStartCodePoint(ch)) {
    c.restore(pos);
    return consumeIdentLikeToken(c);
  }

  return delimToken(ch);
}

// 4.3.2. Consume comments
function consumeComments(c: TextCursor): void {
  while (c.peek() === '/' && c.peek(1) === '*') {
    c.advance(2);

    while (!c.eof()) {
      if (c.peek() === '*' && c.peek(1) === '/') {
        c.advance(2);
        break;
      }

      c.advance();
    }
  }
}

// 4.3.3. Consume a numeric token
function consumeNumericToken(c: TextCursor): NumericToken {
  const start = c.pos();
  const number = consumeNumber(c);

  if (wouldStartIdentSequenceCodePoints(c.peek(), c.peek(1), c.peek(2))) {
    const unit = consumeIdentSequenceUnchecked(c);
    return dimensionToken(number.value, unit, number.flag, c.slice(start, c.pos()));
  }

  if (c.peek() === '%') {
    c.advance();
    return percentageToken(number.value, c.slice(start, c.pos()));
  }

  return numberToken(number.value, number.flag, c.slice(start, c.pos()));
}

// 4.3.4. Consume an ident-like token
function consumeIdentLikeToken(c: TextCursor): IdentLikeToken {
  const value = consumeIdentSequenceUnchecked(c);

  if (asciiEquals(value, 'url') && c.peek() === '(') {
    c.advance();

    // Spec says: while the next two input code points are whitespace,
    // consume the next input code point.
    while (isCssWhitespace(c.peek()) && isCssWhitespace(c.peek(1))) {
      c.advance();
    }

    const ch = c.peek();
    const next = c.peek(1);

    if (
      ch === '"' ||
      ch === "'" ||
      (isCssWhitespace(ch) && (next === '"' || next === "'"))
    ) {
      return functionToken(value);
    }

    return consumeUrlToken(c);
  }

  if (c.peek() === '(') {
    c.advance();
    return functionToken(value);
  }

  return identToken(value);
}

type StringLikeToken =
  | StringToken
  | StaticToken<TokenKind.BadString>;

// 4.3.5. Consume a string token
function consumeStringToken(c: TextCursor, ending: '"' | "'"): StringLikeToken {
  let value = '';

  while (true) {
    const pos = c.pos();
    const ch = c.next();

    if (ch === ending) {
      return stringToken(value);
    }

    if (ch === '') {
      return stringToken(value);
    }

    if (isNewline(ch)) {
      c.restore(pos);
      return BadStringToken;
    }

    if (ch === '\\') {
      if (c.eof()) {
        continue;
      }

      if (isNewline(c.peek())) {
        c.advance();
        continue;
      }

      value += consumeEscapedCodePoint(c);
      continue;
    }

    value += ch;
  }
}

// 4.3.6. Consume a url token
function consumeUrlToken(c: TextCursor): UrlToken | StaticToken<TokenKind.BadUrl> {
  let value = '';

  consumeWhitespace(c);

  while (true) {
    const ch = c.next();

    if (ch === ')') {
      return urlToken(value);
    }

    if (ch === '') {
      return urlToken(value);
    }

    if (isCssWhitespace(ch)) {
      consumeWhitespace(c);

      if (c.match(')')) {
        return urlToken(value);
      }

      if (c.eof()) {
        return urlToken(value);
      }

      consumeBadUrlRemnants(c);
      return BadUrlToken;
    }

    if (
      ch === '"' ||
      ch === "'" ||
      ch === '(' ||
      isNonPrintableCodePoint(ch)
    ) {
      consumeBadUrlRemnants(c);
      return BadUrlToken;
    }

    if (ch === '\\') {
      if (isValidEscape(ch, c.peek())) {
        value += consumeEscapedCodePoint(c);
        continue;
      }

      consumeBadUrlRemnants(c);
      return BadUrlToken;
    }

    value += ch;
  }
}

// 4.3.7. Consume an escaped code point
function consumeEscapedCodePoint(c: TextCursor): string {
  const first = c.next();

  if (first === '') {
    return '\uFFFD';
  }

  if (!isHexDigit(first)) {
    return first;
  }

  let hex = first;

  while (hex.length < 6 && isHexDigit(c.peek())) {
    hex += c.next();
  }

  if (isCssWhitespace(c.peek())) {
    c.advance();
  }

  const value = Number.parseInt(hex, 16);

  if (
    value === 0 ||
    value > 0x10FFFF ||
    (value >= 0xD800 && value <= 0xDFFF)
  ) {
    return '\uFFFD';
  }

  return String.fromCodePoint(value);
}

// 4.3.8. Check if two code points are a valid escape
function startsWithValidEscape(c: TextCursor): boolean {
  return isValidEscape(c.peek(), c.peek(1));
}

function isValidEscape(first: string, second: string): boolean {
  return first === '\\' && !isNewline(second);
}

// 4.3.9. Check if three code points would start an ident sequence
function wouldStartIdentSequenceCodePoints(first: string, second: string, third: string): boolean {
  if (first === '-') {
    return (
      isIdentStartCodePoint(second) ||
      second === '-' ||
      isValidEscape(second, third)
    );
  }

  if (isIdentStartCodePoint(first)) {
    return true;
  }

  if (first === '\\') {
    return isValidEscape(first, second);
  }

  return false;
}

// 4.3.10. Check if three code points would start a number
function wouldStartNumberCodePoints(first: string, second: string, third: string): boolean {
  if (first === '+' || first === '-') {
    return isDigit(second) || (second === '.' && isDigit(third));
  }

  if (first === '.') {
    return isDigit(second);
  }

  return isDigit(first);
}

// 4.3.11. Consume an ident sequence
function consumeIdentSequenceUnchecked(c: TextCursor): string {
  // Deliberately does not validate that the stream starts with an ident sequence.
  let result = '';

  while (true) {
    const ch = c.peek();

    if (isIdentCodePoint(ch)) {
      result += c.next();
      continue;
    }

    if (startsWithValidEscape(c)) {
      c.advance(); // consume backslash
      result += consumeEscapedCodePoint(c);
      continue;
    }

    return result;
  }
}

type ConsumedNumber = {
  value: number;
  flag: NumberTokenFlag;
  repr: string;
};

// 4.3.12. Consume a number
function consumeNumber(c: TextCursor): ConsumedNumber {
  let flag = NumberTokenFlag.Integer;
  let repr = '';

  if (c.peek() === '+' || c.peek() === '-') {
    repr += c.next();
  }

  while (isDigit(c.peek())) {
    repr += c.next();
  }

  if (c.peek() === '.' && isDigit(c.peek(1))) {
    flag = NumberTokenFlag.Number;

    repr += c.next(); // .
    while (isDigit(c.peek())) {
      repr += c.next();
    }
  }

  const e = c.peek();
  const signOrDigit = c.peek(1);
  const digitAfterSign = c.peek(2);

  if (
    (e === 'e' || e === 'E') &&
    (
      isDigit(signOrDigit) ||
      ((signOrDigit === '+' || signOrDigit === '-') && isDigit(digitAfterSign))
    )
  ) {
    flag = NumberTokenFlag.Number;

    repr += c.next(); // e/E

    if (c.peek() === '+' || c.peek() === '-') {
      repr += c.next();
    }

    while (isDigit(c.peek())) {
      repr += c.next();
    }
  }

  return {
    value: convertStringToNumber(repr),
    flag,
    repr,
  };
}

// 4.3.13. Convert a string to a number
function convertStringToNumber(repr: string): number {
  let i = 0;

  let s = 1;
  if (repr[i] === '+' || repr[i] === '-') {
    if (repr[i] === '-') s = -1;
    i++;
  }

  const integerStart = i;
  while (isDigit(repr[i])) i++;
  const integerPart = repr.slice(integerStart, i);
  const integer = integerPart === '' ? 0 : Number(integerPart);

  let fraction = 0;
  let fractionDigits = 0;

  if (repr[i] === '.') {
    i++;

    const fractionStart = i;
    while (isDigit(repr[i])) i++;

    const fractionPart = repr.slice(fractionStart, i);
    fractionDigits = fractionPart.length;
    fraction = fractionPart === '' ? 0 : Number(fractionPart);
  }

  let t = 1;
  let exponent = 0;

  if (repr[i] === 'e' || repr[i] === 'E') {
    i++;

    if (repr[i] === '+' || repr[i] === '-') {
      if (repr[i] === '-') t = -1;
      i++;
    }

    const exponentStart = i;
    while (isDigit(repr[i])) i++;

    const exponentPart = repr.slice(exponentStart, i);
    exponent = exponentPart === '' ? 0 : Number(exponentPart);
  }

  return s * (integer + fraction * 10 ** -fractionDigits) * 10 ** (t * exponent);
}

// 4.3.14. Consume the remnants of a bad url
function consumeBadUrlRemnants(c: TextCursor): void {
  while (true) {
    const ch = c.next();

    if (ch === ')' || ch === '') {
      return;
    }

    if (ch === '\\' && isValidEscape(ch, c.peek())) {
      consumeEscapedCodePoint(c);
    }
  }
}

// Consume whitespace
function consumeWhitespace(c: TextCursor): void {
  c.consumeWhile(isCssWhitespace);
}

// Assumes the input stream has already gone through filterCodePoints(),
// so CR, CRLF, and FF have already become LF.
function isCssWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || isNewline(ch);
}

function isNewline(ch: string): boolean {
  return ch === '\n';
}

function asciiEquals(a: string, b: string): boolean {
  return a.length === b.length && asciiLower(a) === asciiLower(b);
}

function isDigit(ch: string | undefined): boolean {
  if (ch === undefined || ch === '') return false;

  const code = ch.charCodeAt(0);
  return code >= 0x30 && code <= 0x39;
}

function isHexDigit(ch: string | undefined): boolean {
  if (ch === undefined || ch === '') return false;

  const code = ch.charCodeAt(0);

  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x46) ||
    (code >= 0x61 && code <= 0x66)
  );
}

function isIdentStartCodePoint(ch: string | undefined): boolean {
  if (ch === undefined || ch === '') return false;

  const code = ch.charCodeAt(0);

  return (
    ch === '_' ||
    (code >= 0x41 && code <= 0x5A) ||
    (code >= 0x61 && code <= 0x7A) ||
    code >= 0x80
  );
}

function isIdentCodePoint(ch: string | undefined): boolean {
  return isIdentStartCodePoint(ch) || isDigit(ch) || ch === '-';
}

function isNonPrintableCodePoint(ch: string | undefined): boolean {
  if (ch === undefined || ch === '') return false;

  const code = ch.charCodeAt(0);

  return (
    (code >= 0x00 && code <= 0x08) ||
    code === 0x0B ||
    (code >= 0x0E && code <= 0x1F) ||
    code === 0x7F
  );
}
