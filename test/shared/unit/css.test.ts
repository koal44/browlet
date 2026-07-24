import { describe, expect, it } from 'vitest';
import {
  asciiDashMatch, asciiEndsWith, asciiEquals, asciiHasCssToken, asciiIncludes, asciiStartsWith,
  cssIdentUnescape, escapeRegExp, hasCssToken,
} from '../../../src/shared/css';

// Test-only CSS.escape() polyfill.
//
// cssIdentUnescape() maps many valid selector spellings onto the same semantic
// string, while cssIdentEscape() chooses only one valid spelling. Ergo, it CANNOT
// reconstruct the spelling the author used.
//
// Do not use this in the selector engine. Matching must decode selector tokens
// to semantic DOM values, not re-escape DOM values and compare selector text.
function cssIdentEscape(ident: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(ident);
  }

  if (ident === '-') return '\\-';

  let out = '';
  const first = ident.charCodeAt(0);

  for (let i = 0, l = ident.length; i < l; i++) {
    const c = ident.charCodeAt(i);
    const digit = c >= 0x30 && c <= 0x39;
    out +=
      c === 0x00 ?                         '\uFFFD' :               // NUL
      c >= 0x01 && c <= 0x1F ?             `\\${c.toString(16)} ` : // control chars
      c === 0x7F ?                         `\\${c.toString(16)} ` : // delete
      digit && i === 0 ?                   `\\${c.toString(16)} ` : // leading digit
      digit && i === 1 && first === 0x2D ? `\\${c.toString(16)} ` : // second char digit after -
      digit ?                              ident.charAt(i) :        // 0-9
      c >= 0x80 ?                          ident.charAt(i) :        // non-ASCII
      c === 0x2D || c === 0x5F ?           ident.charAt(i) :        // - or _
      c >= 0x41 && c <= 0x5A ?             ident.charAt(i) :        // A-Z
      c >= 0x61 && c <= 0x7A ?             ident.charAt(i) :        // a-z
      `\\${ident.charAt(i)}`;  // ASCII punctuation / syntax
  }
  return out;
}


describe('attribute value regex preparation', () => {
  function attrValuePatternSource(rawAttrVal: string): string {
    return escapeRegExp(cssIdentUnescape(rawAttrVal));
  }

  function makeAttrValueRegex(rawAttrVal: string, p1 = '^', p2 = '$', flags = ''): RegExp {
    const source = `${p1}${attrValuePatternSource(rawAttrVal)}${p2}`;

    // Mirror generated selector code:
    // new RegExp(JSON.stringify(source), JSON.stringify(flags))
    const parsedSource = JSON.parse(JSON.stringify(source)) as string;
    const parsedFlags = JSON.parse(JSON.stringify(flags)) as string;
    return new RegExp(parsedSource, parsedFlags);
  }

  function matches(rawAttrVal: string, actual: string, p1 = '^', p2 = '$', flags = ''): boolean {
    return makeAttrValueRegex(rawAttrVal, p1, p2, flags).test(actual);
  }

  it('decodes CSS escapes before escaping the value for regex syntax', () => {
    expect(attrValuePatternSource('\\e9')).toBe('é');
    expect(attrValuePatternSource('\\31 23')).toBe('123');
    expect(attrValuePatternSource('foo\\"bar')).toBe('foo"bar');
    expect(attrValuePatternSource('foo\\\\bar')).toBe('foo\\\\bar');
    expect(attrValuePatternSource('foo\\a bar')).toBe('foo\nbar');
  });

  it('prevents selector values from becoming regex syntax', () => {
    expect(matches('a.b', 'a.b')).toBe(true);
    expect(matches('a.b', 'acb')).toBe(false);

    expect(matches('a+b', 'a+b')).toBe(true);
    expect(matches('a+b', 'aaab')).toBe(false);

    expect(matches('[x]', '[x]')).toBe(true);
    expect(matches('[x]', 'x')).toBe(false);

    expect(matches('a|b', 'a|b')).toBe(true);
    expect(matches('a|b', 'a')).toBe(false);
    expect(matches('a|b', 'b')).toBe(false);
  });

  it('handles decoded line terminators through RegExp string construction', () => {
    expect(matches('foo\\a bar', 'foo\nbar')).toBe(true);
    expect(matches('foo\\00000d bar', 'foo\rbar')).toBe(true);
  });

  it('can be embedded through JSON.stringify for generated RegExp construction', () => {
    const source = `^${attrValuePatternSource('foo\\a bar')}$`;
    const expr = `new RegExp(${JSON.stringify(source)})`;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
    const re = Function(`return ${expr}`)() as RegExp;

    expect(re.test('foo\nbar')).toBe(true);
  });

  it('does not need slash escaping when using new RegExp source strings', () => {
    expect(attrValuePatternSource('a/b')).toBe('a/b');
    expect(matches('a/b', 'a/b')).toBe(true);
  });

  it('supports operator-style regex templates', () => {
    // ^= starts with
    expect(matches('foo.bar', 'foo.bar-baz', '^', '')).toBe(true);
    expect(matches('foo.bar', 'xfoo.bar', '^', '')).toBe(false);

    // *= contains
    expect(matches('foo.bar', 'x foo.bar y', '', '')).toBe(true);
    expect(matches('foo.bar', 'x fooXbar y', '', '')).toBe(false);

    // $= ends with
    expect(matches('foo.bar', 'baz-foo.bar', '', '$')).toBe(true);
    expect(matches('foo.bar', 'foo.bar-baz', '', '$')).toBe(false);
  });

  it('round-trips escaped selector values into literal regex matches', () => {
    for (const literal of [
      'plain',
      'a.b',
      'a+b',
      '[x]',
      '(x)',
      'a/b',
      'a|b',
      'a$b',
      '^x',
      'foo"bar',
      "foo'bar",
      'foo\\bar',
      'foo\nbar',
      'é',
    ]) {
      const selectorValue = cssIdentEscape(literal);
      expect(matches(selectorValue, literal)).toBe(true);
    }
  });
});


