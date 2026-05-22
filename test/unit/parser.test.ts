import { describe, it, expect } from 'vitest';
import { consumeIdent, parseAttributeSelector, parseComplexSelector, parseCompoundSelector, parseNthArgs, parsePseudoBodyRelativeSelectorList, parsePseudoBodySelectorList, parseSelectorList } from '../../src/parser';
import { Cursor } from '../../src/cursor';

describe('parseSelectorList', () => {
  it('parses a single selector', () => {
    const parsed = parseSelectorList('  #root p  ');

    expect(parsed.selectors).toHaveLength(1);

    const [complex] = parsed.selectors;
    expect(complex.parts).toHaveLength(2);
    expect(complex.parts.map(p => p.combinator)).toEqual([null, ' ']);
    expect(complex.parts[0].compound.id?.raw).toBe('root');
    expect(complex.parts[1].compound.tag?.localRaw).toBe('p');
  });

  it('parses comma-separated selectors', () => {
    const parsed = parseSelectorList(' #a, .b, div ');

    expect(parsed.selectors).toHaveLength(3);

    expect(parsed.selectors[0].parts).toHaveLength(1);
    expect(parsed.selectors[0].parts[0].compound.id?.raw).toBe('a');

    expect(parsed.selectors[1].parts).toHaveLength(1);
    expect(parsed.selectors[1].parts[0].compound.classes?.map(c => c.raw)).toEqual(['b']);

    expect(parsed.selectors[2].parts).toHaveLength(1);
    expect(parsed.selectors[2].parts[0].compound.tag?.localRaw).toBe('div');
  });

  it('throws on empty input', () => {
    expect(() => parseSelectorList('   ')).toThrow('Expected selector');
  });

  it('throws on trailing comma', () => {
    expect(() => parseSelectorList('#a,   ')).toThrow('Expected selector after comma');
  });
});

describe('parseComplexSelector', () => {
  it('parses a single compound', () => {
    const c = new Cursor('#root');
    const complex = parseComplexSelector(c);

    expect(complex.parts).toHaveLength(1);
    expect(complex.parts[0].combinator).toBeNull();
    expect(complex.parts[0].compound.id?.raw).toBe('root');
    expect(c.eof()).toBe(true);
  });

  it('parses descendant combinators from whitespace', () => {
    const c = new Cursor('#root p');
    const complex = parseComplexSelector(c);

    expect(complex.parts).toHaveLength(2);
    expect(complex.parts.map(p => p.combinator)).toEqual([null, ' ']);
    expect(complex.parts[0].compound.id?.raw).toBe('root');
    expect(complex.parts[1].compound.tag?.localRaw).toBe('p');
  });

  it('parses explicit combinators with surrounding whitespace', () => {
    const c = new Cursor('#root   >   p + a ~ span');
    const complex = parseComplexSelector(c);

    expect(complex.parts).toHaveLength(4);
    expect(complex.parts.map(p => p.combinator)).toEqual([null, '>', '+', '~']);
    expect(complex.parts[0].compound.id?.raw).toBe('root');
    expect(complex.parts[1].compound.tag?.localRaw).toBe('p');
    expect(complex.parts[2].compound.tag?.localRaw).toBe('a');
    expect(complex.parts[3].compound.tag?.localRaw).toBe('span');
  });

  it('stops before a comma without consuming it', () => {
    const c = new Cursor('#a > p, .b');
    const complex = parseComplexSelector(c);

    expect(complex.parts).toHaveLength(2);
    expect(complex.parts.map(p => p.combinator)).toEqual([null, '>']);
    expect(complex.parts[0].compound.id?.raw).toBe('a');
    expect(complex.parts[1].compound.tag?.localRaw).toBe('p');
    expect(c.peek()).toBe(',');
  });

  it('stops before a closing paren without consuming it', () => {
    const c = new Cursor('#a > p)');
    const complex = parseComplexSelector(c);

    expect(complex.parts).toHaveLength(2);
    expect(complex.parts.map(p => p.combinator)).toEqual([null, '>']);
    expect(complex.parts[0].compound.id?.raw).toBe('a');
    expect(complex.parts[1].compound.tag?.localRaw).toBe('p');
    expect(c.peek()).toBe(')');
  });

  it('throws when an explicit combinator has no right compound', () => {
    expect(() => parseComplexSelector(new Cursor('#a >'))).toThrow(
      'Expected compound selector after combinator'
    );

    expect(() => parseComplexSelector(new Cursor('#a > , .b'))).toThrow(
      'Expected compound selector after combinator'
    );
  });

  it('throws on empty input', () => {
    expect(() => parseComplexSelector(new Cursor(''))).toThrow('Expected compound selector');
  });

  it('throws when input starts with a combinator for now', () => {
    expect(() => parseComplexSelector(new Cursor('> p'))).toThrow('Expected compound selector');
  });
});

