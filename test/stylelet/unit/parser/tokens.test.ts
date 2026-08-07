import { describe, expect, it } from 'vitest';
import {
  decodeStylesheetBytes, filterCodePoints, HashTokenFlag, NumericSign, NumberTokenFlag,
  tokenize, TokenKind,
} from '../../../../src/stylelet/syntax/tokens';

describe('filterCodePoints', () => {
  it('should filter code points correctly', () => {
    expect(filterCodePoints('a\r\nb')).toBe('a\nb');
    expect(filterCodePoints('a\rb')).toBe('a\nb');
    expect(filterCodePoints('a\fb')).toBe('a\nb');
    expect(filterCodePoints('a\0b')).toBe('a\uFFFDb');
    expect(filterCodePoints('\uD800')).toBe('\uFFFD');
    expect(filterCodePoints('\uDC00')).toBe('\uFFFD');
    expect(filterCodePoints('💩')).toBe('💩');
  });
});

function view(input: string): unknown[] {
  return tokenize(input).map((token) => {
    switch (token.type) {
      case TokenKind.Ident: return ['ident', token.value];
      case TokenKind.Function: return ['function', token.value];
      case TokenKind.Url: return ['url', token.value];
      case TokenKind.BadUrl: return ['bad-url'];
      case TokenKind.Number: return ['number', token.value, token.flag, token.sign];
      case TokenKind.Percentage: return ['percentage', token.value, token.sign];
      case TokenKind.Dimension: return ['dimension', token.value, token.flag, token.unit, token.sign];
      case TokenKind.Whitespace: return ['ws'];
      case TokenKind.String: return ['string', token.value];
      case TokenKind.BadString: return ['bad-string'];
      case TokenKind.Delim: return ['delim', token.value];
      case TokenKind.Hash: return ['hash', token.value, token.flag];
      case TokenKind.AtKeyword: return ['at', token.value];
      case TokenKind.CDO: return ['CDO'];
      case TokenKind.CDC: return ['CDC'];
      case TokenKind.LeftParen: return ['('];
      case TokenKind.RightParen: return [')'];
      case TokenKind.Comma: return [','];
      case TokenKind.Colon: return [':'];
      case TokenKind.Semicolon: return [';'];
      case TokenKind.LeftBracket: return ['['];
      case TokenKind.RightBracket: return [']'];
      case TokenKind.LeftBrace: return ['{'];
      case TokenKind.RightBrace: return ['}'];
      default: return [token.type];
    }
  });
}