describe('cssIdentEscape', () => {
  it('escapes identifier syntax characters', () => {
    expect(cssIdentEscape('.foo#bar')).toBe('\\.foo\\#bar');
    expect(cssIdentEscape('()[]{}')).toBe('\\(\\)\\[\\]\\{\\}');
    expect(cssIdentEscape('foo.bar')).toBe('foo\\.bar');
    expect(cssIdentEscape('foo+bar')).toBe('foo\\+bar');
    expect(cssIdentEscape('foo[bar]')).toBe('foo\\[bar\\]');
    expect(cssIdentEscape('foo\\bar')).toBe('foo\\\\bar');
  });

  it('preserves ordinary identifier characters', () => {
    expect(cssIdentEscape('foo')).toBe('foo');
    expect(cssIdentEscape('foo_bar')).toBe('foo_bar');
    expect(cssIdentEscape('foo-bar')).toBe('foo-bar');
    expect(cssIdentEscape('--a')).toBe('--a');
    expect(cssIdentEscape('a0b9')).toBe('a0b9');
  });

  it('handles leading digit rules', () => {
    expect(cssIdentEscape('0')).toBe('\\30 ');
    expect(cssIdentEscape('1abc')).toBe('\\31 abc');
    expect(cssIdentEscape('-1abc')).toBe('-\\31 abc');
    expect(cssIdentEscape('a1')).toBe('a1');
  });

  it('escapes a lone hyphen', () => {
    expect(cssIdentEscape('-')).toBe('\\-');
  });

  it('handles NUL, controls, and delete', () => {
    expect(cssIdentEscape('\0')).toBe('\ufffd');
    expect(cssIdentEscape('\n')).toBe('\\a ');
    expect(cssIdentEscape('\r')).toBe('\\d ');
    expect(cssIdentEscape('\f')).toBe('\\c ');
    expect(cssIdentEscape('\t')).toBe('\\9 ');
    expect(cssIdentEscape(String.fromCharCode(0x7f))).toBe('\\7f ');
  });

  it('preserves non-ASCII characters', () => {
    expect(cssIdentEscape('föo')).toBe('föo');
    expect(cssIdentEscape('你好')).toBe('你好');
  });

  it('terminates hex escapes so following hex digits are not consumed', () => {
    expect(cssIdentEscape('1a')).toBe('\\31 a');
    expect(cssIdentEscape('\na')).toBe('\\a a');
  });
});