describe('parseCompoundSelector', () => {
  it('parses tag, id, and class pieces', () => {
    const c = new Cursor('div#root.foo.bar');
    const compound = parseCompoundSelector(c);

    expect(compound.tag?.localRaw).toBe('div');
    expect(compound.id?.raw).toBe('root');
    expect(compound.classes?.map(x => x.raw)).toEqual(['foo', 'bar']);
    expect(compound.tests).toEqual([]);
    expect(c.eof()).toBe(true);
  });

  it('parses class-only compounds', () => {
    const c = new Cursor('.foo.bar');
    const compound = parseCompoundSelector(c);

    expect(compound.tag).toBeUndefined();
    expect(compound.id).toBeUndefined();
    expect(compound.classes?.map(x => x.raw)).toEqual(['foo', 'bar']);
    expect(compound.tests).toEqual([]);
  });

  it('parses universal tag selector', () => {
    const c = new Cursor('*.foo');
    const compound = parseCompoundSelector(c);

    expect(compound.tag?.localRaw).toBe('*');
    expect(compound.classes?.map(x => x.raw)).toEqual(['foo']);
    expect(compound.tests).toEqual([]);
  });

  it('attaches attribute and pseudo selectors to test source', () => {
    const c = new Cursor('p[data-x="a b"]:not(.hidden)');
    const compound = parseCompoundSelector(c);

    expect(compound.tag?.localRaw).toBe('p');
    expect(compound.tests?.length).toBeGreaterThan(0);
    expect(c.eof()).toBe(true);
  });

  it('does not stop on spaces or combinators inside attribute strings and pseudo args', () => {
    const c = new Cursor(`p[data-x="a > b"]:not(.a > .b) + span`);
    const compound = parseCompoundSelector(c);

    expect(compound.tag?.localRaw).toBe('p');
    expect(compound.tests?.length).toBeGreaterThan(0);
    expect(c.peek()).toBe(' ');
    expect(c.startsWith(' + span')).toBe(true);
  });

  it('stops before whitespace or combinator', () => {
    const c = new Cursor('div.foo > p');
    const compound = parseCompoundSelector(c);

    expect(compound.tag?.localRaw).toBe('div');
    expect(compound.classes?.map(x => x.raw)).toEqual(['foo']);
    expect(compound.tests).toEqual([]);
    expect(c.peek()).toBe(' ');
  });

  it('throws on missing selector after class/id prefix', () => {
    expect(() => parseCompoundSelector(new Cursor('.'))).toThrow('Expected identifier');
    expect(() => parseCompoundSelector(new Cursor('#'))).toThrow('Expected identifier');
  });

  it('throws on empty input', () => {
    expect(() => parseCompoundSelector(new Cursor(''))).toThrow('Expected compound selector');
  });

  it('parses escaped characters in identifiers', () => {
    const compound = parseCompoundSelector(new Cursor(String.raw`div.foo\+bar#id\31 a`));

    expect(compound.tag?.localRaw).toBe('div');
    expect(compound.classes?.[0].raw).toBe(String.raw`foo\+bar`);
    expect(compound.id?.raw).toBe(String.raw`id\31 a`);
  });

  it('accepts nth structural pseudo-classes', () => {
    for (const pseudo of ['nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type']) {
      const compound = parseCompoundSelector(new Cursor(`div:${pseudo}(2n+1)`));

      expect(compound.tag?.localRaw).toBe('div');
      expect(compound.tests.length).toBeGreaterThan(0);
    }
  });
});