describe('style tokenizer consumers', () => {
  it('consume comments removes comments without creating whitespace', () => {
    expect(view('/**/a')).toEqual([
      ['ident', 'a'],
    ]);

    expect(view('/**//**/a')).toEqual([
      ['ident', 'a'],
    ]);

    expect(view('a/**/b')).toEqual([
      ['ident', 'a'],
      ['ident', 'b'],
    ]);
  });

  it('consume comments consumes rest of input on unterminated comment', () => {
    expect(view('a/* unterminated b')).toEqual([
      ['ident', 'a'],
    ]);
  });

  it('consume a token recognizes unicode ranges only when allowed', () => {
    expect(tokenize('U+416 U+4?? U+400-4ff', true)).toMatchObject([
      { type: TokenKind.UnicodeRange, start: 0x416, end: 0x416 },
      { type: TokenKind.Whitespace },
      { type: TokenKind.UnicodeRange, start: 0x400, end: 0x4ff },
      { type: TokenKind.Whitespace },
      { type: TokenKind.UnicodeRange, start: 0x400, end: 0x4ff },
    ]);

    expect(view('U+416')).toEqual([
      ['ident', 'U'],
      ['number', 416, NumberTokenFlag.Integer, NumericSign.Plus],
    ]);
  });

  it('consume numeric token returns number, percentage, and dimension tokens', () => {
    expect(view('123')).toEqual([
      ['number', 123, NumberTokenFlag.Integer, NumericSign.None],
    ]);

    expect(view('+.5')).toEqual([
      ['number', 0.5, NumberTokenFlag.Number, NumericSign.Plus],
    ]);

    expect(view('1e0')).toEqual([
      ['number', 1, NumberTokenFlag.Number, NumericSign.None],
    ]);

    expect(view('10%')).toEqual([
      ['percentage', 10, NumericSign.None],
    ]);

    expect(view('12px')).toEqual([
      ['dimension', 12, NumberTokenFlag.Integer, 'px', NumericSign.None],
    ]);
  });

  it('consume numeric token preserves its optional sign character', () => {
    expect(tokenize('+1 -2 3 +4% -5px')).toMatchObject([
      { type: TokenKind.Number, sign: NumericSign.Plus },
      { type: TokenKind.Whitespace },
      { type: TokenKind.Number, sign: NumericSign.Minus },
      { type: TokenKind.Whitespace },
      { type: TokenKind.Number, sign: NumericSign.None },
      { type: TokenKind.Whitespace },
      { type: TokenKind.Percentage, sign: NumericSign.Plus },
      { type: TokenKind.Whitespace },
      { type: TokenKind.Dimension, sign: NumericSign.Minus },
    ]);
  });

  it('consume numeric token decodes escaped dimension units', () => {
    expect(view('1\\70 x')).toEqual([
      ['dimension', 1, NumberTokenFlag.Integer, 'px', NumericSign.None],
    ]);
  });

  it('consume ident-like token returns ident and function tokens', () => {
    expect(view('foo')).toEqual([
      ['ident', 'foo'],
    ]);

    expect(view('foo(')).toEqual([
      ['function', 'foo'],
    ]);
  });

  it('consume ident-like token handles url special cases', () => {
    expect(view('url(foo)')).toEqual([
      ['url', 'foo'],
    ]);

    expect(view('url("foo")')).toEqual([
      ['function', 'url'],
      ['string', 'foo'],
      [')'],
    ]);

    expect(view('url(foo"bar);a')).toEqual([
      ['bad-url'],
      [';'],
      ['ident', 'a'],
    ]);
  });

  it('consume string token handles quoted strings, escapes, EOF, and bad strings', () => {
    expect(view('"abc"')).toEqual([
      ['string', 'abc'],
    ]);

    expect(view("'abc'")).toEqual([
      ['string', 'abc'],
    ]);

    expect(view('"\\41 "')).toEqual([
      ['string', 'A'],
    ]);

    expect(view('"' + 'a\\' + '\n' + 'b' + '"')).toEqual([
      ['string', 'ab'],
    ]);

    expect(view('"abc')).toEqual([
      ['string', 'abc'],
    ]);

    expect(view('"a\nb')).toEqual([
      ['bad-string'],
      ['ws'],
      ['ident', 'b'],
    ]);
  });

  it('consume url token handles whitespace, EOF, escapes, and bad urls', () => {
    expect(view('url(foo)')).toEqual([
      ['url', 'foo'],
    ]);

    expect(view('url(  foo  )')).toEqual([
      ['url', 'foo'],
    ]);

    expect(view('url(foo')).toEqual([
      ['url', 'foo'],
    ]);

    expect(view('url(foo\\)bar)')).toEqual([
      ['url', 'foo)bar'],
    ]);

    expect(view('url(foo bar)')).toEqual([
      ['bad-url'],
    ]);

    expect(view('url(foo\\\nbar);a')).toEqual([
      ['bad-url'],
      [';'],
      ['ident', 'a'],
    ]);
  });

  it('consume escaped code point decodes simple, hex, and replacement escapes', () => {
    expect(view('a\\?b')).toEqual([
      ['ident', 'a?b'],
    ]);

    expect(view('\\31 0')).toEqual([
      ['ident', '10'],
    ]);

    expect(view('\\000026B')).toEqual([
      ['ident', '&B'],
    ]);

    expect(view('\\0 ')).toEqual([
      ['ident', '\uFFFD'],
    ]);

    expect(view('\\D800 ')).toEqual([
      ['ident', '\uFFFD'],
    ]);

    expect(view('\\110000 ')).toEqual([
      ['ident', '\uFFFD'],
    ]);

    expect(view('\\')).toEqual([
      ['ident', '\uFFFD'],
    ]);
  });

  it('consume number converts decimal and exponent representations', () => {
    expect(view('.5')).toEqual([
      ['number', 0.5, NumberTokenFlag.Number, NumericSign.None],
    ]);

    expect(view('-.5')).toEqual([
      ['number', -0.5, NumberTokenFlag.Number, NumericSign.Minus],
    ]);

    expect(view('1.25')).toEqual([
      ['number', 1.25, NumberTokenFlag.Number, NumericSign.None],
    ]);

    expect(view('1e2')).toEqual([
      ['number', 100, NumberTokenFlag.Number, NumericSign.None],
    ]);

    expect(view('1E-2')).toEqual([
      ['number', 0.01, NumberTokenFlag.Number, NumericSign.None],
    ]);

    expect(view('+1.2e+3')).toEqual([
      ['number', 1200, NumberTokenFlag.Number, NumericSign.Plus],
    ]);
  });

  it('consume number only treats exponent syntax as exponent when followed by a digit', () => {
    expect(view('1e')).toEqual([
      ['dimension', 1, NumberTokenFlag.Integer, 'e', NumericSign.None],
    ]);

    expect(view('1e+')).toEqual([
      ['dimension', 1, NumberTokenFlag.Integer, 'e', NumericSign.None],
      ['delim', '+'],
    ]);
  });

  it('consume bad url remnants resumes after the url recovery point', () => {
    expect(view('url(foo bar);a')).toEqual([
      ['bad-url'],
      [';'],
      ['ident', 'a'],
    ]);

    expect(view('url(foo"bar);a')).toEqual([
      ['bad-url'],
      [';'],
      ['ident', 'a'],
    ]);

    expect(view('url(foo\\\nbar);a')).toEqual([
      ['bad-url'],
      [';'],
      ['ident', 'a'],
    ]);

    expect(view('url(foo"bad\\)still);a')).toEqual([
      ['bad-url'],
      [';'],
      ['ident', 'a'],
    ]);
  });

  it('consume token coalesces whitespace and returns punctuation tokens', () => {
    expect(view(' \t\n')).toEqual([
      ['ws'],
    ]);

    expect(view('a /**/ b')).toEqual([
      ['ident', 'a'],
      ['ws'],
      ['ident', 'b'],
    ]);

    expect(view('(),:;[]{}')).toEqual([
      ['('],
      [')'],
      [','],
      [':'],
      [';'],
      ['['],
      [']'],
      ['{'],
      ['}'],
    ]);
  });

  it('consume token handles hash tokens and at-keywords', () => {
    expect(view('#abc')).toEqual([
      ['hash', 'abc', HashTokenFlag.Id],
    ]);

    expect(view('#123')).toEqual([
      ['hash', '123', HashTokenFlag.Unrestricted],
    ]);

    expect(view('#-1')).toEqual([
      ['hash', '-1', HashTokenFlag.Unrestricted],
    ]);

    expect(view('#')).toEqual([
      ['delim', '#'],
    ]);

    expect(view('@media')).toEqual([
      ['at', 'media'],
    ]);

    expect(view('@1')).toEqual([
      ['delim', '@'],
      ['number', 1, NumberTokenFlag.Integer, NumericSign.None],
    ]);
  });

  it('consume token distinguishes signs, dots, and hyphens from numbers and idents', () => {
    expect(view('+')).toEqual([
      ['delim', '+'],
    ]);

    expect(view('+1')).toEqual([
      ['number', 1, NumberTokenFlag.Integer, NumericSign.Plus],
    ]);

    expect(view('+.5')).toEqual([
      ['number', 0.5, NumberTokenFlag.Number, NumericSign.Plus],
    ]);

    expect(view('.')).toEqual([
      ['delim', '.'],
    ]);

    expect(view('.5')).toEqual([
      ['number', 0.5, NumberTokenFlag.Number, NumericSign.None],
    ]);

    expect(view('-')).toEqual([
      ['delim', '-'],
    ]);

    expect(view('-1')).toEqual([
      ['number', -1, NumberTokenFlag.Integer, NumericSign.Minus],
    ]);

    expect(view('--foo')).toEqual([
      ['ident', '--foo'],
    ]);
  });

  it('consume token handles CDO, CDC, and reverse-solidus dispatch', () => {
    expect(view('<!--')).toEqual([
      ['CDO'],
    ]);

    expect(view('-->')).toEqual([
      ['CDC'],
    ]);

    expect(view('<!x')).toEqual([
      ['delim', '<'],
      ['delim', '!'],
      ['ident', 'x'],
    ]);

    expect(view('\\goo')).toEqual([
      ['ident', 'goo'],
    ]);

    expect(view('\\_foo')).toEqual([
      ['ident', '_foo'],
    ]);

    expect(view('\\\nfoo')).toEqual([
      ['delim', '\\'],
      ['ws'],
      ['ident', 'foo'],
    ]);
  });

  it('consume token treats escaped quotes as escaped code points, not string delimiters', () => {
    expect(view('\\22 ')).toEqual([
      ['ident', '"'],
    ]);

    expect(view('"\\22 "')).toEqual([
      ['string', '"'],
    ]);

    expect(view("'\\27 '")).toEqual([
      ['string', "'"],
    ]);
  });

  it('uses the restricted non-ASCII ident code point ranges', () => {
    const allowed = [
      '\u00B7', '\u00C0', '\u037D', '\u037F', '\u200C', '\u200D',
      '\u203F', '\u2040', '\u2070', '\u2C00', '\u3001', '\uF900',
      '\uFDF0', '\uFFFD', '𐀀', '💩',
    ];
    const excluded = [
      '\u0080', '\u00B6', '\u00D7', '\u00F7', '\u037E', '\u200E',
      '\u203E', '\u2041', '\u206F', '\u2FF0', '\u3000', '\uFDD0',
      '\uFFFE', '\uFFFF',
    ];

    for (const input of allowed) {
      expect(tokenize(input), input).toMatchObject([
        { type: TokenKind.Ident, value: input },
      ]);
    }

    for (const input of excluded) {
      expect(tokenize(input), input).toMatchObject([
        { type: TokenKind.Delim, value: input },
      ]);
    }
  });

});