describe('cssIdentUnescape', () => {
  it('decodes simple escaped punctuation', () => {
    expect(cssIdentUnescape('foo\\.bar')).toBe('foo.bar');
    expect(cssIdentUnescape('foo\\#bar')).toBe('foo#bar');
    expect(cssIdentUnescape('foo\\+bar')).toBe('foo+bar');
    expect(cssIdentUnescape('\\(\\)\\[\\]\\{\\}')).toBe('()[]{}');
  });

  it('decodes hex escapes', () => {
    expect(cssIdentUnescape('\\30 ')).toBe('0');
    expect(cssIdentUnescape('\\31 abc')).toBe('1abc');
    expect(cssIdentUnescape('-\\31 abc')).toBe('-1abc');
    expect(cssIdentUnescape('f\\F6 o')).toBe('föo');
    expect(cssIdentUnescape('f\\f6 o')).toBe('föo');
    expect(cssIdentUnescape('f\\0000F6 o')).toBe('föo');
  });

  it('consumes optional whitespace after hex escapes', () => {
    expect(cssIdentUnescape('\\31 a')).toBe('1a');
    expect(cssIdentUnescape('\\31  a')).toBe('1 a');
    expect(cssIdentUnescape('\\000031a')).toBe('1a');
  });

  it('decodes escaped quotes and backslashes as semantic identifier characters', () => {
    expect(cssIdentUnescape('\\"')).toBe('"');
    expect(cssIdentUnescape("\\'")).toBe("'");
    expect(cssIdentUnescape('foo\\\\bar')).toBe('foo\\bar');
  });

  it('replaces NUL code point escapes with U+FFFD if following CSS parser behavior', () => {
    expect(cssIdentUnescape('\\0 ')).toBe('\ufffd');
    expect(cssIdentUnescape('\\000000 ')).toBe('\ufffd');
  });

  it('decodes escaped identifiers back to their semantic value', () => {
    const cases = [
      'foo',
      'foo.bar',
      '.foo#bar',
      '()[]{}',
      '--a',
      '-1abc',
      '1abc',
      'a0b9',
      'foo_bar',
      'foo-bar',
      'föo',
      '你好',
      'foo\\bar',
      '"quote"',
      "'quote'",
      '\n',
      '\t',
      String.fromCharCode(0x7f),
    ];

    for (const value of cases) {
      expect(cssIdentUnescape(cssIdentEscape(value))).toBe(value);
    }
  });

  it('round-trips NUL as U+FFFD, matching CSS.escape behavior', () => {
    expect(cssIdentUnescape(cssIdentEscape('\0'))).toBe('\ufffd');
  });

  it('should unescape valid identifiers', () => {
    expect(cssIdentUnescape('[data-nwsapi-scope] > *|item')).toBe('[data-nwsapi-scope] > *|item');
  });

  it('should replace invalid escapes with U+FFFD', () => {
    expect(cssIdentUnescape('eofA\\')).toBe('eofA\uFFFD');
    expect(cssIdentUnescape('\\')).toBe('\uFFFD');
    expect(cssIdentUnescape('eofB\\\\')).toBe('eofB\\');
  });

  it('consumes CRLF as one optional hex-escape terminator', () => {
    expect(cssIdentUnescape('spac\\65\r\nsA')).toBe('spacesA');
    expect(cssIdentUnescape('spac\\65\nsA')).toBe('spacesA');
    expect(cssIdentUnescape('spac\\65\rsA')).toBe('spacesA');
  });

  it('replaces invalid code point escapes with U+FFFD', () => {
    expect(cssIdentUnescape('\\0 ')).toBe('\ufffd');
    expect(cssIdentUnescape('\\000000 ')).toBe('\ufffd');
    expect(cssIdentUnescape('\\110000')).toBe('\ufffd');
    expect(cssIdentUnescape('\\D800')).toBe('\ufffd');
    expect(cssIdentUnescape('\\DFFF')).toBe('\ufffd');
  });
});