describe('consumeIdent', () => {
  it('consumes ordinary identifiers', () => {
    const c = new Cursor('foo.bar');

    expect(consumeIdent(c)).toBe('foo');
    expect(c.peek()).toBe('.');
  });

  it('allows leading dash before an ident head', () => {
    const c = new Cursor('-foo.bar');

    expect(consumeIdent(c)).toBe('-foo');
    expect(c.peek()).toBe('.');
  });

  it('allows double-dash identifiers', () => {
    const c = new Cursor('--foo.bar');

    expect(consumeIdent(c)).toBe('--foo');
    expect(c.peek()).toBe('.');
  });

  it('allows bare double-dash by old regex behavior', () => {
    const c = new Cursor('--.foo');

    expect(consumeIdent(c)).toBe('--');
    expect(c.peek()).toBe('.');
  });

  it('consumes simple escapes in identifiers', () => {
    const c = new Cursor(String.raw`foo\+bar.baz`);

    expect(consumeIdent(c)).toBe(String.raw`foo\+bar`);
    expect(c.peek()).toBe('.');
  });

  it('consumes unicode escapes and one trailing whitespace', () => {
    const c = new Cursor(String.raw`foo\31 bar.baz`);

    expect(consumeIdent(c)).toBe(String.raw`foo\31 bar`);
    expect(c.peek()).toBe('.');
  });

  it('consumes unicode escapes with CRLF trailing whitespace', () => {
    const c = new Cursor('foo\\31\r\nbar.baz');

    expect(consumeIdent(c)).toBe('foo\\31\r\nbar');
    expect(c.peek()).toBe('.');
  });

  it('does not consume invalid identifiers', () => {
    expect(() => consumeIdent(new Cursor('1foo'))).toThrow('Expected identifier');
    expect(() => consumeIdent(new Cursor('-1foo'))).toThrow('Expected identifier');
    expect(() => consumeIdent(new Cursor('\\\nfoo'))).toThrow('Expected identifier');
  });
});

describe('parseTagSelector namespace forms', () => {
  it('parses plain tag and universal tag selectors', () => {
    expect(parseCompoundSelector(new Cursor('div')).tag).toEqual({ localRaw: 'div' });
    expect(parseCompoundSelector(new Cursor('*')).tag).toEqual({ localRaw: '*' });
  });

  it('parses supported namespace tag selectors', () => {
    expect(parseCompoundSelector(new Cursor('*|circle')).tag).toEqual({
      prefixRaw: '*',
      localRaw: 'circle',
    });

    expect(parseCompoundSelector(new Cursor('|circle')).tag).toEqual({
      prefixRaw: '',
      localRaw: 'circle',
    });
  });

  it('parses supported namespaced universal local selectors', () => {
    expect(parseCompoundSelector(new Cursor('*|*')).tag).toEqual({
      prefixRaw: '*',
      localRaw: '*',
    });

    expect(parseCompoundSelector(new Cursor('|*')).tag).toEqual({
      prefixRaw: '',
      localRaw: '*',
    });
  });

  it('parses classes after supported namespace tag selectors', () => {
    const compound = parseCompoundSelector(new Cursor('*|circle.icon'));

    expect(compound.tag).toEqual({
      prefixRaw: '*',
      localRaw: 'circle',
    });
    expect(compound.classes?.map(c => c.raw)).toEqual(['icon']);
  });

  it('rejects named namespace prefixes', () => {
    expect(() => parseCompoundSelector(new Cursor('svg|circle'))).toThrow(
      'Unsupported namespace prefix'
    );

    expect(() => parseCompoundSelector(new Cursor('svg|*'))).toThrow(
      'Unsupported namespace prefix'
    );
  });

  it('throws when namespace tag selector has no local part', () => {
    expect(() => parseCompoundSelector(new Cursor('*|'))).toThrow('Expected identifier');
    expect(() => parseCompoundSelector(new Cursor('|'))).toThrow('Expected identifier');
  });

  it('does not treat escaped pipe as a namespace separator', () => {
    const compound = parseCompoundSelector(new Cursor(String.raw`svg\|circle.foo`));

    expect(compound.tag).toEqual({
      localRaw: String.raw`svg\|circle`,
    });
    expect(compound.classes?.map(c => c.raw)).toEqual(['foo']);
  });
});

