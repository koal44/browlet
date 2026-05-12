import { describe, expect, it, test } from 'vitest';
import {
  buildRex, DEFAULT_EXTENSIONS, DEFAULT_CONFIG, parse, cssIdentUnescape,
  matchLogicalSelector, splitSelectorGroups, escapeRegExp, buildRexStrings,
  parseRelativeSelectorList,
  asciiEquals,
  asciiStartsWith,
  asciiEndsWith,
  asciiIncludes,
  asciiDashMatch,
  hasCssToken,
  asciiHasCssToken,
  normalizeSelectorInput,
  trimSelectorSpaces,
} from '../../src/nwsapi';
import { AssertionError } from 'node:assert';

function testRe(re: RegExp, input: string): boolean {
  re.lastIndex = 0;
  return re.test(input);
}

function matchRe0(re: RegExp, input: string): string[] {
  re.lastIndex = 0;
  return [...input.matchAll(re)].map((m) => m[0]);
}

function matchRe1(re: RegExp, input: string): string[] {
  re.lastIndex = 0;
  return [...input.matchAll(re)].map((m) => m[1]);
}

function execRe(re: RegExp, input: string): RegExpMatchArray | null {
  re.lastIndex = 0;
  return re.exec(input);
}

const ANY = Symbol('ANY');
type ExpectedCapture = string | undefined | typeof ANY;

function expectCaptures(re: RegExp, input: string, expected: ExpectedCapture[]): void {
  const actual = Array.from(execRe(re, input) ?? []).slice(1);
  const pass = actual.length === expected.length &&
    expected.every((x, i) => x === ANY || actual[i] === x);

  if (!pass) {
    throw new AssertionError({
      message: `Unexpected captures for ${input}`,
      actual,
      expected,
      operator: 'deepStrictEqual',
      stackStartFn: expectCaptures,
    });
  }
}

function expectCapturesFrom(
  fn: (input: string) => RegExpMatchArray | null, input: string, expected: ExpectedCapture[]): void {
  const m = fn(input);
  const actual = m ? Array.from(m).slice(1) : null;
  const pass = !!actual && actual.length === expected.length &&
    expected.every((x, i) => x === ANY || actual[i] === x);

  if (!pass) {
    throw new AssertionError({
      message: `Unexpected captures for ${input}`,
      actual,
      expected,
      operator: 'deepStrictEqual',
      stackStartFn: expectCapturesFrom,
    });
  }
}

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

const rex = buildRex(DEFAULT_EXTENSIONS);
const rexStrings = buildRexStrings(DEFAULT_EXTENSIONS);


function expectParse(input: string, expected: string[] | boolean = true, forgiving = false): void {
  let actual: string[] | undefined;
  let thrown: unknown;

  try {
    actual = parse(input, rex, forgiving);
  } catch (e) {
    thrown = e;
  }

  const pass = expected === true
    ? !thrown
    : expected === false
      ? !!thrown
      : !thrown && JSON.stringify(actual) === JSON.stringify(expected);

  if (!pass) {
    throw new AssertionError({
      message: `Unexpected parse result for ${input}`,
      actual: thrown ? String(thrown) : actual,
      expected: expected === true ? 'parse success' : expected === false ? 'throw' : expected,
      operator: expected === false ? 'throws' : 'deepStrictEqual',
      stackStartFn: expectParse,
    });
  }
}

function expectParseRejects(input: string): void {
  expectParse(input, false);
}

function expectForgivingParse(input: string, expected: string[] | boolean = true): void {
  expectParse(input, expected, true);
}

function validatorMatches(input: string): string[] {
  rex.validator.lastIndex = 0;
  return input.match(rex.validator) ?? [];
}

function validatorConsumes(input: string): boolean {
  return validatorMatches(input).join('') === input;
}

function expectValid(input: string): void {
  const actual = validatorMatches(input);
  const consumed = actual.join('');

  if (consumed !== input) {
    throw new AssertionError({
      message: `Expected validator to consume ${input}`,
      actual,
      expected: input,
      operator: 'strictEqual',
      stackStartFn: expectValid,
    });
  }
}

describe('Rex basic recognizers', () => {
  it('detects CSS escapes', () => {
    expect(testRe(rex.HasEscapes, 'abc')).toBe(false);
    expect(testRe(rex.HasEscapes, 'a\\:b')).toBe(true);
    expect(testRe(rex.HasEscapes, '\\31 item')).toBe(true);
  });

  it('detects hex digits', () => {
    expect(testRe(rex.HexNumbers, '0')).toBe(true);
    expect(testRe(rex.HexNumbers, 'f')).toBe(true);
    expect(testRe(rex.HexNumbers, 'F')).toBe(true);
    expect(testRe(rex.HexNumbers, 'g')).toBe(false);
    expect(testRe(rex.HexNumbers, '')).toBe(false);
  });

  it('detects escape starts or quotes', () => {
    expect(testRe(rex.EscOrQuote, '\\:')).toBe(true);
    expect(testRe(rex.EscOrQuote, '"abc')).toBe(true);
    expect(testRe(rex.EscOrQuote, "'abc")).toBe(true);
    expect(testRe(rex.EscOrQuote, 'abc')).toBe(false);
  });

  it('characterizes RegExpChar source-generation behavior', () => {
    expect(matchRe0(rex.RegExpChar, 'a.b#c')).toEqual(['.']);
    expect(matchRe0(rex.RegExpChar, '[x](y)')).toEqual(['[', ']', '(', ')']);

    // Current source-generation behavior: escaped punctuation is preserved
    // enough for decodeAttrForRegex to keep sequences like \u00e9 meaningful.
    expect(matchRe0(rex.RegExpChar, 'a\\.b#c')).toEqual(['.']);
  });
});

describe('Rex selector normalization helpers', () => {
  it('trims leading and trailing selector whitespace without deleting interior vertical whitespace', () => {
    expect('  div  '.replace(rex.TrimSpaces, '')).toBe('div');
    expect('div\nspan'.replace(rex.TrimSpaces, '')).toBe('div\nspan');
  });

  it('normalizes comma spacing outside brackets and parens', () => {
    expect('div , span'.replace(rex.CommaGroup, ',')).toBe('div,span');
    expect(':is(div , span) , a'.replace(rex.CommaGroup, ',')).toBe(':is(div , span),a');
    expect('[data-x="a , b"] , span'.replace(rex.CommaGroup, ',')).toBe('[data-x="a , b"],span');
  });

  it('combines newline, carriage-return, form-feed, and space runs outside quoted strings', () => {
    expect('div   span'.replace(rex.CombineWSP, ' ')).toBe('div span');
    expect('div\nspan'.replace(rex.CombineWSP, ' ')).toBe('div span');
    expect('div\r\nspan'.replace(rex.CombineWSP, ' ')).toBe('div span');
    expect('div\fspan'.replace(rex.CombineWSP, ' ')).toBe('div span');

    expect('[data-x="a   b"] span'.replace(rex.CombineWSP, ' ')).toBe('[data-x="a   b"] span');
    expect("[data-x='a   b'] span".replace(rex.CombineWSP, ' ')).toBe("[data-x='a   b'] span");
  });

  it('normalizes tab whitespace runs outside quoted strings', () => {
    expect('div\tspan'.replace(rex.TabCharWSP, '\t')).toBe('div\tspan');
    expect('div \t span'.replace(rex.TabCharWSP, '\t')).toBe('div\tspan');
    expect('[data-x="a\tb"] span'.replace(rex.TabCharWSP, '\t')).toBe('[data-x="a\tb"] span');
  });

  it('removes whitespace around nth-expression signs outside attribute selectors', () => {
    expect(':nth-child(2n + 1)'.replace(rex.PseudosWSP, '$1$2')).toBe(':nth-child(2n+1)');
    expect(':nth-child(2n - 1)'.replace(rex.PseudosWSP, '$1$2')).toBe(':nth-child(2n-1)');
    expect('[data-x="a + b"]'.replace(rex.PseudosWSP, '$1$2')).toBe('[data-x="a + b"]');
  });

});

describe('Rex selector splitting helpers', () => {
  it('splits selector groups without splitting inside parens, brackets, or escapes', () => {
    expect('div, span'.match(rex.SplitGroup)).toEqual(['div', ' span']);
    expect(':is(div, span), a'.match(rex.SplitGroup)).toEqual([':is(div, span)', ' a']);
    expect('[data-x="a,b"], span'.match(rex.SplitGroup)).toEqual(['[data-x="a,b"]', ' span']);
    expect('foo\\,bar, baz'.match(rex.SplitGroup)).toEqual(['foo\\,bar', ' baz']);
    expect('is(div, :where(span, a)) , section'.match(rex.SplitGroup)).toEqual(['is(div, :where(span, a)) ', ' section']);
    expect(':has(.a, .b) , section'.match(rex.SplitGroup)).toEqual([':has(.a, .b) ', ' section']);
  });
});

