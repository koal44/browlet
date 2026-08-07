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
  UnicodeRange,
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
  BraceBlock,
  BracketBlock,
  ParensBlock,
  FunctionBlock,
}

export enum HashTokenFlag {
  Unrestricted = 0,
  Id = 1,
}

export enum NumberTokenFlag {
  Integer = 0,
  Number = 1,
}

export enum NumericSign {
  None = 0,
  Plus,
  Minus,
}

export type IdentToken = {
  type: TokenKind.Ident;
  value: string;
};

export type FunctionToken = {
  type: TokenKind.Function;
  value: string;
};

export type AtKeywordToken = {
  type: TokenKind.AtKeyword;
  value: string;
};

export type HashToken = {
  type: TokenKind.Hash;
  value: string;
  flag: HashTokenFlag;
};

export type StringToken = {
  type: TokenKind.String;
  value: string;
};

export type UrlToken = {
  type: TokenKind.Url;
  value: string;
};

export type DelimToken = {
  type: TokenKind.Delim;
  value: string;
};

export type NumberToken = {
  type: TokenKind.Number;
  value: number;
  sign: NumericSign;
  flag: NumberTokenFlag;
};

export type PercentageToken = {
  type: TokenKind.Percentage;
  value: number;
  sign: NumericSign;
};

export type DimensionToken = {
  type: TokenKind.Dimension;
  value: number;
  sign: NumericSign;
  flag: NumberTokenFlag;
  unit: string;
};

export type UnicodeRangeToken = {
  type: TokenKind.UnicodeRange;
  start: number;
  end: number;
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
  type: K;
};

type AnyStaticToken = {
  [K in StaticTokenKind]: StaticToken<K>;
}[StaticTokenKind];

export type Token =
  | LexicalToken
  | ComponentBlock;

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
  | UnicodeRangeToken
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

export type BlockKind = ComponentBlock['type'];

export type SimpleBlockKind =
  | TokenKind.BraceBlock
  | TokenKind.BracketBlock
  | TokenKind.ParensBlock;

export type BraceBlock<Contents = ComponentValue[]> = {
  type: TokenKind.BraceBlock;
  value: Contents;
};

export type BracketBlock<Contents = ComponentValue[]> = {
  type: TokenKind.BracketBlock;
  value: Contents;
};

export type ParensBlock<Contents = ComponentValue[]> = {
  type: TokenKind.ParensBlock;
  value: Contents;
};

export type FunctionBlock<Contents = ComponentValue[]> = {
  type: TokenKind.FunctionBlock;
  name: string;
  value: Contents;
};

type LexicalToken =
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
  | UnicodeRangeToken
  | AnyStaticToken;

function staticToken<K extends StaticTokenKind>(kind: K): StaticToken<K> {
  return Object.freeze({ type: kind });
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
  return { type: TokenKind.Ident, value };
}

export function functionToken(value: string): FunctionToken {
  return { type: TokenKind.Function, value };
}

export function atKeywordToken(value: string): AtKeywordToken {
  return { type: TokenKind.AtKeyword, value };
}

export function hashToken(value: string, flag = HashTokenFlag.Unrestricted): HashToken {
  return { type: TokenKind.Hash, value, flag };
}

export function stringToken(value: string): StringToken {
  return { type: TokenKind.String, value };
}

export function urlToken(value: string): UrlToken {
  return { type: TokenKind.Url, value };
}

export function delimToken(value: string): DelimToken {
  return { type: TokenKind.Delim, value };
}

export function numberToken(
  value: number,
  flag = NumberTokenFlag.Integer,
  sign = NumericSign.None,
): NumberToken {
  return { type: TokenKind.Number, value, sign, flag };
}

export function percentageToken(
  value: number,
  sign = NumericSign.None,
): PercentageToken {
  return { type: TokenKind.Percentage, value, sign };
}

export function dimensionToken(
  value: number,
  unit: string,
  flag = NumberTokenFlag.Integer,
  sign = NumericSign.None,
): DimensionToken {
  return { type: TokenKind.Dimension, value, sign, flag, unit };
}