describe('parseAttributeSelector', () => {
  it('parses attribute presence selectors', () => {
    expect(parseAttributeSelector(new Cursor('[attr]'))).toEqual({
      localRaw: 'attr',
    });

    expect(parseAttributeSelector(new Cursor('[data-id]'))).toEqual({
      localRaw: 'data-id',
    });
  });

  it('parses supported namespace attribute selectors', () => {
    expect(parseAttributeSelector(new Cursor('[|attr]'))).toEqual({
      prefixRaw: '',
      localRaw: 'attr',
    });

    expect(parseAttributeSelector(new Cursor('[*|attr]'))).toEqual({
      prefixRaw: '*',
      localRaw: 'attr',
    });
  });

  it('rejects named namespace prefixes', () => {
    expect(() => parseAttributeSelector(new Cursor('[xml|lang]'))).toThrow(
      'Unsupported namespace prefix'
    );
  });

  it('does not treat escaped pipe as a namespace separator', () => {
    expect(parseAttributeSelector(new Cursor(String.raw`[xml\|lang]`))).toEqual({
      localRaw: String.raw`xml\|lang`,
    });
  });

  it('parses standard attribute operators with unquoted values', () => {
    expect(parseAttributeSelector(new Cursor('[attr=value]'))).toEqual({
      localRaw: 'attr',
      op: '=',
      valueRaw: 'value',
    });

    expect(parseAttributeSelector(new Cursor('[attr~=token]'))).toEqual({
      localRaw: 'attr',
      op: '~=',
      valueRaw: 'token',
    });

    expect(parseAttributeSelector(new Cursor('[attr|=en]'))).toEqual({
      localRaw: 'attr',
      op: '|=',
      valueRaw: 'en',
    });

    expect(parseAttributeSelector(new Cursor('[attr^=pre]'))).toEqual({
      localRaw: 'attr',
      op: '^=',
      valueRaw: 'pre',
    });

    expect(parseAttributeSelector(new Cursor('[attr$=suf]'))).toEqual({
      localRaw: 'attr',
      op: '$=',
      valueRaw: 'suf',
    });

    expect(parseAttributeSelector(new Cursor('[attr*=mid]'))).toEqual({
      localRaw: 'attr',
      op: '*=',
      valueRaw: 'mid',
    });
  });

  it('parses quoted attribute values without quotes', () => {
    expect(parseAttributeSelector(new Cursor('[attr="value"]'))).toEqual({
      localRaw: 'attr',
      op: '=',
      valueRaw: 'value',
    });

    expect(parseAttributeSelector(new Cursor("[attr='value']"))).toEqual({
      localRaw: 'attr',
      op: '=',
      valueRaw: 'value',
    });
  });

  it('preserves raw escapes inside attribute values', () => {
    expect(parseAttributeSelector(new Cursor(String.raw`[attr="a\+b"]`))).toEqual({
      localRaw: 'attr',
      op: '=',
      valueRaw: String.raw`a\+b`,
    });

    expect(parseAttributeSelector(new Cursor(String.raw`[attr=a\+b]`))).toEqual({
      localRaw: 'attr',
      op: '=',
      valueRaw: String.raw`a\+b`,
    });
  });

  it('parses normalized attribute selector flags', () => {
    expect(parseAttributeSelector(new Cursor('[attr=value i]'))).toEqual({
      localRaw: 'attr',
      op: '=',
      valueRaw: 'value',
      flag: 'i',
    });

    expect(parseAttributeSelector(new Cursor('[attr=value S]'))).toEqual({
      localRaw: 'attr',
      op: '=',
      valueRaw: 'value',
      flag: 's',
    });
  });

  it('allows whitespace around attribute selector parts', () => {
    expect(parseAttributeSelector(new Cursor('[  attr  =  "value"  i  ]'))).toEqual({
      localRaw: 'attr',
      op: '=',
      valueRaw: 'value',
      flag: 'i',
    });
  });

  it('throws on unsupported attribute operators', () => {
    expect(() => parseAttributeSelector(new Cursor('[attr!=value]'))).toThrow(
      'Expected attribute operator'
    );

    expect(() => parseAttributeSelector(new Cursor('[attr?=value]'))).toThrow(
      'Expected attribute operator'
    );
  });

  it('throws when an operator has no value', () => {
    expect(() => parseAttributeSelector(new Cursor('[attr=]'))).toThrow(
      'Expected attribute value'
    );

    expect(() => parseAttributeSelector(new Cursor('[attr=   ]'))).toThrow(
      'Expected attribute value'
    );
  });

  it('throws when a flag appears without an operator/value', () => {
    expect(() => parseAttributeSelector(new Cursor('[attr i]'))).toThrow();
  });

  it('throws on invalid flags', () => {
    expect(() => parseAttributeSelector(new Cursor('[attr=value q]'))).toThrow(
      'Invalid attribute selector flag'
    );
  });

  it('throws on extra trailing content before closing bracket', () => {
    expect(() => parseAttributeSelector(new Cursor('[attr=value i extra]'))).toThrow();
  });

  it('does not throw on missing right bracket for now', () => {
    expect(parseAttributeSelector(new Cursor('[attr=value'))).toEqual({
      localRaw: 'attr',
      op: '=',
      valueRaw: 'value',
    });
  });

  it('throws on unclosed strings', () => {
    expect(() => parseAttributeSelector(new Cursor('[attr="value]'))).toThrow(
      'Unclosed string'
    );
  });

  it('parses escaped attribute selector flags', () => {
    expect(parseAttributeSelector(new Cursor(String.raw`[attr=value \69]`))).toEqual({
      localRaw: 'attr',
      op: '=',
      valueRaw: 'value',
      flag: 'i',
    });
  });
});

