import { describe, expect, it } from 'vitest';
import {
  buildRex, DEFAULT_EXTENSIONS, DEFAULT_CONFIG, parse, unescapeIdentifier,
  decodeCssEscapes, decodeAttrForRegex, cssEscape,
  matchLogicalSelector,
  splitSelectorGroups,
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

// function expectCaptures(re: RegExp, input: string, expected: ExpectedCapture[]): void {
//   const m = execRe(re, input);
//   const actual = m ? Array.from(m).slice(1) : null;

//   expect(actual, `Expected ${input} to match ${re}`).not.toBeNull();
//   expect(actual!.length, `Unexpected capture length for ${input}`).toBe(expected.length);

//   expected.forEach((value, index) => {
//     if (value === ANY) return;
//     expect(actual![index], `Mismatch at capture[${index + 1}] for ${input}`).toBe(value);
//   });
// }

describe('Rex basic recognizers', () => {
  const rex = buildRex(DEFAULT_EXTENSIONS);

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
  const rex = buildRex(DEFAULT_EXTENSIONS);

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
    expect(':nth-child(2n + 1)'.replace(rex.PseudosWSP, '$1')).toBe(':nth-child(2n+1)');
    expect(':nth-child(2n - 1)'.replace(rex.PseudosWSP, '$1')).toBe(':nth-child(2n-1)');
    expect('[data-x="a + b"]'.replace(rex.PseudosWSP, '$1')).toBe('[data-x="a + b"]');
  });

});

describe('Rex selector splitting helpers', () => {
  const rex = buildRex(DEFAULT_EXTENSIONS);

  it('splits selector groups without splitting inside parens, brackets, or escapes', () => {
    expect('div, span'.match(rex.SplitGroup)).toEqual(['div', ' span']);
    expect(':is(div, span), a'.match(rex.SplitGroup)).toEqual([':is(div, span)', ' a']);
    expect('[data-x="a,b"], span'.match(rex.SplitGroup)).toEqual(['[data-x="a,b"]', ' span']);
    expect('foo\\,bar, baz'.match(rex.SplitGroup)).toEqual(['foo\\,bar', ' baz']);
    expect('is(div, :where(span, a)) , section'.match(rex.SplitGroup)).toEqual(['is(div, :where(span, a)) ', ' section']);
    expect(':has(.a, .b) , section'.match(rex.SplitGroup)).toEqual([':has(.a, .b) ', ' section']);
  });
});

describe('decodeCssEscapes', () => {
  const rex = buildRex(DEFAULT_EXTENSIONS);

  it('matches CSS escape sequences and raw quotes for escape decoding', () => {
    expect(matchRe0(rex.FixEscapes, '\\e9')).toEqual(['\\e9']);
    expect(matchRe0(rex.FixEscapes, '\\31 23')).toEqual(['\\31 ']);
    expect(matchRe0(rex.FixEscapes, '\\.')).toEqual(['\\.']);
    expect(matchRe0(rex.FixEscapes, '"')).toEqual(['"']);
    expect(matchRe0(rex.FixEscapes, "'")).toEqual(["'"]);
  });

  it('characterizes CSS escape decoding used by attribute regex generation', () => {
    expect(decodeCssEscapes('\\e9', rex)).toBe('\\u00e9');
    expect(decodeCssEscapes('foo\\"bar', rex)).toBe('foo\\"bar');
  });
});

