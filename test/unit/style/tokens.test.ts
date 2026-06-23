import { describe, expect, it } from 'vitest';
import { filterCodePoints, NumberTokenFlag, TokenKind, tokenize, HashTokenFlag } from '../../../src/stylelet/parser/tokens';

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
    switch (token.kind) {
      case TokenKind.Ident: return ['ident', token.value];
      case TokenKind.Function: return ['function', token.value];
      case TokenKind.Url: return ['url', token.value];
      case TokenKind.BadUrl: return ['bad-url'];
      case TokenKind.Number: return ['number', token.value, token.flag, token.repr];
      case TokenKind.Percentage: return ['percentage', token.value, token.repr];
      case TokenKind.Dimension: return ['dimension', token.value, token.flag, token.unit, token.repr];
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
      default: return [token.kind];
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

  it('consume numeric token returns number, percentage, and dimension tokens', () => {
    expect(view('123')).toEqual([
      ['number', 123, NumberTokenFlag.Integer, '123'],
    ]);

    expect(view('+.5')).toEqual([
      ['number', 0.5, NumberTokenFlag.Number, '+.5'],
    ]);

    expect(view('1e0')).toEqual([
      ['number', 1, NumberTokenFlag.Number, '1e0'],
    ]);

    expect(view('10%')).toEqual([
      ['percentage', 10, '10%'],
    ]);

    expect(view('12px')).toEqual([
      ['dimension', 12, NumberTokenFlag.Integer, 'px', '12px'],
    ]);
  });

  it('consume numeric token decodes escaped dimension units', () => {
    expect(view('1\\70 x')).toEqual([
      ['dimension', 1, NumberTokenFlag.Integer, 'px', '1\\70 x'],
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
      ['number', 0.5, NumberTokenFlag.Number, '.5'],
    ]);

    expect(view('-.5')).toEqual([
      ['number', -0.5, NumberTokenFlag.Number, '-.5'],
    ]);

    expect(view('1.25')).toEqual([
      ['number', 1.25, NumberTokenFlag.Number, '1.25'],
    ]);

    expect(view('1e2')).toEqual([
      ['number', 100, NumberTokenFlag.Number, '1e2'],
    ]);

    expect(view('1E-2')).toEqual([
      ['number', 0.01, NumberTokenFlag.Number, '1E-2'],
    ]);

    expect(view('+1.2e+3')).toEqual([
      ['number', 1200, NumberTokenFlag.Number, '+1.2e+3'],
    ]);
  });

  it('consume number only treats exponent syntax as exponent when followed by a digit', () => {
    expect(view('1e')).toEqual([
      ['dimension', 1, NumberTokenFlag.Integer, 'e', '1e'],
    ]);

    expect(view('1e+')).toEqual([
      ['dimension', 1, NumberTokenFlag.Integer, 'e', '1e'],
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
      ['number', 1, NumberTokenFlag.Integer, '1'],
    ]);
  });

  it('consume token distinguishes signs, dots, and hyphens from numbers and idents', () => {
    expect(view('+')).toEqual([
      ['delim', '+'],
    ]);

    expect(view('+1')).toEqual([
      ['number', 1, NumberTokenFlag.Integer, '+1'],
    ]);

    expect(view('+.5')).toEqual([
      ['number', 0.5, NumberTokenFlag.Number, '+.5'],
    ]);

    expect(view('.')).toEqual([
      ['delim', '.'],
    ]);

    expect(view('.5')).toEqual([
      ['number', 0.5, NumberTokenFlag.Number, '.5'],
    ]);

    expect(view('-')).toEqual([
      ['delim', '-'],
    ]);

    expect(view('-1')).toEqual([
      ['number', -1, NumberTokenFlag.Integer, '-1'],
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

});