describe('parseNthArgs', () => {
  it('parses odd and even', () => {
    expect(parseNthArgs(new Cursor('(odd)'))).toEqual({ step: 2, offset: 1 });
    expect(parseNthArgs(new Cursor('(even)'))).toEqual({ step: 2, offset: 0 });
  });

  it('parses integer indexes', () => {
    expect(parseNthArgs(new Cursor('(1)'))).toEqual({ step: 0, offset: 1 });
    expect(parseNthArgs(new Cursor('(-3)'))).toEqual({ step: 0, offset: -3 });
    expect(parseNthArgs(new Cursor('(+5)'))).toEqual({ step: 0, offset: 5 });
  });

  it('parses n forms', () => {
    expect(parseNthArgs(new Cursor('(n)'))).toEqual({ step: 1, offset: 0 });
    expect(parseNthArgs(new Cursor('(-n)'))).toEqual({ step: -1, offset: 0 });
    expect(parseNthArgs(new Cursor('(+n)'))).toEqual({ step: 1, offset: 0 });
  });

  it('parses An+B forms', () => {
    expect(parseNthArgs(new Cursor('(2n+1)'))).toEqual({ step: 2, offset: 1 });
    expect(parseNthArgs(new Cursor('(2n - 1)'))).toEqual({ step: 2, offset: -1 });
    expect(parseNthArgs(new Cursor('(-2n+3)'))).toEqual({ step: -2, offset: 3 });
  });

  it('throws on missing or invalid arguments', () => {
    expect(() => parseNthArgs(new Cursor('()'))).toThrow();
    expect(() => parseNthArgs(new Cursor('(n+)'))).toThrow('Expected nth offset');
    expect(() => parseNthArgs(new Cursor('(foo)'))).toThrow('Expected nth expression');
  });
});