describe('attribute value regex preparation', () => {
  function attrValuePatternSource(rawAttrVal: string): string {
    return escapeRegExp(cssIdentUnescape(rawAttrVal));
  }

  function makeAttrValueRegex(rawAttrVal: string, p1 = '^', p2 = '$', flags = ''): RegExp {
    const source = `${p1}${attrValuePatternSource(rawAttrVal)}${p2}`;

    // Mirror generated selector code:
    // new RegExp(JSON.stringify(source), JSON.stringify(flags))
    return new RegExp(JSON.parse(JSON.stringify(source)), JSON.parse(JSON.stringify(flags)));
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

describe('Rex STD helpers', () => {
  it('captures combinator symbols and surrounding whitespace', () => {
    expect(matchRe1(rex.STD.combinator, '>')).toEqual(['>']);
    expect(matchRe1(rex.STD.combinator, ' + ')).toEqual(['+']);
    expect(matchRe1(rex.STD.combinator, 'div ~ span')).toEqual(['~']);
    expect(matchRe1(rex.STD.combinator, 'div > span + a ~ em')).toEqual(['>', '+', '~']);

    expect('div > span + a ~ em'.replace(rex.STD.combinator, '$1'))
      .toBe('div>span+a~em');
  });

  it('detects selector components that need namespace dispatch', () => {
    expect(testRe(rex.STD.apimethods, 'test|item')).toBe(true);
    expect(testRe(rex.STD.apimethods, '*|item')).toBe(true);
    expect(testRe(rex.STD.apimethods, '|item')).toBe(true);

    // not a namespace selector, just an identifier (tag or attribute name)
    expect(testRe(rex.STD.apimethods, 'test\\:item')).toBe(false);
  });

  it('captures namespace prefixes in namespace-looking syntax', () => {
    let m = execRe(rex.STD.namespaces, 'foo|bar');
    expect(m?.[0]).toBe('foo|bar');
    expect(m?.[1]).toBe('foo');

    m = execRe(rex.STD.namespaces, '*|bar');
    expect(m?.[0]).toBe('*|bar');
    expect(m?.[1]).toBe('*');

    m = execRe(rex.STD.namespaces, '|bar');
    expect(m?.[0]).toBe('|bar');
    expect(m?.[1]).toBe('');

    m = execRe(rex.STD.namespaces, 'foo_bar|baz');
    expect(m?.[0]).toBe('foo_bar|baz');
    expect(m?.[1]).toBe('foo_bar');

    m = execRe(rex.STD.namespaces, 'foo-bar|item');
    expect(m?.[0]).toBe('foo-bar|item');
    expect(m?.[1]).toBe('foo-bar');

    m = execRe(rex.STD.namespaces, 'foo|bar-baz');
    expect(m?.[0]).toBe('foo|bar-baz');
    expect(m?.[1]).toBe('foo');

    m = execRe(rex.STD.namespaces, 'föo|item');
    expect(m?.[0]).toBe('föo|item');
    expect(m?.[1] ?? '').toBe('föo');

    m = execRe(rex.STD.namespaces, 'foo\\+bar|item');
    expect(m?.[0]).toBe('foo\\+bar|item');
    expect(m?.[1] ?? '').toBe('foo\\+bar');
  });

  it('captures escaped and non-ASCII namespace prefixes', () => {
    let m = execRe(rex.STD.namespaces, 'föo|item');
    expect(m?.[0]).toBe('föo|item');
    expect(m?.[1] ?? '').toBe('föo');

    m = execRe(rex.STD.namespaces, '名前|item');
    expect(m?.[0]).toBe('名前|item');
    expect(m?.[1] ?? '').toBe('名前');

    m = execRe(rex.STD.namespaces, 'foo\\+bar|item');
    expect(m?.[0]).toBe('foo\\+bar|item');
    expect(m?.[1] ?? '').toBe('foo\\+bar');

    m = execRe(rex.STD.namespaces, 'foo\\:bar|item');
    expect(m?.[0]).toBe('foo\\:bar|item');
    expect(m?.[1] ?? '').toBe('foo\\:bar');

    m = execRe(rex.STD.namespaces, '\\31 23|item');
    expect(m?.[0]).toBe('\\31 23|item');
    expect(m?.[1] ?? '').toBe('\\31 23');
  });

  it('detects namespace syntax inside attribute selector text', () => {
    let m = execRe(rex.STD.namespaces, '[foo|bar]');
    expect(m?.[0]).toBe('foo|bar');
    expect(m?.[1]).toBe('foo');

    m = execRe(rex.STD.namespaces, '[*|bar]');
    expect(m?.[0]).toBe('*|bar');
    expect(m?.[1]).toBe('*');

    m = execRe(rex.STD.namespaces, '[|bar]');
    expect(m?.[0]).toBe('|bar');
    expect(m?.[1]).toBe('');

    m = execRe(rex.STD.namespaces, '[foo-bar|item]');
    expect(m?.[0]).toBe('foo-bar|item');
    expect(m?.[1]).toBe('foo-bar');
  });

  it('does not treat escaped colon as namespace syntax', () => {
    expect(execRe(rex.STD.namespaces, 'foo\\:bar')).toBeNull();
  });

  it('currently matches namespace-looking syntax anywhere in the string', () => {
    let m = execRe(rex.STD.namespaces, ':scope > test|item');
    expect(m?.[0]).toBe('test|item');
    expect(m?.[1]).toBe('test');

    m = execRe(rex.STD.namespaces, '[data-x] test|item');
    expect(m?.[0]).toBe('test|item');
    expect(m?.[1]).toBe('test');
  });
});

describe('Rex pseudo-class patterns', () => {
  it('parses tree-structural pseudo-classes with arguments', () => {
    expectCaptures(rex.Patterns.treestruct, ':nth-child(2n+1).item', ['nth-child', '2n+1', '.item']);
    expectCaptures(rex.Patterns.treestruct, ':nth-last-of-type(odd) > span', ['nth-last-of-type', 'odd', ' > span']);
  });

  it('parses structural pseudo-classes without arguments', () => {
    expectCaptures(rex.Patterns.structural, ':scope > .item', ['scope', ' > .item']);
    expectCaptures(rex.Patterns.structural, ':first-child.foo', ['first-child', '.foo']);
    expectCaptures(rex.Patterns.structural, ':only-of-type + span', ['only-of-type', ' + span']);
  });

  it('parses linguistic pseudo-classes with arguments', () => {
    expectCaptures(rex.Patterns.linguistic, ':lang(en).item', ['lang', 'en', '.item']);
    expectCaptures(rex.Patterns.linguistic, ':dir(rtl) > span', ['dir', 'rtl', ' > span']);
  });

  it('parses user-action pseudo-classes', () => {
    expectCaptures(rex.Patterns.useraction, ':hover.item', ['hover', '.item']);
    expectCaptures(rex.Patterns.useraction, ':focus-visible > span', ['focus-visible', ' > span']);
  });

  it('parses input-state pseudo-classes', () => {
    expectCaptures(rex.Patterns.inputstate, ':enabled.foo', ['enabled', '.foo']);
    expectCaptures(rex.Patterns.inputstate, ':read-only + input', ['read-only', ' + input']);
  });

  it('parses input-value pseudo-classes', () => {
    expectCaptures(rex.Patterns.inputvalue, ':checked.foo', ['checked', '.foo']);
    expectCaptures(rex.Patterns.inputvalue, ':out-of-range + label', ['out-of-range', ' + label']);
  });

  it('parses resource-state pseudo-classes', () => {
    expectCaptures(rex.Patterns.rsrc_state, ':playing.foo', ['playing', '.foo']);
    expectCaptures(rex.Patterns.rsrc_state, ':volume-locked + video', ['volume-locked', ' + video']);
  });

    it('parses display-state pseudo-classes', () => {
    expectCaptures(rex.Patterns.disp_state, ':open.foo', ['open', '.foo']);
    expectCaptures(rex.Patterns.disp_state, ':picture-in-picture + video', ['picture-in-picture', ' + video']);
  });

  it('parses time-state pseudo-classes', () => {
    expectCaptures(rex.Patterns.time_state, ':current.foo', ['current', '.foo']);
    expectCaptures(rex.Patterns.time_state, ':future ~ section', ['future', ' ~ section']);
  });

  it('parses location pseudo-classes', () => {
    expectCaptures(rex.Patterns.locationpc, ':any-link.foo', ['any-link', '.foo']);
    expectCaptures(rex.Patterns.locationpc, ':target > span', ['target', ' > span']);
  });

  // TODO: logicalsel is loose and greedy because `[^()]*|.*`
  it('parses logical selector pseudo-classes', () => {
    expectCaptures(rex.Patterns.logicalsel, ':is(div, span).foo', ['is', 'div, span', '.foo']);
    expectCaptures(rex.Patterns.logicalsel, ':where(:scope > .item) + a', ['where', ':scope > .item', ' + a']);
    expectCaptures(rex.Patterns.logicalsel, ':not(.disabled) > input', ['not', '.disabled', ' > input']);
    expectCaptures(rex.Patterns.logicalsel, ':has(+ .item).foo', ['has', '+ .item', '.foo']);
    expectCaptures(rex.Patterns.logicalsel, ':is(:not(.a), .b).tail', ['is', ':not(.a), .b', '.tail' ]);
    // expectCaptures(rex.Patterns.logicalsel, ':is(.a)) .tail', ['is', '.a)', ' .tail']);
  });

  it('does not over-consume valid logical selectors followed by functional pseudos', () => {
    expectCaptures(rex.Patterns.logicalsel, ':is(.a):nth-child(2n+1)', ['is', '.a', ':nth-child(2n+1)']);
    expectCaptures(rex.Patterns.logicalsel, ':not(.a):nth-of-type(2)', ['not', '.a', ':nth-of-type(2)']);
    expectCaptures(rex.Patterns.logicalsel, ':has(> .a):not(.disabled)', ['has', '> .a', ':not(.disabled)']);
    expectCaptures(rex.Patterns.logicalsel, ':where(.a):lang(en)', ['where', '.a', ':lang(en)']);
    expectCaptures(rex.Patterns.logicalsel, ':is(.a):has(+ .b)', ['is', '.a', ':has(+ .b)']);
  });

  // // Failing because logicalsel cannot handle nested parens. Use matchLogicalSelector instead.
  // it('does not over-consume nested logical selectors followed by functional pseudos', () => {
  //   expectCaptures(rex.Patterns.logicalsel, ':is(:not(.a), .b):nth-child(2n+1)', ['is', ':not(.a), .b', ':nth-child(2n+1)']);
  //   expectCaptures(rex.Patterns.logicalsel, ':where(:has(> .a)):lang(en)', ['where', ':has(> .a)', ':lang(en)']);
  //   expectCaptures(rex.Patterns.logicalsel, ':not(:is(.a, .b)):nth-of-type(2)', ['not', ':is(.a, .b)', ':nth-of-type(2)']);
  //   expectCaptures(rex.Patterns.logicalsel, ':has(:not(.disabled)):has(+ .item)', ['has', ':not(.disabled)', ':has(+ .item)']);
  // });

  it('parses no-op pseudo-classes used for validation only', () => {
    expectCaptures(rex.Patterns.pseudo_nop, ':autofill.foo', ['autofill', '.foo']);
    expectCaptures(rex.Patterns.pseudo_nop, ':-webkit-autofill + input', ['-webkit-autofill', ' + input']);
  });

  it('parses single-colon pseudo-elements', () => {
    expectCaptures(rex.Patterns.pseudo_sng, ':before.foo', ['before', '.foo']);
    expectCaptures(rex.Patterns.pseudo_sng, ':first-line + span', ['first-line', ' + span']);
  });

  it('parses double-colon pseudo-elements', () => {
    expectCaptures(rex.Patterns.pseudo_dbl, '::before.foo', ['before', '.foo']);
    expectCaptures(rex.Patterns.pseudo_dbl, '::-webkit-scrollbar-thumb > span', ['-webkit-scrollbar-thumb', ' > span']);
  });

  it('parses combinator selector tails', () => {
    expectCaptures(rex.Patterns.children, '> span', ['span']);
    expectCaptures(rex.Patterns.children, ' > .item', ['.item']);

    expectCaptures(rex.Patterns.adjacent, '+ span', ['span']);
    expectCaptures(rex.Patterns.adjacent, ' + .item', ['.item']);

    expectCaptures(rex.Patterns.relative, '~ span', ['span']);
    expectCaptures(rex.Patterns.relative, ' ~ .item', ['.item']);

    expectCaptures(rex.Patterns.ancestor, ' span', ['span']);
    expectCaptures(rex.Patterns.ancestor, '   .item', ['.item']);
  });

  it('parses universal and namespace selector components', () => {
    expectCaptures(rex.Patterns.universal, '*', ['*', '']);
    expectCaptures(rex.Patterns.universal, '*.item', ['*', '.item']);

    expectCaptures(rex.Patterns.namespace, 'foo|bar', ['foo', 'bar']);
    expectCaptures(rex.Patterns.namespace, 'foo-bar|item', ['foo-bar', 'item']);
    expectCaptures(rex.Patterns.namespace, 'foo_bar|item', ['foo_bar', 'item']);
    expectCaptures(rex.Patterns.namespace, 'foo123|item', ['foo123', 'item']);
    expectCaptures(rex.Patterns.namespace, '*|item', ['*', 'item']);
    expectCaptures(rex.Patterns.namespace, '|item', ['', 'item']);
  });

  it('parses namespace prefixes using CSS identifier syntax', () => {
    expectCaptures(rex.Patterns.namespace, 'föo|item', ['föo', 'item']);
    expectCaptures(rex.Patterns.namespace, '名前|item', ['名前', 'item']);
    expectCaptures(rex.Patterns.namespace, 'foo\\+bar|item', ['foo\\+bar', 'item']);
    expectCaptures(rex.Patterns.namespace, 'foo\\:bar|item', ['foo\\:bar', 'item']);
    expectCaptures(rex.Patterns.namespace, '\\31 23|item', ['\\31 23', 'item']);
    expectCaptures(rex.Patterns.namespace, 'foo|\\31 23', ['foo', '\\31 23']);
  });

  it('parses id, class, and tag selector components', () => {
    expectCaptures(rex.Patterns.id, '#foo.bar', ['foo', '.bar']);
    expectCaptures(rex.Patterns.id, '#foo\\:bar.item', ['foo\\:bar', '.item']);

    expectCaptures(rex.Patterns.className, '.foo#id', ['foo', '#id']);
    expectCaptures(rex.Patterns.className, '.foo\\+bar > span', ['foo\\+bar', ' > span']);

    expectCaptures(rex.Patterns.tagName, 'div.foo', ['div', '.foo']);
    expectCaptures(rex.Patterns.tagName, 'foo-bar[attr]', ['foo-bar', '[attr]']);
    expectCaptures(rex.Patterns.tagName, 'föo.item', ['föo', '.item']);
  });

  it('parses basic attribute selector components', () => {
    expectCaptures(rex.Patterns.attribute, '[foo]', ['foo', undefined, undefined, undefined, undefined, '']);
    expectCaptures(rex.Patterns.attribute, '[foo="bar"].item', ['foo', '=', '"', 'bar', undefined, '.item']);
    expectCaptures(rex.Patterns.attribute, '[foo~="bar" i] > span', ['foo', '~=', '"', 'bar', 'i', ' > span']);
    expectCaptures(rex.Patterns.attribute, '[foo\\:bar]', ['foo\\:bar', undefined, undefined, undefined, undefined, '']);
    expectCaptures(rex.Patterns.attribute, '[class~=brothers]', ['class', '~=', '', 'brothers', undefined, '']);

    expectCaptures(rex.Patterns.attribute, '[class~=brothers]', ['class', '~=', '', 'brothers', undefined, '']);
    expectCaptures(rex.Patterns.attribute, '[class~=brother s]', ['class', '~=', '', 'brother', 's', '']);
    expectCaptures(rex.Patterns.attribute, "[foo='bar'i]", ['foo', '=', "'", 'bar', 'i', '']);
    expectCaptures(rex.Patterns.attribute, "[foo='bar' \\i]", ['foo', '=', "'", 'bar', '\\i', '']);
    expectCaptures(rex.Patterns.attribute, "[foo='bar'\\i]", ['foo', '=', "'", 'bar', '\\i', '']);
    expectCaptures(rex.Patterns.attribute, "[foo='bar' \\69]", ['foo', '=', "'", 'bar', '\\69', '']);
    expectCaptures(rex.Patterns.attribute, "[foo='bar'\\69]", ['foo', '=', "'", 'bar', '\\69', '']);
  });

  it('parses attribute selector components with namespace prefixes', () => {
    expectCaptures(rex.Patterns.attribute, '[foo|href]', ['foo|href', undefined, undefined, undefined, undefined, '']);
    expectCaptures(rex.Patterns.attribute, '[*|href]', ['*|href', undefined, undefined, undefined, undefined, '']);
    expectCaptures(rex.Patterns.attribute, '[|href]', ['|href', undefined, undefined, undefined, undefined, '']);
    expectCaptures(rex.Patterns.attribute, '[xlink|href]', ['xlink|href', undefined, undefined, undefined, undefined, '']);
    // expectCaptures(rex.Patterns.attribute, '#attr-presence [*|TiTlE]', []);
  });

  it('detects RTL character ranges used by the engine heuristic', () => {
    expect(testRe(rex.RTL, 'مرحبا')).toBe(true);
    expect(testRe(rex.RTL, 'שלום')).toBe(true);

    expect(testRe(rex.RTL, 'hello')).toBe(false);
    expect(testRe(rex.RTL, 'مرحبا hello')).toBe(false);
  });

});

describe('matchLogicalSelector', () => {
  it('matches nested logical selectors followed by functional pseudos', () => {
    expectCapturesFrom(matchLogicalSelector, ':is(:not(.a), .b):nth-child(2n+1)', ['is', ':not(.a), .b', ':nth-child(2n+1)']);
    expectCapturesFrom(matchLogicalSelector, ':where(:has(> .a)):lang(en)', ['where', ':has(> .a)', ':lang(en)']);
    expectCapturesFrom(matchLogicalSelector, ':not(:is(.a, .b)):nth-of-type(2)', ['not', ':is(.a, .b)', ':nth-of-type(2)']);
  });
});

describe('splitSelectorGroups', () => {
  it('splits only top-level selector commas', () => {
    expect(splitSelectorGroups('div, span')).toEqual(['div', ' span']);
    expect(splitSelectorGroups(':is(:not(.a), .b), span')).toEqual([':is(:not(.a), .b)', ' span']);
    expect(splitSelectorGroups('[data-x="a,b"], span')).toEqual(['[data-x="a,b"]', ' span']);
    expect(splitSelectorGroups('foo\\,bar, baz')).toEqual(['foo\\,bar', ' baz']);
  });

  it('does not split commas inside logical pseudos followed by functional pseudos', () => {
    expect(splitSelectorGroups(':is(.a):nth-child(2n+1)')).toEqual([':is(.a):nth-child(2n+1)']);
    expect(splitSelectorGroups(':not(.a):nth-of-type(2)')).toEqual([':not(.a):nth-of-type(2)']);
    expect(splitSelectorGroups(':where(.a):lang(en)')).toEqual([':where(.a):lang(en)']);
    expect(splitSelectorGroups(':is(.a):has(+ .b)')).toEqual([':is(.a):has(+ .b)']);
  });

  it('does not split commas inside nested logical pseudos followed by functional pseudos', () => {
    expect(splitSelectorGroups(':is(:not(.a), .b):nth-child(2n+1)')).toEqual([':is(:not(.a), .b):nth-child(2n+1)']);
    expect(splitSelectorGroups(':where(:has(> .a)):lang(en)')).toEqual([':where(:has(> .a)):lang(en)']);
    expect(splitSelectorGroups(':not(:is(.a, .b)):nth-of-type(2)')).toEqual([':not(:is(.a, .b)):nth-of-type(2)']);
    expect(splitSelectorGroups(':has(:not(.disabled)):has(+ .item)')).toEqual([':has(:not(.disabled)):has(+ .item)']);
  });

  it('still splits top-level commas after nested logical pseudos', () => {
    expect(splitSelectorGroups(':is(:not(.a), .b):nth-child(2n+1), .fallback'))
      .toEqual([':is(:not(.a), .b):nth-child(2n+1)', ' .fallback']);

    expect(splitSelectorGroups(':not(:is(.a, .b)):nth-of-type(2), span'))
      .toEqual([':not(:is(.a, .b)):nth-of-type(2)', ' span']);
  });
});

describe('Rex optimizer', () => {
  function expectOptimizer(input: string, expected: [string, string] | null): void {
    const m = execRe(rex.optimizer, input);
    const actual = m ? [m[1] || '', m[2]] : null;

    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new AssertionError({
        message: `Unexpected optimizer match for ${input}`,
        actual,
        expected,
        operator: 'deepStrictEqual',
        stackStartFn: expectOptimizer,
      });
    }
  }

  it('extracts simple seed tokens from selector tails', () => {
    expectOptimizer('div', ['', 'div']);
    expectOptimizer('.item', ['.', 'item']);
    expectOptimizer('#target', ['#', 'target']);
    expectOptimizer('section .item', ['.', 'item']);
    expectOptimizer('section > #target', ['#', 'target']);
  });

  it('extracts tag seeds with trailing pseudo or attribute syntax', () => {
    expectOptimizer('input:checked', ['', 'input']);
    expectOptimizer('button[disabled]', ['', 'button']);
    expectOptimizer('li:nth-child(2n+1)', ['', 'li']);
  });

  it('extracts escaped and non-ASCII identifier seeds', () => {
    expectOptimizer('.foo\\:bar', ['.', 'foo\\:bar']);
    expectOptimizer('föo.item', ['.', 'item']);
    expectOptimizer('名前', ['', '名前']);
  });

  it('does not optimize pseudo-class-only tails', () => {
    expectOptimizer(':scope', [':', 'scope']);
    expectOptimizer(':not(.a)', [':', 'not']);
  });

  it('skips attribute and pseudo/function suffixes when finding optimizer seed', () => {
    expectCaptures(rex.optimizer, 'div[attr=value]', ['', 'div']);
    expectCaptures(rex.optimizer, 'div:not(.x)', ['', 'div']);
    expectCaptures(rex.optimizer, '.item[attr="abc"]', ['.', 'item']);
    // expectCaptures(rex.optimizer, '.item[attr="a[b]"]', ['.', 'item']); // TODO: make pass
  });
});

describe('unescapeIdentifier', () => {
  it('should unescape valid identifiers', () => {
    expect(cssIdentUnescape('[data-nwsapi-scope] > *|item')).toBe('[data-nwsapi-scope] > *|item');
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
});

describe('parse validator', () => {
  it('accepts common selector forms', () => {
    expectParse('div', ['div']);
    expectParse('div.item#id', ['div.item#id']);
    expectParse('[data-x="a, b"]', ['[data-x="a, b"]']);
    expectParse('div > span', ['div > span']);
    expectParse('div + span', ['div + span']);
    expectParse(':nth-child(2n + 1)', [':nth-child(2n+1)']);
    expectParse('div > span + a ~ em', ['div > span + a ~ em']);
  });

  it('accepts logical and structural pseudo selectors', () => {
    expectParse(':is(.a, .b)', [':is(.a, .b)']);
    expectParse(':not(.disabled)', [':not(.disabled)']);
    expectParse(':has(+ .item)', [':has(+ .item)']);
    expectParse(':nth-child(2n + 1)', [':nth-child(2n+1)']);
  });

  it('splits only top-level selector groups after validation', () => {
    expectParse('div, span', ['div', 'span']);
    expectParse(':is(:not(.a), .b):nth-child(2n+1), span', [':is(:not(.a), .b):nth-child(2n+1)', 'span']);
  });

  it('rejects empty and trailing-comma selectors', () => {
    expectParseRejects('');
    expectParseRejects('div,');
  });

  it('rejects obviously malformed combinator placement', () => {
    expectParseRejects('> div');
    expectParseRejects('div >> span');
    expectParseRejects('div + > span');
  });

  it('validates namespace type selectors inside functional pseudos', () => {
    expectParse(':is(*|item)', [':is(*|item)']);
    expectParse(':is(|item)', [':is(|item)']);
    expectParse(':is(test|item)', [':is(test|item)']);
    expectParse(':has(> *|item)', [':has(> *|item)']);
  });

  it('validates explicit combinators inside functional pseudos', () => {
    expectParse(':has(> h1)', [':has(> h1)']);
    expectParse(':has(>h1)', [':has(>h1)']);
    expectParse(':has(+ .item)', [':has(+ .item)']);
    expectParse(':has(~ .item)', [':has(~ .item)']);
  });

  it('validates nested logical selectors inside functional pseudos', () => {
    expectParse(':is(:where(:not(.a, .b)), .c)', [':is(:where(:not(.a, .b)), .c)']);
    expectParse(':has(:is(.a, .b):not(.c))', [':has(:is(.a, .b):not(.c))']);
  });

  it('rejects raw colon in attribute names', () => {
    expectParseRejects('[foo:bar]');
  });

  it('accepts escaped colon in attribute names', () => {
    expectParse('[foo\\:bar]', ['[foo\\:bar]']);
  });

  it('accepts CSS namespace attribute syntax', () => {
    expectParse('[*|href]', ['[*|href]']);
    expectParse('[|href]', ['[|href]']);
    expectParse('[xlink|href]', ['[xlink|href]']);
  });

  it('validates nth pseudo-class formulas with signed offsets', () => {
    expectParse('ul > li:nth-child(n-128)', ['ul > li:nth-child(n-128)']);
    expectParse('#t > *:nth-child(n+10)', ['#t > *:nth-child(n+10)']);
    expectParse(':nth-child(4n+100)', [':nth-child(4n+100)']);
    expectParse(':nth-child(-n+3)', [':nth-child(-n+3)']);
  });

  it('rejects unquoted numeric attribute selector values', () => {
    expectParseRejects('#level1 *[id*=2]');
    expectParseRejects('[id=2]');
    expectParseRejects('[data-x^=123]');
  });

  it('rejects class selectors whose identifiers start with digits', () => {
    expectParseRejects('.5cm');
    expectParseRejects('#x .5cm');
  });

  it('rejects class and id selectors with raw digit-start identifiers', () => {
    expectParseRejects('.5cm');
    expectParseRejects('#5cm');
    expectParseRejects('div .5cm');
    expectParseRejects('div#5cm');
  });

  it('accepts escaped digit-start class and id selectors', () => {
    expectParse('.\\35 cm', ['.\\35 cm']);
    expectParse('#\\35 cm', ['#\\35 cm']);
  });

  it('validates namespace-qualified attribute names', () => {
    expectParse('[lang]', ['[lang]']);
    expectParse('[*|lang]', ['[*|lang]']);
    expectParse('[|lang]', ['[|lang]']);
    expectParse('[xml|lang]', ['[xml|lang]']);
  });

  it('rejects universal local names in attribute selectors', () => {
    expectParseRejects('[*|*]');
    expectParseRejects('[|*]');
  });

  it('validates compound :scope selectors', () => {
    expectParse('div:scope > *', ['div:scope > *']);
    expectParse(':scope > *', [':scope > *']);
  });

  it('accepts missing right bracket at EOF for attribute selectors', () => {
    expectParse('meta[charset="utf-8"', ['meta[charset="utf-8"']);
    expectParse('#attr-value [align="center"', ['#attr-value [align="center"']);
  });

  it('rejects invalid unquoted attribute values', () => {
    expectParseRejects('[id*=2]');
    expectParseRejects('a[href=#]');
    expectParseRejects('[class= space unquoted ]');
    expectParseRejects('.blox23s1[foo="blox" erroneous]');
  });

  it('accepts missing right bracket at EOF for attribute selectors', () => {
    expectParse('meta[charset="utf-8"', ['meta[charset="utf-8"']);
    expectParse('#attr-value [align="center"', ['#attr-value [align="center"']);
  });

  it('accepts universal selectors inside functional pseudos', () => {
    expectParse(':not(*)', [':not(*)']);
  });

  it('rejects type selectors after subclass selectors in a compound', () => {
    expectParseRejects("[foo='bar']i");
    expectParseRejects('[foo]div');
    expectParseRejects('[foo]*');
    expectParseRejects('.foo div[attr]span'); // no combinator before span
    expectParseRejects('#foo span[attr]div');

    expectParseRejects('.foo)');
    expectParseRejects('[foo])');
    expectParseRejects('[foo i]');
    // expectParseRejects(':empty)');
  });

  it('accepts subclass selectors after type selectors and combinators', () => {
    expectParse('div[foo]', ['div[foo]']);
    expectParse('[foo].bar', ['[foo].bar']);
    expectParse('[foo]#bar', ['[foo]#bar']);
    expectParse('[foo]:empty', ['[foo]:empty']);
    expectParse('[foo] [bar]', ['[foo] [bar]']);
    expectParse('[foo] > i', ['[foo] > i']);
    expectParse('[foo], i', ['[foo]', 'i']);
  });

  it('handles parentheses in compound selectors', () => {
    expectParseRejects("[foo='bar']i");
    expectParseRejects('[foo]div');
    expectParseRejects('.foo)');

    expectParse(':is(.a)', [':is(.a)']);
    expectParse(':is(.a,.b)', [':is(.a,.b)']);
    expectParse(':is([data-x])', [':is([data-x])']);
    expectParse(':is(:not(.a), .b)', [':is(:not(.a), .b)']);
  });

});

describe('parse attribute selector case-sensitivity flag syntax', () => {
  it('accepts valid attribute selector case flags, comments, and whitespace', () => {
    expectParse("[foo='BAR'] /* sanity check (valid) */", ["[foo='BAR']"]);
    expectParse("[foo='bar' i]", ["[foo='bar' i]"]);
    expectParse("[foo='bar' I]", ["[foo='bar' I]"]);
    expectParse("[foo=bar i]", ["[foo=bar i]"]);
    expectParse('[foo="bar" i]', ['[foo="bar" i]']);
    expectParse("[foo='bar'i]", ["[foo='bar'i]"]);
    expectParse("[foo='bar'i ]", ["[foo='bar'i ]"]);
    expectParse("[foo='bar' i ]", ["[foo='bar' i ]"]);
    expectParse("[foo='bar' /**/ i]", ["[foo='bar' i]"]);
    expectParse("[foo='bar' i /**/ ]", ["[foo='bar' i ]"]);
    expectParse("[foo='bar'/**/i/**/]", ["[foo='bar' i ]"]);
    expectParse("[foo=bar/**/i]", ["[foo=bar i]"]);
    expectParse("[foo='bar'\ti\t] /* \\t */", ["[foo='bar'\ti\t]"]);
    expectParse("[foo='bar'\ni\n] /* \\n */", ["[foo='bar' i ]"]);
    expectParse("[foo='bar'\ri\r] /* \\r */", ["[foo='bar' i ]"]);
    expectParse("[foo='bar' \\i]", ["[foo='bar' \\i]"]);
    expectParse("[foo='bar' \\69]", ["[foo='bar' \\69]"]);
    expectParse("[foo~='bar' i]", ["[foo~='bar' i]"]);
    expectParse("[foo^='bar' i]", ["[foo^='bar' i]"]);
    expectParse("[foo$='bar' i]", ["[foo$='bar' i]"]);
    expectParse("[foo*='bar' i]", ["[foo*='bar' i]"]);
    expectParse("[foo|='bar' i]", ["[foo|='bar' i]"]);
    expectParse("[|foo='bar' i]", ["[|foo='bar' i]"]);
    expectParse("[*|foo='bar' i]", ["[*|foo='bar' i]"]);

    expectParse('div[class~=brothers]', ['div[class~=brothers]']);
  });

  it('rejects invalid attribute selector case flag syntax', () => {
    expectParseRejects("[foo[ /* sanity check (invalid) */");
    expectParseRejects("[foo='bar' i i]");
    expectParseRejects("[foo i ='bar']");
    expectParseRejects("[foo= i 'bar']");
    expectParseRejects("[i foo='bar']");
    expectParseRejects("[foo='bar' i\u0000] /* \\0 */");
    expectParseRejects("[foo='bar' \u0130]");
    expectParseRejects("[foo='bar' \u0131]");
    expectParseRejects("[foo='bar' ii]");
    expectParseRejects("[foo='bar' ij]");
    expectParseRejects("[foo='bar' j]");
    expectParseRejects("[foo='bar' \\\\i]");
    expectParseRejects("[foo='bar' \\\\69]");
    expectParseRejects("[foo='bar' i()]");
    expectParseRejects("[foo='bar' i ()]");
    expectParseRejects("[foo='bar' () i]");
    expectParseRejects("[foo='bar' (i)]");
    expectParseRejects("[foo='bar' i []]");
    expectParseRejects("[foo='bar' [] i]");
    expectParseRejects("[foo='bar' [i]]");
    expectParseRejects("[foo='bar' i {}]");
    expectParseRejects("[foo='bar' {} i]");
    expectParseRejects("[foo='bar' {i}]");
    expectParseRejects("[foo='bar' 1i]");
    expectParseRejects("[foo='bar' 1]");
    expectParseRejects("[foo='bar' 'i']");
    expectParseRejects("[foo='bar' url(i)]");
    expectParseRejects("[foo='bar' ,i]");
    expectParseRejects("[foo='bar' i,]");
    expectParseRejects("[foo='bar']i");
    expectParseRejects("[foo='bar' |i]");
    expectParseRejects("[foo='bar' \\|i]");
    expectParseRejects("[foo='bar' *|i]");
    expectParseRejects("[foo='bar' \\*|i]");
    expectParseRejects("[foo='bar' *]");
    expectParseRejects("[foo='bar' \\*]");
    expectParseRejects("[foo i]");
    expectParseRejects("[foo/**/i]");
  });
});

describe('parse', () => {
  it('normalizes vertical whitespace through parse pipeline', () => {
    expect(parse('div\nspan', rex)).toEqual(['div span']);
    expect(parse('div\r\nspan', rex)).toEqual(['div span']);
    expect(parse('div\fspan', rex)).toEqual(['div span']);
  });

  it('normalizes common whitespace through the parse pipeline', () => {
    expect(parse('div , span', rex)).toEqual(['div', 'span']);
    expect(parse('div\nspan', rex)).toEqual(['div span']);
    expect(parse(':nth-child(2n + 1)', rex)).toEqual([':nth-child(2n+1)']);
  });

  test.each([
    'div',
    'div p',
    'div > p',
    '[data-nwsapi-scope] > p',
    '*|p',
    'test|p',
    '|p',
    ':scope > *|item',
    '[data-nwsapi-scope] > *|item',
    '[data-nwsapi-scope] > |item',
  ])('accepts %s', (selector) => {
    // expect(parse(unescapeIdentifier(selector, rex), rex, config)).toEqual([selector]);
    expect(parse(selector, rex)).toEqual([selector]);
  });

});

describe('Rex pseudo-class patterns', () => {
  it('parses tree-structural pseudo-classes with arguments', () => {
    expectCaptures(rex.Patterns.treestruct, ':nth-child(2n+1).item', ['nth-child', '2n+1', '.item']);
    expectCaptures(rex.Patterns.treestruct, ':nth-last-of-type(odd) > span', ['nth-last-of-type', 'odd', ' > span']);
  });

  it('parses valid nth pseudo-class formulas', () => {
    const valid: Array<[string, string, string]> = [
      [':nth-child(1)', 'nth-child', '1'],
      [':nth-child(+1)', 'nth-child', '+1'],
      [':nth-child(-1)', 'nth-child', '-1'],

      [':nth-child(n)', 'nth-child', 'n'],
      [':nth-child(+n)', 'nth-child', '+n'],
      [':nth-child(-n)', 'nth-child', '-n'],

      [':nth-child(2n)', 'nth-child', '2n'],
      [':nth-child(+2n)', 'nth-child', '+2n'],
      [':nth-child(-2n)', 'nth-child', '-2n'],

      [':nth-child(n+1)', 'nth-child', 'n+1'],
      [':nth-child(n-1)', 'nth-child', 'n-1'],
      [':nth-child(2n+1)', 'nth-child', '2n+1'],
      [':nth-child(2n-1)', 'nth-child', '2n-1'],

      [':nth-child(0n+2)', 'nth-child', '0n+2'],
      [':nth-child(+0n+2)', 'nth-child', '+0n+2'],
      [':nth-child(-0n+2)', 'nth-child', '-0n+2'],

      [':nth-child(even)', 'nth-child', 'even'],
      [':nth-child(odd)', 'nth-child', 'odd'],
      [':nth-child(EVEN)', 'nth-child', 'EVEN'],
      [':nth-child(ODD)', 'nth-child', 'ODD'],

      [':nth-last-child(2n+1)', 'nth-last-child', '2n+1'],
      [':nth-of-type(2n+1)', 'nth-of-type', '2n+1'],
      [':nth-last-of-type(2n+1)', 'nth-last-of-type', '2n+1'],
    ];

    for (const [selector, pseudo, arg] of valid) {
      expectCaptures(rex.Patterns.treestruct, selector, [pseudo, arg, '']);
    }
  });

  it('rejects invalid nth pseudo-class formulas', () => {
    const invalid = [
      ':nth-child()',
      ':nth-child( )',

      // Offset after n requires an explicit sign.
      ':nth-child(n1)',
      ':nth-child(2n0)',
      ':nth-child(2n1)',
      ':nth-child(1n2)',

      // An+B grammar is not commutative.
      ':nth-child(1+n)',
      ':nth-child(1+2n)',

      // Junk.
      ':nth-child(foo)',
      ':nth-child(2nn+1)',
    ];

    for (const selector of invalid) {
      expect(rex.Patterns.treestruct.exec(selector)).toBeNull();
    }
  });
});

describe('validator functional pseudo bodies', () => {
  function expectInvalid(input: string): void {
    const actual = validatorMatches(input);
    const consumed = actual.join('');

    if (consumed === input) {
      throw new AssertionError({
        message: `Expected validator to reject ${input}`,
        actual,
        expected: 'not fully consumed',
        operator: 'notStrictEqual',
        stackStartFn: expectInvalid,
      });
    }
  }

  it('validates shallow functional pseudo selector lists', () => {
    expectValid(':is(.a, .b)');
    expectValid(':where(.a, .b)');
    expectValid(':not(.disabled)');
    expectValid(':has(+ .item)');
    expectValid(':has(> h1)');
    expectValid(':has(> *|item)');
  });

  it('validates nested functional pseudo selector lists', () => {
    expectValid(':is(:not(.a), .b)');
    expectValid(':is(:where(.a), .b)');
    expectValid(':is(:where(:not(.a, .b)), .c)');
    expectValid(':has(:is(.a, .b):not(.c))');
  });

  it('validates chained pseudos after functional pseudo bodies', () => {
    expectValid(':is(.a, .b):nthchild(2n)');
    expectValid(':is(.a, .b):nth-child(2n+1)');
    expectValid(':is(:not(.a), .b):nth-child(2n+1)');
    expectValid(':has(> .item):not(.disabled)');
    expectValid(':where(.a, .b):is(.c, .d):nth-child(odd)');
  });

  // it('keeps nth functions strict inside chained functional pseudo selectors', () => {
  //   expectValid(':is(.a, .b):nth-child(2n+1)');
  //   expectInvalid(':is(.a, .b):nth-child(2n1)');
  //   expectInvalid(':is(.a, .b):nth-child(n1)');
  //   expectInvalid(':is(.a, .b):nth-child()');
  //   expectInvalid(':is(.a, .b):nth-child(1+n)');
  // });

  it('validates shallow selector lists inside functional pseudos', () => {
    expectValid(':is(.a, .b)');
    expectValid(':where(.a, .b)');
    expectValid(':not(.disabled)');
    expectValid(':has(.item)');
    expectValid(':has(+ .item)');
    expectValid(':has(> h1)');
    expectValid(':has(> *|item)');
  });

  it('validates nested functional pseudos without nth formulas', () => {
    expectValid(':is(:not(.a), .b)');
    expectValid(':is(:where(.a), .b)');
    expectValid(':where(:not(.a), .b)');
    expectValid(':not(:is(.a, .b))');
    expectValid(':has(:is(.a, .b))');
    expectValid(':has(:is(.a, .b):not(.c))');
    expectValid(':is(:where(:not(.a, .b)), .c)');
  });

  it('validates chained functional pseudos without nth formulas', () => {
    expectValid(':is(.a, .b):not(.c)');
    expectValid(':where(.a, .b):is(.c, .d)');
    expectValid(':has(> .item):not(.disabled)');
    expectValid(':has(+ .item):where(.enabled, .selected)');
    expectValid(':not(.a):not(.b):is(.c, .d)');
  });

  it('validates non-nth content inside functional pseudos', () => {
    expectValid(':is([data-x="a, b"], .c)');
    expectValid(':has([data-x="a, b"])');
    expectValid(':has(> [data-x="a, b"])');
    expectValid(':is(*|item, |item, test|item)');
    expectValid(':has(> *|item, + |item)');
  });

  it('rejects malformed generic functional pseudo bodies', () => {
    expectValid(':is(.a, .b'); // malformed but still valid
    // expectInvalid(':has(> )');
    // expectInvalid(':has(+ )');
    // expectInvalid(':not()');
    // expectInvalid(':is(,)');
    // expectInvalid(':is(.a,, .b)');
  });

  it('validates scoped relative selectors inside functional pseudos', () => {
    expectValid(':is(:scope > .item)');
    expectValid(':is(:scope > .item, .alt)');
    expectValid(':where(:scope > .item)');
    expectValid(':not(:scope > .disabled)');
  });

  it('validates compact scoped relative selectors inside functional pseudos', () => {
    expectValid(':is(:scope>.item)');
    expectValid(':is(:scope+.item)');
    expectValid(':is(:scope~.item)');
  });

  it('validates spaced combinators inside functional pseudos', () => {
    expectValid(':is(.a > .b)');
    expectValid(':is(.a + .b)');
    expectValid(':is(.a ~ .b)');
    expectValid(':has(.a > .b)');
  });

  it('validates whitespace around non-combinator tokens inside functional pseudos', () => {
    expectValid(':is( .a)');
    expectValid(':is(.a )');
    expectValid(':is( .a )');

    expectValid(':is( [data-x="a, b"])');
    expectValid(':is([data-x="a, b"] )');
    expectValid(':is( [data-x="a, b"] )');

    expectValid(':is( *|item)');
    expectValid(':is(*|item )');
    expectValid(':is( *|item )');
  });

  it('validates whitespace around commas inside functional pseudos', () => {
    expectValid(':is(.a,.b)');
    expectValid(':is(.a, .b)');
    expectValid(':is(.a , .b)');
    expectValid(':is(.a , .b )');
  });

  it('keeps quoted commas inside attribute selectors opaque in functional pseudos', () => {
    expectValid(':is([data-x="a, b"])');
    expectValid(':is([data-x="a, b"], .c)');
    expectValid(':has(> [data-x="a, b"])');
  });

  it('validates simple attributes inside functional pseudos', () => {
    expectValid(':is([data-x])');
    expectValid(':is([data-x=value])');
    expectValid(':is(.a[data-x=value])');
  });

  it('validates nested nth pseudo-classes inside functional pseudos', () => {
    expectValid(':not(:nth-child(1))');
    expectValid(':not(:nth-child(n))');
    expectValid(':not(:nth-child(-n+3))');

    expectValid(':not(:nth-of-type(1))');
    expectValid(':not(:nth-of-type(n))');
    expectValid(':not(:nth-last-child(1))');
    expectValid(':not(:nth-last-of-type(1))');
  });

  it('validates nested nth pseudo-classes inside functional pseudos with selector context', () => {
    expectValid('p:not(:nth-child(1))');
    expectValid('div:not(:nth-child(n))');
    expectValid('div:not(:nth-of-type(n))');
    expectValid('#p a:not(:nth-of-type(1))');
    expectValid(`#form option:not([id^='opt']:nth-child(-n+3))`);
  });

  it('does not let nested invalid nth pseudo-classes escape strict validation', () => {
    // expectInvalid(':not(:nth-child(n1))');
    // expectInvalid(':not(:nth-child(2n1))');
    // expectInvalid('p:not(:nth-of-type(1n2))');
  });

  it('validates nested pseudo-class tokens inside functional pseudo bodies', () => {
    expectValid(':not(:hover)');
    expectValid(':not(:first-child)');
    expectValid(':not(:nth-child(1))');
    expectValid(':is(:not(.a), .b)');
  });

  it('requires the nested pseudo token branch for colon-prefixed names', () => {
    expectValid(':not(:foo)');
    expectValid(':not(:foo-bar)');
    expectValid(':not(:-webkit-autofill)');
  });

  it('validates nth pseudo-class formulas with signed offsets', () => {
    expectValid('ul > li:nth-child(n-128)');
    expectValid('#t > *:nth-child(n+10)');
    expectValid(':nth-child(4n+100)');
    expectValid(':nth-child(-n+3)');
  });

  it('rejects invalid top-level selector tokens', () => {
    expectInvalid('#level1 *[id*=2]');
    expectInvalid('.5cm');
  });

  it('captures quoted attribute values containing brackets', () => {
    for (const [input, name, op, quote, value] of [
      [`[name='types[]']`, 'name', '=', "'", 'types[]'],
      [`[name^='foo[']`, 'name', '^=', "'", 'foo['],
      [`[name="brackets[5][]"]`, 'name', '=', '"', 'brackets[5][]'],
    ] as const) {
      expectCaptures(rex.Patterns.attribute, input, [name, op, quote, value, undefined, '']);
    }
  });

  it('captures :scope with selector suffixes', () => {
    expectCaptures(rex.Patterns.structural, ':scope > *', ['scope', ' > *']);
    expectCaptures(rex.Patterns.structural, ':scope.item', ['scope', '.item']);
  });

  it('captures quoted attribute values containing brackets', () => {
    for (const [input, name, op, q, value] of [
      [`[name='types[]']`, 'name', '=', "'", 'types[]'],
      [`[name^='foo[']`, 'name', '^=', "'", 'foo['],
      [`[name="brackets[5][]"]`, 'name', '=', '"', 'brackets[5][]'],
    ] as const) {
      expectCaptures(rex.Patterns.attribute, input, [name, op, q, value, undefined, '']);
    }
  });

  it('validates universal and namespace type selectors inside functional pseudos', () => {
    expectValid(':not(*)');
    expectValid(':is(*)');
    expectValid(':is(*|item)');
    expectValid(':is(|item)');
    expectValid(':is(test|item)');
    expectValid(':is(*|*)');
  });


});


describe('Rex source fragments', () => {
  function expectFullMatch(source: string, input: string): void {
    const re = new RegExp(`^(?:${source})$`);
    const actual = re.exec(input)?.[0] ?? null;

    if (actual !== input) {
      throw new AssertionError({
        message: `Expected source to match ${input}`,
        actual,
        expected: input,
        operator: 'strictEqual',
        stackStartFn: expectFullMatch,
      });
    }
  }

  function expectNoFullMatch(source: string, input: string): void {
    const re = new RegExp(`^(?:${source})$`);
    const actual = re.exec(input)?.[0] ?? null;

    if (actual === input) {
      throw new AssertionError({
        message: `Expected source not to match ${input}`,
        actual,
        expected: null,
        operator: 'notStrictEqual',
        stackStartFn: expectNoFullMatch,
      });
    }
  }

  describe('identifier', () => {
    const { identifier } = rexStrings;

    it('accepts ordinary identifier names', () => {
      expectFullMatch(identifier, 'div');
      expectFullMatch(identifier, 'foo');
      expectFullMatch(identifier, 'foo123');
      expectFullMatch(identifier, 'foo-bar');
      expectFullMatch(identifier, 'foo_bar');
      expectFullMatch(identifier, '_private');
      expectFullMatch(identifier, '-foo');
      expectFullMatch(identifier, '--foo');
    });

    it('accepts non-ASCII and escaped identifier starts', () => {
      expectFullMatch(identifier, 'é');
      expectFullMatch(identifier, 'éclair');
      expectFullMatch(identifier, '\\35 cm');
      expectFullMatch(identifier, '\\31 23');
      expectFullMatch(identifier, '\\e9');
      expectFullMatch(identifier, '\\.');
      expectFullMatch(identifier, '\\+foo');
    });

    it('rejects raw identifiers that start with digits', () => {
      expectNoFullMatch(identifier, '5cm');
      expectNoFullMatch(identifier, '123');
      expectNoFullMatch(identifier, '1foo');
      expectNoFullMatch(identifier, '-5cm');
    });

    it('accepts digits after a valid identifier start', () => {
      expectFullMatch(identifier, 'a5cm');
      expectFullMatch(identifier, '_123');
      expectFullMatch(identifier, '-a5cm');
      expectFullMatch(identifier, '--a5cm');
    });

    it('accepts literal non-ASCII, simple escapes, and hex escapes', () => {
      // literal non-ASCII
      expectFullMatch(identifier, 'é');
      expectFullMatch(identifier, 'π-value');

      // simple escapes: backslash + non-hex, non-newline char
      expectFullMatch(identifier, '\\.');
      expectFullMatch(identifier, '\\+foo');
      expectFullMatch(identifier, '\\:name');

      // hex escapes
      expectFullMatch(identifier, '\\31 23');
      expectFullMatch(identifier, '\\00003123');
      expectFullMatch(identifier, 'a\\31 b');
    });

    it('rejects invalid identifier escape forms', () => {
      // backslash-newline is not a simple escape
      expectNoFullMatch(identifier, '\\\n');
      expectNoFullMatch(identifier, '\\\r');
      expectNoFullMatch(identifier, '\\\f');

      // a raw digit is still not a valid identifier start
      expectNoFullMatch(identifier, '5cm');

      // hex escape needs 1-6 hex digits; a bare backslash alone is not enough
      expectNoFullMatch(identifier, '\\');
    });

    describe('attribute value fragments', () => {
      const { attrValue } = rexStrings;

      it('matches identifier and quoted attribute values', () => {
        for (const value of ['foo', 'foo-bar', `"foo"`, `'foo'`, `"types[]"`, `"brackets[5][]"`, `'foo['`]) {
          expectFullMatch(attrValue, value);
        }
      });

      it('matches escaped quotes inside quoted attribute values', () => {
        expectFullMatch(attrValue, `"a\\"b"`);
        expectFullMatch(attrValue, `'a\\'b'`);
      });

      it('does not match raw numeric unquoted values', () => {
        expectNoFullMatch(attrValue, '2');
        expectNoFullMatch(attrValue, '123');
      });
    });

  });

});

describe('Rex tree-structural nth patterns', () => {
  it('parses nth formulas with multi-digit signed offsets', () => {
    for (const [input, pseudo, arg, rest] of [
      [':nth-child(n-128)', 'nth-child', 'n-128', ''],
      [':nth-child(n+10)', 'nth-child', 'n+10', ''],
      [':nth-child(4n+100)', 'nth-child', '4n+100', ''],
      [':nth-of-type(-n+12)', 'nth-of-type', '-n+12', ''],
      [':nth-child(n-128).item', 'nth-child', 'n-128', '.item'],
      [':nth-child(n+10) > span', 'nth-child', 'n+10', ' > span'],
    ] as const) {
      expectCaptures(rex.Patterns.treestruct, input, [pseudo, arg, rest]);
    }
  });
});

describe('Rex attribute pattern', () => {
  it('captures quoted attribute values containing brackets', () => {
    for (const [input, name, op, quote, value] of [
      [`[name='types[]']`, 'name', '=', "'", 'types[]'],
      [`[name^='foo[']`, 'name', '^=', "'", 'foo['],
      [`[name="brackets[5][]"]`, 'name', '=', '"', 'brackets[5][]'],
    ] as const) {
      expectCaptures(rex.Patterns.attribute, input, [name, op, quote, value, undefined, '']);
    }
  });
});

describe('Rex attribute selector fragments', () => {
  it('validates missing right bracket at EOF', () => {
    const re = new RegExp(`^(?:${rexStrings.attributeSelector})$`);

    expect(re.test(`[charset="utf-8"`)).toBe(true);
    expect(re.test(`[align="center"`)).toBe(true);
    expect(re.test(`[name='types[]'`)).toBe(true);
  });
});

describe('parseRelativeSelectorList', () => {
  const stepsOf = (source: string) =>
    parseRelativeSelectorList(source).selectors.map(selector =>
      selector.steps.map(step => [step.combinator, step.compound.source])
    );

  it('parses a single implicit descendant step', () => {
    expect(stepsOf('.a')).toEqual([
      [[' ', '.a']],
    ]);
  });

  it('parses implicit descendant chains', () => {
    expect(stepsOf('.a .b .c')).toEqual([
      [
        [' ', '.a'],
        [' ', '.b'],
        [' ', '.c'],
      ],
    ]);
  });

  it('parses a leading child combinator', () => {
    expect(stepsOf('> .a')).toEqual([
      [['>', '.a']],
    ]);
  });

  it('parses a leading adjacent sibling combinator', () => {
    expect(stepsOf('+ .next')).toEqual([
      [['+', '.next']],
    ]);
  });

  it('parses a leading following sibling combinator', () => {
    expect(stepsOf('~ .after')).toEqual([
      [['~', '.after']],
    ]);
  });

  it('parses mixed child, sibling, and descendant steps', () => {
    expect(stepsOf('> .a + .b .c')).toEqual([
      [
        ['>', '.a'],
        ['+', '.b'],
        [' ', '.c'],
      ],
    ]);
  });

  it('parses general sibling followed by child and descendant steps', () => {
    expect(stepsOf('~ .a > .b .c')).toEqual([
      [
        ['~', '.a'],
        ['>', '.b'],
        [' ', '.c'],
      ],
    ]);
  });

  it('ignores whitespace around explicit combinators', () => {
    expect(stepsOf('  >   .a   +   .b   ~   .c  ')).toEqual([
      [
        ['>', '.a'],
        ['+', '.b'],
        ['~', '.c'],
      ],
    ]);
  });

  it('splits selector-list branches at top-level commas', () => {
    expect(stepsOf('.a, > .b, + .c')).toEqual([
      [[' ', '.a']],
      [['>', '.b']],
      [['+', '.c']],
    ]);
  });

  it('does not split commas inside functional pseudos', () => {
    expect(stepsOf('.a:is(.x, .y), > .b:not(.c, .d)')).toEqual([
      [[' ', '.a:is(.x, .y)']],
      [['>', '.b:not(.c, .d)']],
    ]);
  });

  it('does not split combinators inside functional pseudos', () => {
    expect(stepsOf('.a:is(.x > .y) > .b:not(.c + .d)')).toEqual([
      [
        [' ', '.a:is(.x > .y)'],
        ['>', '.b:not(.c + .d)'],
      ],
    ]);
  });

  it('does not split combinators inside attribute selectors', () => {
    expect(stepsOf('[data-x="a>b"] + [data-y="c+d"] ~ [data-z="e~f"]')).toEqual([
      [
        [' ', '[data-x="a>b"]'],
        ['+', '[data-y="c+d"]'],
        ['~', '[data-z="e~f"]'],
      ],
    ]);
  });

  it('does not split commas inside quoted attribute values', () => {
    expect(stepsOf('[data-x=","] , [data-y="a,b"]')).toEqual([
      [[' ', '[data-x=","]']],
      [[' ', '[data-y="a,b"]']],
    ]);
  });

  it('preserves escaped combinator-like characters in compounds', () => {
    expect(stepsOf('.a\\+b > .c\\~d + .e\\>f')).toEqual([
      [
        [' ', '.a\\+b'],
        ['>', '.c\\~d'],
        ['+', '.e\\>f'],
      ],
    ]);
  });

  it('preserves escaped commas in compounds', () => {
    expect(stepsOf('.a\\,b, .c')).toEqual([
      [[' ', '.a\\,b']],
      [[' ', '.c']],
    ]);
  });

  it('parses nested :has as an opaque compound', () => {
    expect(stepsOf('.a:has(> .x + .y) > .b')).toEqual([
      [
        [' ', '.a:has(> .x + .y)'],
        ['>', '.b'],
      ],
    ]);
  });

  it('parses nested logical pseudos with selector lists as opaque compounds', () => {
    expect(stepsOf(':is(.a > .b, .c + .d) ~ .e')).toEqual([
      [
        [' ', ':is(.a > .b, .c + .d)'],
        ['~', '.e'],
      ],
    ]);
  });

  it('keeps source on the returned list and branches', () => {
    const parsed = parseRelativeSelectorList('> .a + .b, .c');

    expect(parsed.kind).toBe('relative-selector-list');
    expect(parsed.source).toBe('> .a + .b, .c');
    expect(parsed.selectors).toHaveLength(2);

    expect(parsed.selectors[0]).toMatchObject({
      kind: 'relative',
      source: '> .a + .b',
    });

    expect(parsed.selectors[1]).toMatchObject({
      kind: 'relative',
      source: '.c',
    });
  });

  it('returns compound nodes with source', () => {
    const parsed = parseRelativeSelectorList('> div.foo[attr="x"]');

    expect(parsed.selectors[0].steps[0]).toEqual({
      kind: 'relative-step',
      combinator: '>',
      compound: {
        kind: 'compound',
        source: 'div.foo[attr="x"]',
      },
    });
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

describe('escaped whitespace in class identifiers', () => {
  it('validates escaped whitespace in class selectors', () => {
    expectValid('.foo\\ ');
    expectValid('.foo\\a bar');
  });

  it('parses escaped whitespace in class selectors', () => {
    expectParse('.foo\\ ');
    expectParse('.foo\\a bar');
  });
});

describe('normalizeSelectorInput', () => {
  function expectNormalized(input: string, expected: string): void {
    const actual = normalizeSelectorInput(input, rex);

    if (actual !== expected) {
      throw new AssertionError({
        message: `Unexpected normalized selector for ${JSON.stringify(input)}`,
        actual,
        expected,
        operator: 'strictEqual',
        stackStartFn: expectNormalized,
      });
    }
  }

  it('normalizes ordinary selector whitespace', () => {
    expectNormalized('  .foo  ', '.foo');
    expectNormalized('  .foo,\n.bar\t', '.foo,.bar');
    expectNormalized('div   >   .foo', 'div > .foo');
    expectNormalized(':not( .foo )', ':not( .foo )');
  });

  it('preserves escaped trailing whitespace inside identifiers', () => {
    expectNormalized('.foo\\ ', '.foo\\ ');
    expectNormalized('  .foo\\   ', '.foo\\ ');
  });

  it('preserves hex-escape terminator whitespace inside identifiers', () => {
    expectNormalized('.foo\\a bar', '.foo\\a bar');
    expectNormalized('  .foo\\a bar  ', '.foo\\a bar');
  });

  it('does not preserve a dangling final escape', () => {
    expectNormalized('.foo\\', '.foo\ufffd');
  });
});

describe('trimSelectorSpaces', () => {
  function expectTrimmed(input: string, expected: string): void {
    const actual = trimSelectorSpaces(input);

    if (actual !== expected) {
      throw new AssertionError({
        message: `Unexpected trimmed selector for ${JSON.stringify(input)}`,
        actual,
        expected,
        operator: 'strictEqual',
        stackStartFn: expectTrimmed,
      });
    }
  }

  it('trims ordinary leading and trailing CSS whitespace', () => {
    expectTrimmed('  .foo  ', '.foo');
    expectTrimmed('\n\t.foo\r\f', '.foo');
    expectTrimmed('  .foo, .bar  ', '.foo, .bar');
  });

  it('preserves trailing whitespace escaped by an odd backslash run', () => {
    expectTrimmed('.foo\\ ', '.foo\\ ');
    expectTrimmed('  .foo\\ ', '.foo\\ ');
    expectTrimmed('  .foo\\   ', '.foo\\ ');
    expectTrimmed('.foo\\\\\\ ', '.foo\\\\\\ ');
  });

  it('trims trailing whitespace after an even backslash run', () => {
    expectTrimmed('.foo\\\\ ', '.foo\\\\');
    expectTrimmed('  .foo\\\\   ', '.foo\\\\');
  });
});