describe('3.2. The input byte stream', () => {
  const textEncoder = new TextEncoder();

  it('defaults to UTF-8 and replaces malformed input', () => {
    expect(decodeStylesheetBytes(textEncoder.encode('a { color: é; }')))
      .toBe('a { color: é; }');
    expect(decodeStylesheetBytes(new Uint8Array([0xE2, 0x82])))
      .toBe('\uFFFD');
  });

  it('prefers a transport encoding over declarations and the environment', () => {
    const bytes = new Uint8Array([
      ...textEncoder.encode('@charset "utf-8"; '),
      0xE9,
    ]);

    expect(decodeStylesheetBytes(bytes, {
      transportEncoding: 'windows-1252',
      environmentEncoding: 'utf-8',
    })).toBe('@charset "utf-8"; é');
  });

  it('recognizes an exact byte-level encoding declaration', () => {
    const bytes = new Uint8Array([
      ...textEncoder.encode('@charset "windows-1252"; '),
      0xE9,
    ]);

    expect(decodeStylesheetBytes(bytes))
      .toBe('@charset "windows-1252"; é');
  });

  it('uses the environment after invalid transport and declaration labels', () => {
    const bytes = new Uint8Array([
      ...textEncoder.encode('@charset "not-an-encoding"; '),
      0xE9,
    ]);

    expect(decodeStylesheetBytes(bytes, {
      transportEncoding: 'also-not-an-encoding',
      environmentEncoding: 'windows-1252',
    })).toBe('@charset "not-an-encoding"; é');
  });

  it('treats a declared UTF-16 encoding as UTF-8', () => {
    const bytes = textEncoder.encode('@charset "utf-16le"; é');

    expect(decodeStylesheetBytes(bytes))
      .toBe('@charset "utf-16le"; é');
  });

  it('gives a byte order mark precedence over the fallback encoding', () => {
    const bytes = new Uint8Array([
      0xEF, 0xBB, 0xBF,
      ...textEncoder.encode('é'),
    ]);

    expect(decodeStylesheetBytes(bytes, {
      transportEncoding: 'windows-1252',
    })).toBe('é');
  });

  it('supports the replacement and x-user-defined encodings', () => {
    expect(decodeStylesheetBytes(new Uint8Array([0x61, 0x62]), {
      transportEncoding: 'iso-2022-kr',
    })).toBe('\uFFFD');

    expect(decodeStylesheetBytes(new Uint8Array([0x41, 0x80, 0xFF]), {
      transportEncoding: 'x-user-defined',
    })).toBe(`A${String.fromCodePoint(0xF800, 0xF87F)}`);
  });
});