describe('parsePseudoBodySelectorList', () => {
  it('parses a single selector arm', () => {
    const parsed = parsePseudoBodySelectorList(new Cursor('(div.foo)'));

    expect(parsed.selectors).toHaveLength(1);

    const parts = parsed.selectors[0].parts;
    expect(parts).toHaveLength(1);
    expect(parts[0].combinator).toBeNull();
    expect(parts[0].compound.tag).toEqual({ localRaw: 'div' });
    expect(parts[0].compound.classes?.map(c => c.raw)).toEqual(['foo']);
  });

  it('parses comma-separated selector arms', () => {
    const parsed = parsePseudoBodySelectorList(new Cursor('(#a, .b, div)'));

    expect(parsed.selectors).toHaveLength(3);

    expect(parsed.selectors[0].parts[0].compound.id?.raw).toBe('a');
    expect(parsed.selectors[1].parts[0].compound.classes?.map(c => c.raw)).toEqual(['b']);
    expect(parsed.selectors[2].parts[0].compound.tag).toEqual({ localRaw: 'div' });
  });

  it('parses complex selector arms', () => {
    const parsed = parsePseudoBodySelectorList(new Cursor('(#root > p + a ~ span)'));

    expect(parsed.selectors).toHaveLength(1);

    const parts = parsed.selectors[0].parts;
    expect(parts.map(p => p.combinator)).toEqual([null, '>', '+', '~']);
    expect(parts[0].compound.id?.raw).toBe('root');
    expect(parts[1].compound.tag).toEqual({ localRaw: 'p' });
    expect(parts[2].compound.tag).toEqual({ localRaw: 'a' });
    expect(parts[3].compound.tag).toEqual({ localRaw: 'span' });
  });

  it('ignores padding whitespace around arms and before closing paren', () => {
    const parsed = parsePseudoBodySelectorList(new Cursor('(  #a  ,   .b   )'));

    expect(parsed.selectors).toHaveLength(2);
    expect(parsed.selectors[0].parts[0].compound.id?.raw).toBe('a');
    expect(parsed.selectors[1].parts[0].compound.classes?.map(c => c.raw)).toEqual(['b']);
  });

  it('stops at the closing paren without consuming following text', () => {
    const c = new Cursor('(div.foo) + span');
    const parsed = parsePseudoBodySelectorList(c);

    expect(parsed.selectors).toHaveLength(1);
    expect(parsed.selectors[0].parts[0].compound.tag).toEqual({ localRaw: 'div' });
    expect(c.peek()).toBe(' ');
    expect(c.startsWith(' + span')).toBe(true);
  });

  it('allows EOF in place of the closing paren for now', () => {
    const parsed = parsePseudoBodySelectorList(new Cursor('(div.foo'));

    expect(parsed.selectors).toHaveLength(1);
    expect(parsed.selectors[0].parts[0].compound.tag).toEqual({ localRaw: 'div' });
    expect(parsed.selectors[0].parts[0].compound.classes?.map(c => c.raw)).toEqual(['foo']);
  });

  it('does not split on commas inside attribute strings or nested pseudo bodies', () => {
    const parsed = parsePseudoBodySelectorList(
      new Cursor(`([data-x="a,b"]:not(.hidden), div)`)
    );

    expect(parsed.selectors).toHaveLength(2);
    expect(parsed.selectors[0].parts).toHaveLength(1);
    expect(parsed.selectors[0].parts[0].compound.tests.length).toBeGreaterThan(0);
    expect(parsed.selectors[1].parts[0].compound.tag).toEqual({ localRaw: 'div' });
  });

  it('throws on empty body', () => {
    expect(() => parsePseudoBodySelectorList(new Cursor('()'))).toThrow(
      'Expected selector in pseudo-class body'
    );

    expect(() => parsePseudoBodySelectorList(new Cursor('(   )'))).toThrow(
      'Expected selector in pseudo-class body'
    );
  });

  it('throws on trailing comma', () => {
    expect(() => parsePseudoBodySelectorList(new Cursor('(div,)'))).toThrow(
      'Expected selector after comma in pseudo-class body'
    );

    expect(() => parsePseudoBodySelectorList(new Cursor('(div,   )'))).toThrow(
      'Expected selector after comma in pseudo-class body'
    );
  });

  it('rejects leading combinators because this is not a relative selector list', () => {
    expect(() => parsePseudoBodySelectorList(new Cursor('(> img)'))).toThrow(
      'Expected compound selector'
    );

    expect(() => parsePseudoBodySelectorList(new Cursor('(+ dt)'))).toThrow(
      'Expected compound selector'
    );
  });

  it('throws when a combinator has no right compound', () => {
    expect(() => parsePseudoBodySelectorList(new Cursor('(div >)'))).toThrow(
      'Expected compound selector after combinator'
    );

    expect(() => parsePseudoBodySelectorList(new Cursor('(div > , .b)'))).toThrow(
      'Expected compound selector after combinator'
    );
  });
});