export function unicodeRangeToken(start: number, end: number): UnicodeRangeToken {
  return { type: TokenKind.UnicodeRange, start, end };
}

const LF = '\n';
const ReplacementCharacter = '\uFFFD';
const MaximumAllowedCodePoint = 0x10FFFF;

export type DecodeStylesheetOptions = {
  transportEncoding?: string;
  environmentEncoding?: string;
};

// 3.2. The input byte stream
export function decodeStylesheetBytes(
  bytes: Uint8Array,
  options: DecodeStylesheetOptions = {},
): string {
  const fallback = determineFallbackEncoding(bytes, options);
  const encoding = sniffByteOrderMark(bytes) ?? fallback;

  return decode(bytes, encoding);
}

function determineFallbackEncoding(
  bytes: Uint8Array,
  {
    transportEncoding,
    environmentEncoding,
  }: DecodeStylesheetOptions,
): string {
  const transport = getEncoding(transportEncoding);
  if (transport !== null) return transport;

  const declared = getDeclaredEncoding(bytes);
  if (declared !== null) {
    return declared === 'utf-16be' || declared === 'utf-16le'
      ? 'utf-8'
      : declared;
  }

  const environment = getEncoding(environmentEncoding);
  return environment ?? 'utf-8';
}

function getDeclaredEncoding(bytes: Uint8Array): string | null {
  const prefix = [
    0x40, 0x63, 0x68, 0x61, 0x72,
    0x73, 0x65, 0x74, 0x20, 0x22,
  ];

  if (!startsWith(bytes, prefix)) return null;

  const limit = Math.min(bytes.length, 1024);

  for (let i = prefix.length; i < limit; i++) {
    const byte = bytes[i]!;

    if (byte === 0x22) {
      if (i + 1 >= limit || bytes[i + 1] !== 0x3B) return null;

      const label = String.fromCharCode(...bytes.subarray(prefix.length, i));
      return getEncoding(label);
    }

    if (!(byte <= 0x21 || (byte >= 0x23 && byte <= 0x7F))) return null;
  }

  return null;
}

function sniffByteOrderMark(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0xEF, 0xBB, 0xBF])) return 'utf-8';
  if (startsWith(bytes, [0xFE, 0xFF])) return 'utf-16be';
  if (startsWith(bytes, [0xFF, 0xFE])) return 'utf-16le';

  return null;
}

function getEncoding(label?: string): string | null {
  if (label === undefined) return null;

  const normalized = label
    .replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '')
    .toLowerCase();

  if (ReplacementEncodingLabels.has(normalized)) return 'replacement';
  if (normalized === 'x-user-defined') return normalized;

  try {
    return new TextDecoder(normalized).encoding;
  } catch {
    return null;
  }
}