describe('decodeAttrForRegex', () => {
  const rex = buildRex(DEFAULT_EXTENSIONS);

  function matchesPrepared(pattern: string, value: string): boolean {
    const re = new RegExp('^' + decodeAttrForRegex(pattern, rex) + '$');
    return re.test(value);
  }

  it('escapes regex metacharacters while preserving generated escape sequences', () => {
    expect(decodeAttrForRegex('a.b', rex)).toBe('a\\.b');
    expect(decodeAttrForRegex('[x]', rex)).toBe('\\[x\\]');
    expect(decodeAttrForRegex('a/b', rex)).toBe('a\\/b');

    // CSS escapes are decoded into generated regex-source escapes,
    // and those backslashes must remain meaningful in the generated regex.
    expect(decodeAttrForRegex('\\e9', rex)).toBe('\\u00e9');
    expect(decodeAttrForRegex('foo\\"bar', rex)).toBe('foo\\"bar');
  });

  it('matches CSS-escaped attribute values', () => {
    expect(matchesPrepared('\\e9', 'é')).toBe(true);
    expect(matchesPrepared('\\31 23', '123')).toBe(true);
    expect(matchesPrepared('foo\\"bar', 'foo"bar')).toBe(true);
  });

  it('does not let regex metacharacters become regex syntax', () => {
    expect(matchesPrepared('a.b', 'a.b')).toBe(true);
    expect(matchesPrepared('a.b', 'acb')).toBe(false);

    expect(matchesPrepared('a+b', 'a+b')).toBe(true);
    expect(matchesPrepared('a+b', 'aaab')).toBe(false);

    expect(matchesPrepared('[x]', '[x]')).toBe(true);
    expect(matchesPrepared('[x]', 'x')).toBe(false);
  });

  it('escapes slash because generated code uses regex literal syntax', () => {
    expect(matchesPrepared('a/b', 'a/b')).toBe(true);
    expect(decodeAttrForRegex('a/b', rex)).toBe('a\\/b');
  });

  it.each([
    'plain',
    'a.b',
    'a+b',
    '[x]',
    '(x)',
    'a/b',
    'a|b',
    'a$b',
    '^x',
  ])('round-trips CSS-escaped selector value for %s', (literal) => {
    const selectorValue = cssEscape(literal);
    expect(matchesPrepared(selectorValue, literal)).toBe(true);
  });
});

describe('Rex STD helpers', () => {
  const rex = buildRex(DEFAULT_EXTENSIONS);

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
  const rex = buildRex(DEFAULT_EXTENSIONS);

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

  // Removing because logicalsel cannot handle nested parens. Use matchLogicalSelector instead.
  // it('does not over-consume valid logical selectors followed by functional pseudos', () => {
  //   expectCaptures(rex.Patterns.logicalsel, ':is(.a):nth-child(2n+1)', ['is', '.a', ':nth-child(2n+1)']);
  //   expectCaptures(rex.Patterns.logicalsel, ':not(.a):nth-of-type(2)', ['not', '.a', ':nth-of-type(2)']);
  //   expectCaptures(rex.Patterns.logicalsel, ':has(> .a):not(.disabled)', ['has', '> .a', ':not(.disabled)']);
  //   expectCaptures(rex.Patterns.logicalsel, ':where(.a):lang(en)', ['where', '.a', ':lang(en)']);
  //   expectCaptures(rex.Patterns.logicalsel, ':is(.a):has(+ .b)', ['is', '.a', ':has(+ .b)']);
  // });

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

describe('parse', () => {
  const rex = buildRex(DEFAULT_EXTENSIONS);
  const config = { ...DEFAULT_CONFIG, VERBOSITY: false, LOGERRORS: false };

  it('normalizes vertical whitespace through parse pipeline', () => {
    expect(parse('div\nspan', rex, config)).toEqual(['div span']);
    expect(parse('div\r\nspan', rex, config)).toEqual(['div span']);
    expect(parse('div\fspan', rex, config)).toEqual(['div span']);
  });

  it('normalizes common whitespace through the parse pipeline', () => {
    expect(parse('div , span', rex, config)).toEqual(['div', 'span']);
    expect(parse('div\nspan', rex, config)).toEqual(['div span']);
    expect(parse(':nth-child(2n + 1)', rex, config)).toEqual([':nth-child(2n+1)']);
  });
});

describe('unescapeIdentifier', () => {
  const rex = buildRex(DEFAULT_EXTENSIONS);
  it('should unescape valid identifiers', () => {
    expect(unescapeIdentifier('[data-nwsapi-scope] > *|item', rex)).toBe('[data-nwsapi-scope] > *|item');
  });
});

describe('parse namespace selectors', () => {
  const rex = buildRex(DEFAULT_EXTENSIONS);
  const config = { ...DEFAULT_CONFIG, VERBOSITY: false, LOGERRORS: false };

  it.each([
    'div',
    'div p',
    'div > p',
    '[data-nwsapi-scope] > p',
    // '*|p',
    // 'test|p',
    // '|p',
    // ':scope > *|item',
    // '[data-nwsapi-scope] > *|item',
    // '[data-nwsapi-scope] > |item',
  ])('accepts %s', (selector) => {
    // expect(parse(unescapeIdentifier(selector, rex), rex, config)).toEqual([selector]);
    expect(parse(selector, rex, config)).toEqual([selector]);
  });
});