describe('ASCII-insensitive string predicates', () => {
  describe('asciiEquals', () => {
    it('matches ASCII case-insensitively', () => {
      expect(asciiEquals('AlphaBeta', 'alphabeta')).toBe(true);
      expect(asciiEquals('ALPHABETA', 'alphabeta')).toBe(true);
      expect(asciiEquals('alphabeta', 'alphabeta')).toBe(true);
    });

    it('requires equal length and exact non-ASCII code units', () => {
      expect(asciiEquals('Alpha', 'alpha!')).toBe(false);
      expect(asciiEquals('föo', 'föo')).toBe(true);
      expect(asciiEquals('FöO', 'föo')).toBe(true);
      expect(asciiEquals('FÖO', 'föo')).toBe(false);
      expect(asciiEquals('FÖO', 'fÖo')).toBe(true);
    });

    it('handles empty strings', () => {
      expect(asciiEquals('', '')).toBe(true);
      expect(asciiEquals('x', '')).toBe(false);
      expect(asciiEquals('', 'x')).toBe(false);
    });
  });

  describe('asciiStartsWith', () => {
    it('matches ASCII prefixes case-insensitively', () => {
      expect(asciiStartsWith('Commit-Start', 'commit')).toBe(true);
      expect(asciiStartsWith('commit-start', 'commit')).toBe(true);
      expect(asciiStartsWith('xcommit-start', 'commit')).toBe(false);
    });

    it('does not Unicode-fold non-ASCII characters', () => {
      expect(asciiStartsWith('FöO-bar', 'föo')).toBe(true);
      expect(asciiStartsWith('FÖO-bar', 'föo')).toBe(false);
      expect(asciiStartsWith('FÖO-bar', 'fÖo')).toBe(true);
    });

    it('handles empty prefix consistently with startsWith', () => {
      expect(asciiStartsWith('abc', '')).toBe(true);
      expect(asciiStartsWith('', '')).toBe(true);
      expect(asciiStartsWith('', 'a')).toBe(false);
    });
  });

  describe('asciiEndsWith', () => {
    it('matches ASCII suffixes case-insensitively', () => {
      expect(asciiEndsWith('End-Commit', 'commit')).toBe(true);
      expect(asciiEndsWith('end-commit', 'commit')).toBe(true);
      expect(asciiEndsWith('end-commit-x', 'commit')).toBe(false);
    });

    it('does not Unicode-fold non-ASCII characters', () => {
      expect(asciiEndsWith('xx-FöO', 'föo')).toBe(true);
      expect(asciiEndsWith('xx-FÖO', 'föo')).toBe(false);
      expect(asciiEndsWith('xx-FÖO', 'fÖo')).toBe(true);
    });

    it('handles empty suffix consistently with endsWith', () => {
      expect(asciiEndsWith('abc', '')).toBe(true);
      expect(asciiEndsWith('', '')).toBe(true);
      expect(asciiEndsWith('', 'a')).toBe(false);
    });
  });

  describe('asciiIncludes', () => {
    it('matches ASCII substrings case-insensitively', () => {
      expect(asciiIncludes('/Repos/Example/Commits/ABC', 'commits')).toBe(true);
      expect(asciiIncludes('/repos/example/commits/abc', 'commits')).toBe(true);
      expect(asciiIncludes('/repos/example/branches/abc', 'commits')).toBe(false);
    });

    it('finds matches at beginning, middle, and end', () => {
      expect(asciiIncludes('ABCxxx', 'abc')).toBe(true);
      expect(asciiIncludes('xxxABCxxx', 'abc')).toBe(true);
      expect(asciiIncludes('xxxABC', 'abc')).toBe(true);
    });

    it('does not Unicode-fold non-ASCII characters', () => {
      expect(asciiIncludes('xxFöOxx', 'föo')).toBe(true);
      expect(asciiIncludes('xxFÖOxx', 'föo')).toBe(false);
      expect(asciiIncludes('xxFÖOxx', 'fÖo')).toBe(true);
    });

    it('treats empty expected as no match for selector-operator use', () => {
      expect(asciiIncludes('abc', '')).toBe(false);
      expect(asciiIncludes('', '')).toBe(false);
    });
  });

  describe('asciiDashMatch', () => {
    it('matches exact or prefix followed by hyphen', () => {
      expect(asciiDashMatch('en', 'en')).toBe(true);
      expect(asciiDashMatch('en-US', 'en')).toBe(true);
      expect(asciiDashMatch('english', 'en')).toBe(false);
      expect(asciiDashMatch('fr-US', 'en')).toBe(false);
    });

    it('matches ASCII case-insensitively', () => {
      expect(asciiDashMatch('EN', 'en')).toBe(true);
      expect(asciiDashMatch('EN-us', 'en')).toBe(true);
      expect(asciiDashMatch('eN-us', 'en')).toBe(true);
    });

    it('does not Unicode-fold non-ASCII characters', () => {
      expect(asciiDashMatch('föo-bar', 'föo')).toBe(true);
      expect(asciiDashMatch('FöO-bar', 'föo')).toBe(true);
      expect(asciiDashMatch('FÖO-bar', 'föo')).toBe(false);
      expect(asciiDashMatch('FÖO-bar', 'fÖo')).toBe(true);
    });

    it('handles empty expected according to dash-match selector semantics', () => {
      expect(asciiDashMatch('', '')).toBe(true);
      expect(asciiDashMatch('-', '')).toBe(true);
      expect(asciiDashMatch('-x', '')).toBe(true);
      expect(asciiDashMatch('x', '')).toBe(false);
      expect(asciiDashMatch('x-', '')).toBe(false);
    });

    it('uses UTF-16 indexing consistently for astral-plane prefixes', () => {
      expect(asciiDashMatch('a😀b', 'a😀b')).toBe(true);
      expect(asciiDashMatch('a😀b-c', 'a😀b')).toBe(true);
      expect(asciiDashMatch('a😀bc', 'a😀b')).toBe(false);

      expect(asciiDashMatch('😀', '😀')).toBe(true);
      expect(asciiDashMatch('😀-x', '😀')).toBe(true);
      expect(asciiDashMatch('😀x', '😀')).toBe(false);
    });
  });
});