function decode(bytes: Uint8Array, encoding: string): string {
  if (encoding === 'replacement') {
    return bytes.length === 0 ? '' : '\uFFFD';
  }

  if (encoding === 'x-user-defined') {
    let result = '';

    for (const byte of bytes) {
      result += String.fromCodePoint(byte <= 0x7F ? byte : 0xF780 + byte);
    }

    return result;
  }

  return new TextDecoder(encoding).decode(bytes);
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

const ReplacementEncodingLabels = new Set([
  'csiso2022kr',
  'hz-gb-2312',
  'iso-2022-cn',
  'iso-2022-cn-ext',
  'iso-2022-kr',
  'replacement',
]);

// 3.3. Preprocessing the input stream
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

export function tokenize(input: string, unicodeRangesAllowed = false): Token[] {
  const c = new TextCursor(filterCodePoints(input));
  const tokens: Token[] = [];

  while (true) {
    const token = consumeToken(c, unicodeRangesAllowed);

    if (token.type === TokenKind.EOF) {
      return tokens;
    }

    if (
      token.type === TokenKind.Whitespace &&
      tokens[tokens.length - 1]?.type === TokenKind.Whitespace
    ) {
      continue;
    }

    tokens.push(token);
  }
}

// 4.3.1. Consume a token
function consumeToken(c: TextCursor, unicodeRangesAllowed: boolean): Token {
  consumeComments(c);

  const pos = c.pos();
  const ch = c.next();

  if (ch === '') {
    return EOFToken;
  }

  if (isWhitespace(ch)) {
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

      return hashToken(consumeIdentSequence(c), flag);
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
      return atKeywordToken(consumeIdentSequence(c));
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

  if (
    unicodeRangesAllowed &&
    wouldStartUnicodeRangeCodePoints(ch, c.peek(), c.peek(1))
  ) {
    c.restore(pos);
    return consumeUnicodeRangeToken(c);
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
  const number = consumeNumber(c);

  if (wouldStartIdentSequenceCodePoints(c.peek(), c.peek(1), c.peek(2))) {
    const unit = consumeIdentSequence(c);
    return dimensionToken(
      number.value,
      unit,
      number.flag,
      number.sign,
    );
  }

  if (c.peek() === '%') {
    c.advance();
    return percentageToken(number.value, number.sign);
  }

  return numberToken(number.value, number.flag, number.sign);
}

// 4.3.4. Consume an ident-like token
function consumeIdentLikeToken(c: TextCursor): IdentLikeToken {
  const value = consumeIdentSequence(c);

  if (asciiEquals(value, 'url') && c.peek() === '(') {
    c.advance();

    // Spec says: while the next two input code points are whitespace,
    // consume the next input code point.
    while (isWhitespace(c.peek()) && isWhitespace(c.peek(1))) {
      c.advance();
    }

    const ch = c.peek();
    const next = c.peek(1);

    if (
      ch === '"' ||
      ch === "'" ||
      (isWhitespace(ch) && (next === '"' || next === "'"))
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

    if (isWhitespace(ch)) {
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

  if (isWhitespace(c.peek())) {
    c.advance();
  }

  const value = Number.parseInt(hex, 16);

  if (
    value === 0 ||
    value > MaximumAllowedCodePoint ||
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

// 4.3.11. Check if three code points would start a unicode-range
function wouldStartUnicodeRangeCodePoints(
  first: string,
  second: string,
  third: string,
): boolean {
  return (
    (first === 'U' || first === 'u') &&
    second === '+' &&
    (third === '?' || isHexDigit(third))
  );
}

// 4.3.12. Consume an ident sequence
function consumeIdentSequence(c: TextCursor): string {
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
  sign: NumericSign;
};

// 4.3.13. Consume a number
function consumeNumber(c: TextCursor): ConsumedNumber {
  let flag = NumberTokenFlag.Integer;
  let sign = NumericSign.None;
  let repr = '';

  const first = c.peek();
  if (first === '+' || first === '-') {
    sign = first === '+' ? NumericSign.Plus : NumericSign.Minus;
    repr += first;
    c.advance();
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
    sign,
  };
}

function convertStringToNumber(repr: string): number {
  let i = 0;

  let s = 1;
  if (repr[i] === '+' || repr[i] === '-') {
    if (repr[i] === '-') s = -1;
    i++;
  }

  const integerStart = i;
  while (isDigit(repr.charAt(i))) i++;
  const integerPart = repr.slice(integerStart, i);
  const integer = integerPart === '' ? 0 : Number(integerPart);

  let fraction = 0;
  let fractionDigits = 0;

  if (repr[i] === '.') {
    i++;

    const fractionStart = i;
    while (isDigit(repr.charAt(i))) i++;

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
    while (isDigit(repr.charAt(i))) i++;

    const exponentPart = repr.slice(exponentStart, i);
    exponent = exponentPart === '' ? 0 : Number(exponentPart);
  }

  return s * (integer + fraction * 10 ** -fractionDigits) * 10 ** (t * exponent);
}

// 4.3.14. Consume a unicode-range token
function consumeUnicodeRangeToken(c: TextCursor): UnicodeRangeToken {
  c.advance(2); // U+

  let firstSegment = '';

  while (firstSegment.length < 6 && isHexDigit(c.peek())) {
    firstSegment += c.next();
  }

  while (firstSegment.length < 6 && c.peek() === '?') {
    firstSegment += c.next();
  }

  if (firstSegment.includes('?')) {
    const start = Number.parseInt(firstSegment.replaceAll('?', '0'), 16);
    const end = Number.parseInt(firstSegment.replaceAll('?', 'F'), 16);
    return unicodeRangeToken(start, end);
  }

  const start = Number.parseInt(firstSegment, 16);

  if (c.peek() === '-' && isHexDigit(c.peek(1))) {
    c.advance();

    let endSegment = '';
    while (endSegment.length < 6 && isHexDigit(c.peek())) {
      endSegment += c.next();
    }

    return unicodeRangeToken(start, Number.parseInt(endSegment, 16));
  }

  return unicodeRangeToken(start, start);
}

// 4.3.15. Consume the remnants of a bad url
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
  c.consumeWhile(isWhitespace);
}

// Assumes the input stream has already gone through filterCodePoints(),
// so CR, CRLF, and FF have already become LF.
function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || isNewline(ch);
}

function isNewline(ch: string): boolean {
  return ch === '\n';
}

function asciiEquals(a: string, b: string): boolean {
  return a.length === b.length && asciiLower(a) === asciiLower(b);
}

function isDigit(ch: string): boolean {
  if (ch === '') return false;

  const code = ch.charCodeAt(0);
  return code >= 0x30 && code <= 0x39;
}

function isHexDigit(ch: string): boolean {
  if (ch === '') return false;

  const code = ch.charCodeAt(0);

  return (
    isDigit(ch) ||
    (code >= 0x41 && code <= 0x46) ||
    (code >= 0x61 && code <= 0x66)
  );
}

function isUppercaseLetter(ch: string): boolean {
  if (ch === '') return false;

  const code = ch.charCodeAt(0);
  return code >= 0x41 && code <= 0x5A;
}

function isLowercaseLetter(ch: string): boolean {
  if (ch === '') return false;

  const code = ch.charCodeAt(0);
  return code >= 0x61 && code <= 0x7A;
}

function isLetter(ch: string): boolean {
  return isUppercaseLetter(ch) || isLowercaseLetter(ch);
}

function isIdentStartCodePoint(ch: string): boolean {
  if (ch === '') return false;

  if (ch === '_' || isLetter(ch)) return true;

  // Filtering guarantees that surrogate code units only occur in valid
  // pairs, which represent allowed code points above U+FFFF.
  const code = ch.charCodeAt(0);
  if (code >= 0xD800 && code <= 0xDFFF) return true;

  return isNonAsciiIdentCodePoint(ch);
}

function isNonAsciiIdentCodePoint(ch: string): boolean {
  if (ch === '') return false;

  const code = ch.codePointAt(0)!;
  if (code < 0xB7) return false;

  return (
    code === 0xB7 ||
    (code >= 0xC0 && code <= 0xD6) ||
    (code >= 0xD8 && code <= 0xF6) ||
    (code >= 0xF8 && code <= 0x37D) ||
    (code >= 0x37F && code <= 0x1FFF) ||
    code === 0x200C ||
    code === 0x200D ||
    code === 0x203F ||
    code === 0x2040 ||
    (code >= 0x2070 && code <= 0x218F) ||
    (code >= 0x2C00 && code <= 0x2FEF) ||
    (code >= 0x3001 && code <= 0xD7FF) ||
    (code >= 0xF900 && code <= 0xFDCF) ||
    (code >= 0xFDF0 && code <= 0xFFFD) ||
    code >= 0x10000
  );
}

function isIdentCodePoint(ch: string): boolean {
  return isIdentStartCodePoint(ch) || isDigit(ch) || ch === '-';
}

function isNonPrintableCodePoint(ch: string): boolean {
  if (ch === '') return false;

  const code = ch.charCodeAt(0);

  return (
    (code >= 0x00 && code <= 0x08) ||
    code === 0x0B ||
    (code >= 0x0E && code <= 0x1F) ||
    code === 0x7F
  );
}
