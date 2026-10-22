import { describe, expect, it } from 'vitest';
import { decode } from '../../../../src/encoding/index';
import { createStyleletEnvironment, defaultStyleletEnvironment } from '../../../../src/stylelet/environment';
import {
  decodeStylesheetBytes as decodeBytes, filterCodePoints, HashTokenFlag, identToken,
  NumericSign, NumberTokenFlag, TokenKind, WhitespaceToken, type DecodeStylesheetOptions,
} from '../../../../src/stylelet/syntax/tokens';
import { TokenList } from '../../../../src/stylelet/syntax/token-list';

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

  it('handles consecutive replacements without losing valid surrogate pairs', () => {
    expect(filterCodePoints('\r\r\n\f\0\uD800\uD83D\uDCA9\uDC00'))
      .toBe('\n\n\n\uFFFD\uFFFD💩\uFFFD');
  });
});

function view(input: string): unknown[] {
  return TokenList.tokenize(input).tokens.map((token) => {
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
    expect(TokenList.tokenize('U+416 U+4?? U+400-4ff', true).tokens).toMatchObject([
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

  it('limits each unicode-range segment to six digits without validating the range', () => {
    expect(TokenList.tokenize('U+1234567 U+??????? U+20-10 U+FFFFFF', true).tokens).toMatchObject([
      { type: TokenKind.UnicodeRange, start: 0x123456, end: 0x123456 },
      { type: TokenKind.Number, value: 7 },
      { type: TokenKind.Whitespace },
      { type: TokenKind.UnicodeRange, start: 0, end: 0xFFFFFF },
      { type: TokenKind.Delim, value: '?' },
      { type: TokenKind.Whitespace },
      { type: TokenKind.UnicodeRange, start: 0x20, end: 0x10 },
      { type: TokenKind.Whitespace },
      { type: TokenKind.UnicodeRange, start: 0xFFFFFF, end: 0xFFFFFF },
    ]);
    expect(TokenList.tokenize('U+1-1234567', true).tokens).toMatchObject([
      { type: TokenKind.UnicodeRange, start: 1, end: 0x123456 },
      { type: TokenKind.Number, value: 7 },
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
    expect(TokenList.tokenize('+1 -2 3 +4% -5px').tokens).toMatchObject([
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

  it.each(['💩', '\\💩', '\\1f4a9 '])('preserves an astral code point in %s', (input) => {
    expect(view(input)).toEqual([['ident', '💩']]);
    expect(view(`"${input}"`)).toEqual([['string', '💩']]);
    expect(view(`url(${input})`)).toEqual([['url', '💩']]);
  });

  it.each(['\r', '\r\n', '\f'])('preprocesses %j before string and escape consumption', (newline) => {
    expect(view(`"a\\${newline}b"`)).toEqual([['string', 'ab']]);
    expect(view(`\\41${newline}B`)).toEqual([['ident', 'AB']]);
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

  it.each([
    { name: 'long fraction', input: `0.${'1'.repeat(400)}`, value: 0.1111111111111111 },
    { name: 'large integer with a cancelling exponent', input: `1${'0'.repeat(400)}e-400`, value: 1 },
    { name: 'subnormal value', input: '5e-324', value: Number.MIN_VALUE },
    { name: 'zero with a large exponent', input: '0e9999', value: 0 },
    { name: 'negative zero with a large exponent', input: '-0e9999', value: -0 },
  ])('consume number converts $name without intermediate overflow or underflow', ({ input, value }) => {
    expect(TokenList.tokenize(input).tokens).toMatchObject([{ type: TokenKind.Number, value }]);
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

  it('consume token groups consecutive whitespace and returns punctuation tokens', () => {
    expect(view(' \t\n')).toEqual([
      ['ws'],
    ]);

    expect(view('a /**/ b')).toEqual([
      ['ident', 'a'],
      ['ws'],
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

  it('retains separate source ranges for whitespace on either side of a comment', () => {
    const list = TokenList.tokenize('a /**/ b');
    expect(list.tokens).toEqual([
      identToken('a'), WhitespaceToken, WhitespaceToken, identToken('b'),
    ]);
    expect(list.tokens.map((_, i) => list.sourceText(i, i + 1))).toEqual(['a', ' ', ' ', 'b']);
    expect(list.sourceText(1, 3)).toBe(' /**/ ');
  });

  it('records UTF-16 token offsets while retaining surrounding comments in the full source', () => {
    const list = TokenList.tokenize('/**/💩\r\n\\41 /**/');
    expect(list.tokens).toMatchObject([
      { type: TokenKind.Ident, value: '💩' },
      { type: TokenKind.Whitespace },
      { type: TokenKind.Ident, value: 'A' },
    ]);
    expect(list.tokens.map((_, i) => list.sourceText(i, i + 1))).toEqual(['💩', '\n', '\\41 ']);
    expect(list.sourceText()).toBe('/**/💩\n\\41 /**/');
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
      expect(TokenList.tokenize(input).tokens, input).toMatchObject([
        { type: TokenKind.Ident, value: input },
      ]);
    }

    for (const input of excluded) {
      expect(TokenList.tokenize(input).tokens, input).toMatchObject([
        { type: TokenKind.Delim, value: input },
      ]);
    }
  });

});

describe.each([
  ['native', defaultStyleletEnvironment],
  ['Encoding', createStyleletEnvironment({ decodeText: decode })],
] as const)('3.2. The input byte stream (%s)', (_host, env) => {
  const textEncoder = new TextEncoder();
  const decodeStylesheetBytes = (bytes: Uint8Array, options: DecodeStylesheetOptions = {}) =>
    decodeBytes(bytes, options, env);

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
      environmentEncoding: 'UTF-8',
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

  it.each([
    ' @charset "windows-1252";',
    '/**/@charset "windows-1252";',
    '@CHARSET "windows-1252";',
    '@charset  "windows-1252";',
    '@charset\t"windows-1252";',
    "@charset 'windows-1252';",
    '@charset "windows-1252" ;',
    '@charset "windows-1252"',
    '@charset "windows\\2d 1252";',
    '@charset "windows-1252\u0080";',
  ])('does not treat %j as an encoding declaration', (prefix) => {
    const bytes = new Uint8Array([...textEncoder.encode(prefix), 0xE9]);
    expect(decodeStylesheetBytes(bytes)).toBe(prefix + '\uFFFD');
  });

  it.each([1024, 1025])('bounds the complete encoding signature at %i bytes', (length) => {
    const prefix = '@charset "windows-1252';
    const declaration = prefix + ' '.repeat(length - prefix.length - 2) + '";';
    const bytes = new Uint8Array([...textEncoder.encode(declaration), 0xE9]);
    expect(decodeStylesheetBytes(bytes)).toBe(declaration + (length === 1024 ? 'é' : '\uFFFD'));
  });

  it('uses a valid declaration after an invalid transport label', () => {
    const prefix = '@charset "windows-1252";';
    const bytes = new Uint8Array([...textEncoder.encode(prefix), 0xE9]);
    expect(decodeStylesheetBytes(bytes, {
      transportEncoding: 'invalid', environmentEncoding: 'UTF-8',
    })).toBe(prefix + 'é');
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

  it('does not Unicode-fold encoding labels', () => {
    expect(decodeStylesheetBytes(Uint8Array.of(0xE9), {
      transportEncoding: '\u212Aoi8-r',
      environmentEncoding: 'windows-1252',
    })).toBe('é');
  });

  it.each(['utf-16le', 'utf-16be', 'utf-16'])('treats declared %s as UTF-8', (label) => {
    const source = `@charset "${label}"; é`;
    const bytes = textEncoder.encode(source);

    expect(decodeStylesheetBytes(bytes)).toBe(source);
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

  it.each([
    { label: 'utf-16le', encoding: 'UTF-16LE', bom: [0xFF, 0xFE], bytes: [0xE9, 0] },
    { label: 'utf-16be', encoding: 'UTF-16BE', bom: [0xFE, 0xFF], bytes: [0, 0xE9] },
  ] as const)('honors $label from transport, the referrer, or a BOM', ({ label, encoding, bom, bytes }) => {
    expect(decodeStylesheetBytes(new Uint8Array(bytes), { transportEncoding: label })).toBe('é');
    expect(decodeStylesheetBytes(new Uint8Array(bytes), { environmentEncoding: encoding })).toBe('é');
    expect(decodeStylesheetBytes(new Uint8Array([...bom, ...bytes]), {
      transportEncoding: 'windows-1252',
    })).toBe('é');
  });

  it('consumes only a leading BOM, preserving later U+FEFF characters', () => {
    expect(decodeStylesheetBytes(textEncoder.encode('\uFEFF\uFEFFa\uFEFF')))
      .toBe('\uFEFFa\uFEFF');
  });

  it('supports the replacement and x-user-defined encodings', () => {
    expect(decodeStylesheetBytes(new Uint8Array([0x61, 0x62]), {
      transportEncoding: 'iso-2022-kr',
    })).toBe('\uFFFD');

    expect(decodeStylesheetBytes(new Uint8Array([0x41, 0x80, 0xFF]), {
      transportEncoding: 'x-user-defined',
    })).toBe(`A${String.fromCodePoint(0xF780, 0xF7FF)}`);
  });
});
