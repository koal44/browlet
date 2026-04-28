import { describe, expect, it, test } from 'vitest';
import {
  buildRex, DEFAULT_EXTENSIONS, DEFAULT_CONFIG, parse, cssIdentUnescape,
  escapeRegexAttrValue, cssIdentEscape, matchLogicalSelector, splitSelectorGroups,
  escapeRegExp,
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
    expect(':nth-child(2n + 1)'.replace(rex.PseudosWSP, '$1$2')).toBe(':nth-child(2n+1)');
    expect(':nth-child(2n - 1)'.replace(rex.PseudosWSP, '$1$2')).toBe(':nth-child(2n-1)');
    expect('[data-x="a + b"]'.replace(rex.PseudosWSP, '$1$2')).toBe('[data-x="a + b"]');
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

// describe('decodeCssEscapes', () => {
//   const rex = buildRex(DEFAULT_EXTENSIONS);

//   it('matches CSS escape sequences and raw quotes for escape decoding', () => {
//     expect(matchRe0(rex.FixEscapes, '\\e9')).toEqual(['\\e9']);
//     expect(matchRe0(rex.FixEscapes, '\\31 23')).toEqual(['\\31 ']);
//     expect(matchRe0(rex.FixEscapes, '\\.')).toEqual(['\\.']);
//     expect(matchRe0(rex.FixEscapes, '"')).toEqual(['"']);
//     expect(matchRe0(rex.FixEscapes, "'")).toEqual(["'"]);
//   });

//   it('characterizes CSS escape decoding used by attribute regex generation', () => {
//     expect(decodeCssEscapes('\\e9', rex)).toBe('\\u00e9');
//     expect(decodeCssEscapes('foo\\"bar', rex)).toBe('foo\\"bar');
//   });

//   it('decodes CSS hex escapes to actual characters', () => {
//     const rex = buildRex(DEFAULT_EXTENSIONS);
//     expect(decodeCssEscapes('f\\F6 o', rex)).toBe('föo');
//   });
// });

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

  // Failing because logicalsel cannot handle nested parens. Use matchLogicalSelector instead.
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

  it('detects nth-child structural pseudo-classes', () => {
    expect(testRe(rex.nthElem, ':nth-child(2n+1)')).toBe(true);
    expect(testRe(rex.nthElem, ':nth-last-child(odd)')).toBe(true);

    expect(testRe(rex.nthElem, ':nth-of-type(2)')).toBe(false);
    expect(testRe(rex.nthElem, ':first-child')).toBe(false);
  });

  it('detects nth-of-type structural pseudo-classes', () => {
    expect(testRe(rex.nthType, ':nth-of-type(2)')).toBe(true);
    expect(testRe(rex.nthType, ':nth-last-of-type(odd)')).toBe(true);

    expect(testRe(rex.nthType, ':nth-child(2n+1)')).toBe(false);
    expect(testRe(rex.nthType, ':only-of-type')).toBe(false);
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
  const rex = buildRex(DEFAULT_EXTENSIONS);

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
});

describe('unescapeIdentifier', () => {
  const rex = buildRex(DEFAULT_EXTENSIONS);
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
  const rex = buildRex(DEFAULT_EXTENSIONS);
  const config = { ...DEFAULT_CONFIG, VERBOSITY: false, LOGERRORS: false };

  function expectParse(input: string, expected: string[], cfg = config): void {
    const actual = parse(input, rex, cfg);

    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new AssertionError({
        message: `Unexpected parse result for ${input}`,
        actual,
        expected,
        operator: 'deepStrictEqual',
        stackStartFn: expectParse,
      });
    }
  }

  function expectParseRejects(input: string, cfg = config): void {
    let actual: string[] | undefined;
    let thrown = false;

    try { actual = parse(input, rex, cfg); }
    catch { thrown = true; }

    const shouldThrow = !!cfg.VERBOSITY;
    const pass = shouldThrow ? thrown : !thrown && Array.isArray(actual) && actual.length === 0;

    if (!pass) {
      throw new AssertionError({
        message: `Expected parse rejection for ${input}`,
        actual: thrown ? 'threw' : actual,
        expected: shouldThrow ? 'throw' : [],
        operator: shouldThrow ? 'throws' : 'deepStrictEqual',
        stackStartFn: expectParseRejects,
      });
    }
  }

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
});

describe('parse', () => {
  const rex = buildRex(DEFAULT_EXTENSIONS);
  const config = { ...DEFAULT_CONFIG, VERBOSITY: true, LOGERRORS: false };

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
    expect(parse(selector, rex, config)).toEqual([selector]);
  });

});