describe('hasCssToken', () => {
  it('matches whole whitespace-separated tokens', () => {
    expect(hasCssToken('foo octicon bar', 'octicon')).toBe(true);
    expect(hasCssToken('foo octicon bar', 'foo')).toBe(true);
    expect(hasCssToken('foo octicon bar', 'bar')).toBe(true);
  });

  it('does not match substrings inside tokens', () => {
    expect(hasCssToken('foo octicon bar', 'oct')).toBe(false);
    expect(hasCssToken('foo octicon bar', 'icon')).toBe(false);
    expect(hasCssToken('foobar', 'foo')).toBe(false);
  });

  it('uses CSS whitespace only', () => {
    expect(hasCssToken('foo\tbar', 'bar')).toBe(true);
    expect(hasCssToken('foo\nbar', 'bar')).toBe(true);
    expect(hasCssToken('foo\fbar', 'bar')).toBe(true);
    expect(hasCssToken('foo\rbar', 'bar')).toBe(true);
    expect(hasCssToken('foo bar', 'bar')).toBe(true);

    // Vertical tab U+000B is not CSS whitespace.
    expect(hasCssToken('foo\vbar', 'bar')).toBe(false);
    expect(hasCssToken('foo\vbar', 'foo\vbar')).toBe(true);
  });

  it('handles leading, trailing, and repeated CSS whitespace', () => {
    expect(hasCssToken('  foo   bar  ', 'foo')).toBe(true);
    expect(hasCssToken('  foo   bar  ', 'bar')).toBe(true);
    expect(hasCssToken('     ', 'foo')).toBe(false);
  });

  it('does not match an empty token', () => {
    expect(hasCssToken('foo bar', '')).toBe(false);
    expect(hasCssToken('', '')).toBe(false);
  });

  it('is case-sensitive by itself', () => {
    expect(hasCssToken('foo UnitTest bar', 'UnitTest')).toBe(true);
    expect(hasCssToken('foo UnitTest bar', 'unittest')).toBe(false);
  });
});

describe('asciiHasCssToken', () => {
  it('matches whole CSS whitespace-separated tokens ASCII-insensitively', () => {
    expect(asciiHasCssToken('foo UnitTest bar', 'unittest')).toBe(true);
    expect(asciiHasCssToken('foo UNITTEST bar', 'unittest')).toBe(true);
    expect(asciiHasCssToken('foo unittest bar', 'unittest')).toBe(true);
  });

  it('does not match substrings inside tokens', () => {
    expect(asciiHasCssToken('foo UnitTest bar', 'unit')).toBe(false);
    expect(asciiHasCssToken('foo UnitTest bar', 'test')).toBe(false);
    expect(asciiHasCssToken('fooUnitTestbar', 'unittest')).toBe(false);
  });

  it('uses CSS whitespace only', () => {
    expect(asciiHasCssToken('foo\tBAR', 'bar')).toBe(true);
    expect(asciiHasCssToken('foo\nBAR', 'bar')).toBe(true);
    expect(asciiHasCssToken('foo\fBAR', 'bar')).toBe(true);
    expect(asciiHasCssToken('foo\rBAR', 'bar')).toBe(true);
    expect(asciiHasCssToken('foo BAR', 'bar')).toBe(true);

    // U+000B vertical tab is not CSS whitespace.
    expect(asciiHasCssToken('foo\vBAR', 'bar')).toBe(false);
    expect(asciiHasCssToken('foo\vBAR', 'foo\vbar')).toBe(true);
  });

  it('handles leading, trailing, and repeated CSS whitespace', () => {
    expect(asciiHasCssToken('  FOO   BAR  ', 'foo')).toBe(true);
    expect(asciiHasCssToken('  FOO   BAR  ', 'bar')).toBe(true);
    expect(asciiHasCssToken('     ', 'foo')).toBe(false);
  });

  it('does not match an empty token', () => {
    expect(asciiHasCssToken('foo bar', '')).toBe(false);
    expect(asciiHasCssToken('', '')).toBe(false);
  });

  it('does not Unicode-fold non-ASCII characters', () => {
    expect(asciiHasCssToken('foo FöO bar', 'föo')).toBe(true);
    expect(asciiHasCssToken('foo FÖO bar', 'föo')).toBe(false);
    expect(asciiHasCssToken('foo FÖO bar', 'fÖo')).toBe(true);
  });
});