describe('parsePseudoBodyRelativeSelectorList', () => {
  it('parses a descendant relative selector by default', () => {
    const parsed = parsePseudoBodyRelativeSelectorList(new Cursor('(img)'));

    expect(parsed.selectors).toHaveLength(1);
    expect(parsed.selectors[0].steps).toHaveLength(1);

    expect(parsed.selectors[0].steps[0].combinator).toBe(' ');
    expect(parsed.selectors[0].steps[0].compound.tag).toEqual({
      localRaw: 'img',
    });
  });

  it('parses an explicit leading child combinator', () => {
    const parsed = parsePseudoBodyRelativeSelectorList(new Cursor('(> img)'));

    expect(parsed.selectors).toHaveLength(1);
    expect(parsed.selectors[0].steps).toHaveLength(1);

    expect(parsed.selectors[0].steps[0].combinator).toBe('>');
    expect(parsed.selectors[0].steps[0].compound.tag).toEqual({
      localRaw: 'img',
    });
  });

  it('parses explicit leading sibling combinators', () => {
    expect(parsePseudoBodyRelativeSelectorList(new Cursor('(+ dt)'))
      .selectors[0].steps[0]).toMatchObject({
        combinator: '+',
        compound: { tag: { localRaw: 'dt' } },
      });

    expect(parsePseudoBodyRelativeSelectorList(new Cursor('(~ .item)'))
      .selectors[0].steps[0].combinator).toBe('~');

    expect(parsePseudoBodyRelativeSelectorList(new Cursor('(~ .item)'))
      .selectors[0].steps[0].compound.classes?.map(c => c.raw)).toEqual(['item']);
  });

  it('parses multiple steps with mixed combinators', () => {
    const parsed = parsePseudoBodyRelativeSelectorList(
      new Cursor('(> .item + dt ~ dd span)')
    );

    const steps = parsed.selectors[0].steps;

    expect(steps.map(s => s.combinator)).toEqual(['>', '+', '~', ' ']);
    expect(steps[0].compound.classes?.map(c => c.raw)).toEqual(['item']);
    expect(steps[1].compound.tag).toEqual({ localRaw: 'dt' });
    expect(steps[2].compound.tag).toEqual({ localRaw: 'dd' });
    expect(steps[3].compound.tag).toEqual({ localRaw: 'span' });
  });

  it('parses comma-separated relative selector arms', () => {
    const parsed = parsePseudoBodyRelativeSelectorList(
      new Cursor('(> img, + dt, .item .child)')
    );

    expect(parsed.selectors).toHaveLength(3);

    expect(parsed.selectors[0].steps.map(s => s.combinator)).toEqual(['>']);
    expect(parsed.selectors[0].steps[0].compound.tag).toEqual({ localRaw: 'img' });

    expect(parsed.selectors[1].steps.map(s => s.combinator)).toEqual(['+']);
    expect(parsed.selectors[1].steps[0].compound.tag).toEqual({ localRaw: 'dt' });

    expect(parsed.selectors[2].steps.map(s => s.combinator)).toEqual([' ', ' ']);
    expect(parsed.selectors[2].steps[0].compound.classes?.map(c => c.raw)).toEqual(['item']);
    expect(parsed.selectors[2].steps[1].compound.classes?.map(c => c.raw)).toEqual(['child']);
  });

  it('ignores padding whitespace around arms and before closing paren', () => {
    const parsed = parsePseudoBodyRelativeSelectorList(
      new Cursor('(  > img  ,   .item   )')
    );

    expect(parsed.selectors).toHaveLength(2);
    expect(parsed.selectors[0].steps[0].combinator).toBe('>');
    expect(parsed.selectors[0].steps[0].compound.tag).toEqual({ localRaw: 'img' });

    expect(parsed.selectors[1].steps[0].combinator).toBe(' ');
    expect(parsed.selectors[1].steps[0].compound.classes?.map(c => c.raw)).toEqual(['item']);
  });

  it('allows EOF in place of the closing paren for now', () => {
    const parsed = parsePseudoBodyRelativeSelectorList(new Cursor('(> img'));

    expect(parsed.selectors).toHaveLength(1);
    expect(parsed.selectors[0].steps[0].combinator).toBe('>');
    expect(parsed.selectors[0].steps[0].compound.tag).toEqual({ localRaw: 'img' });
  });

  it('throws on empty body', () => {
    expect(() => parsePseudoBodyRelativeSelectorList(new Cursor('()'))).toThrow(
      'Expected relative selector in pseudo-class body'
    );

    expect(() => parsePseudoBodyRelativeSelectorList(new Cursor('(   )'))).toThrow(
      'Expected relative selector in pseudo-class body'
    );
  });

  it('throws on trailing comma', () => {
    expect(() => parsePseudoBodyRelativeSelectorList(new Cursor('(> img,)'))).toThrow(
      'Expected relative selector after comma in pseudo-class body'
    );

    expect(() => parsePseudoBodyRelativeSelectorList(new Cursor('(> img,   )'))).toThrow(
      'Expected relative selector after comma in pseudo-class body'
    );
  });

  it('throws when a combinator has no right compound', () => {
    expect(() => parsePseudoBodyRelativeSelectorList(new Cursor('(>)'))).toThrow(
      'Expected compound selector in relative selector'
    );

    expect(() => parsePseudoBodyRelativeSelectorList(new Cursor('(> img +)'))).toThrow(
      'Expected compound selector after combinator in relative selector'
    );
  });

  it('does not split on commas inside attribute strings or pseudo bodies', () => {
    const parsed = parsePseudoBodyRelativeSelectorList(
      new Cursor(`([data-x="a,b"]:not(.hidden), > img)`)
    );

    expect(parsed.selectors).toHaveLength(2);

    expect(parsed.selectors[0].steps).toHaveLength(1);
    expect(parsed.selectors[0].steps[0].compound.tests.length).toBeGreaterThan(0);

    expect(parsed.selectors[1].steps[0].combinator).toBe('>');
    expect(parsed.selectors[1].steps[0].compound.tag).toEqual({ localRaw: 'img' });
  });
});

describe('parsePseudoTestSource linguistic and location pseudos', () => {
  it('accepts linguistic pseudo-classes', () => {
    expect(parseCompoundSelector(new Cursor('div:dir(ltr)')).tests.length).toBeGreaterThan(0);
    expect(parseCompoundSelector(new Cursor('div:dir(rtl)')).tests.length).toBeGreaterThan(0);
    expect(parseCompoundSelector(new Cursor('div:lang(en)')).tests.length).toBeGreaterThan(0);
  });

  it('accepts location pseudo-classes', () => {
    for (const pseudo of ['any-link', 'link', 'visited', 'target', 'defined']) {
      const compound = parseCompoundSelector(new Cursor(`a:${pseudo}`));

      expect(compound.tag).toEqual({ localRaw: 'a' });
      expect(compound.tests.length).toBeGreaterThan(0);
    }
  });

  it('rejects empty linguistic pseudo-class arguments', () => {
    expect(() => parseCompoundSelector(new Cursor('div:dir()'))).toThrow('Expected pseudo-class argument');
    expect(() => parseCompoundSelector(new Cursor('div:lang()'))).toThrow('Expected pseudo-class argument');
  });
});

describe('parsePseudoTestSource oddball pseudo parsing', () => {
  it('accepts no-op autofill pseudo-classes', () => {
    expect(parseCompoundSelector(new Cursor('input:autofill')).tests.length).toBeGreaterThan(0);
    expect(parseCompoundSelector(new Cursor('input:-webkit-autofill')).tests.length).toBeGreaterThan(0);
  });

  it('accepts legacy single-colon pseudo-elements as no-match pseudos', () => {
    for (const pseudo of ['after', 'before', 'first-letter', 'first-line']) {
      const compound = parseCompoundSelector(new Cursor(`div:${pseudo}`));

      expect(compound.tag).toEqual({ localRaw: 'div' });
      expect(compound.tests.length).toBeGreaterThan(0);
    }
  });

  it('accepts supported double-colon pseudo-elements as no-match pseudos', () => {
    for (const pseudo of ['after', 'before', 'first-letter', 'first-line', 'selection', 'placeholder']) {
      const compound = parseCompoundSelector(new Cursor(`div::${pseudo}`));

      expect(compound.tag).toEqual({ localRaw: 'div' });
      expect(compound.tests.length).toBeGreaterThan(0);
    }
  });

  it('accepts arbitrary double-colon -webkit pseudo-elements', () => {
    const compound = parseCompoundSelector(new Cursor('input::-webkit-search-cancel-button'));

    expect(compound.tag).toEqual({ localRaw: 'input' });
    expect(compound.tests.length).toBeGreaterThan(0);
  });

  it('rejects arbitrary single-colon -webkit pseudos except -webkit-autofill', () => {
    expect(() => parseCompoundSelector(new Cursor('input:-webkit-search-cancel-button'))).toThrow(
      'Unsupported pseudo-class'
    );
  });

  it('rejects unsupported double-colon pseudo-elements', () => {
    expect(() => parseCompoundSelector(new Cursor('div::marker'))).toThrow(
      'Unsupported pseudo-element'
    );
  });
});
