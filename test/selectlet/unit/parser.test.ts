import { describe, it, expect } from 'vitest';
import type { ParseContext } from '../../../src/selectlet/parser/parser';
import {
  parseAttributeSelector, parseComplexSelector, parseCompoundSelector, parseForgivingSelectorList, parseRelativeSelectorList, parseSelectorList, parseStrictSelectorList,
} from '../../../src/selectlet/parser/parser';
import { TextCursor } from '../../../src/shared/text-cursor';
import { consumeIdent } from '../../../src/selectlet/parser/lex';
import { parseNthArgs } from '../../../src/selectlet/parser/nth';
import { describeRelativeCompound, describeRelativeStep } from '../util';
// import { describeRelativeCompound } from '../utils/util';

describe('parseSelectorList', () => {
  it('parses a single selector', () => {
    const parsed = parseSelectorList('  #root p  ', {});

    expect(parsed.arms).toHaveLength(1);

    const [complex] = parsed.arms;
    expect(complex.parts).toHaveLength(2);
    expect(complex.parts.map((p) => p.combinator)).toEqual([null, ' ']);
    expect(complex.parts[0].compound.id?.raw).toBe('root');
    expect(complex.parts[1].compound.tag?.localRaw).toBe('p');
  });

  it('parses comma-separated selectors', () => {
    const parsed = parseSelectorList(' #a, .b, div ', {});

    expect(parsed.arms).toHaveLength(3);

    expect(parsed.arms[0].parts).toHaveLength(1);
    expect(parsed.arms[0].parts[0].compound.id?.raw).toBe('a');

    expect(parsed.arms[1].parts).toHaveLength(1);
    expect(parsed.arms[1].parts[0].compound.classes?.map((c) => c.raw)).toEqual(['b']);

    expect(parsed.arms[2].parts).toHaveLength(1);
    expect(parsed.arms[2].parts[0].compound.tag?.localRaw).toBe('div');
  });

  it('throws on empty input', () => {
    expect(() => parseSelectorList('   ', {})).toThrow('Expected selector');
  });

  it('throws on trailing comma', () => {
    expect(() => parseSelectorList('#a,   ', {})).toThrow('Expected selector after comma');
  });
});

describe('parseComplexSelector', () => {
  it('parses a single compound', () => {
    const c = new TextCursor('#root');
    const complex = parseComplexSelector(c, {});

    expect(complex.parts).toHaveLength(1);
    expect(complex.parts[0].combinator).toBeNull();
    expect(complex.parts[0].compound.id?.raw).toBe('root');
    expect(c.eof()).toBe(true);
  });

  it('parses descendant combinators from whitespace', () => {
    const c = new TextCursor('#root p');
    const complex = parseComplexSelector(c, {});

    expect(complex.parts).toHaveLength(2);
    expect(complex.parts.map((p) => p.combinator)).toEqual([null, ' ']);
    expect(complex.parts[0].compound.id?.raw).toBe('root');
    expect(complex.parts[1].compound.tag?.localRaw).toBe('p');
  });

  it('parses explicit combinators with surrounding whitespace', () => {
    const c = new TextCursor('#root   >   p + a ~ span');
    const complex = parseComplexSelector(c, {});

    expect(complex.parts).toHaveLength(4);
    expect(complex.parts.map((p) => p.combinator)).toEqual([null, '>', '+', '~']);
    expect(complex.parts[0].compound.id?.raw).toBe('root');
    expect(complex.parts[1].compound.tag?.localRaw).toBe('p');
    expect(complex.parts[2].compound.tag?.localRaw).toBe('a');
    expect(complex.parts[3].compound.tag?.localRaw).toBe('span');
  });

  it('stops before a comma without consuming it', () => {
    const c = new TextCursor('#a > p, .b');
    const complex = parseComplexSelector(c, {});

    expect(complex.parts).toHaveLength(2);
    expect(complex.parts.map((p) => p.combinator)).toEqual([null, '>']);
    expect(complex.parts[0].compound.id?.raw).toBe('a');
    expect(complex.parts[1].compound.tag?.localRaw).toBe('p');
    expect(c.peek()).toBe(',');
  });

  it('stops before a closing paren without consuming it', () => {
    const c = new TextCursor('#a > p)');
    const complex = parseComplexSelector(c, {});

    expect(complex.parts).toHaveLength(2);
    expect(complex.parts.map((p) => p.combinator)).toEqual([null, '>']);
    expect(complex.parts[0].compound.id?.raw).toBe('a');
    expect(complex.parts[1].compound.tag?.localRaw).toBe('p');
    expect(c.peek()).toBe(')');
  });

  it('throws when an explicit combinator has no right compound', () => {
    expect(() => parseComplexSelector(new TextCursor('#a >'), {})).toThrow(
      'Expected compound selector after combinator'
    );

    expect(() => parseComplexSelector(new TextCursor('#a > , .b'), {})).toThrow(
      'Expected compound selector after combinator'
    );
  });

  it('throws on empty input', () => {
    expect(() => parseComplexSelector(new TextCursor(''), {})).toThrow('Expected compound selector');
  });

  it('throws when input starts with a combinator for now', () => {
    expect(() => parseComplexSelector(new TextCursor('> p'), {})).toThrow('Expected compound selector');
  });
});

describe('parseCompoundSelector', () => {
  it('parses tag, id, and class pieces', () => {
    const c = new TextCursor('div#root.foo.bar');
    const compound = parseCompoundSelector(c, {});

    expect(compound.tag?.localRaw).toBe('div');
    expect(compound.id?.raw).toBe('root');
    expect(compound.classes?.map((x) => x.raw)).toEqual(['foo', 'bar']);
    expect(compound.tests).toEqual([]);
    expect(c.eof()).toBe(true);
  });

  it('parses class-only compounds', () => {
    const c = new TextCursor('.foo.bar');
    const compound = parseCompoundSelector(c, {});

    expect(compound.tag).toBeUndefined();
    expect(compound.id).toBeUndefined();
    expect(compound.classes?.map((x) => x.raw)).toEqual(['foo', 'bar']);
    expect(compound.tests).toEqual([]);
  });

  it('parses universal tag selector', () => {
    const c = new TextCursor('*.foo');
    const compound = parseCompoundSelector(c, {});

    expect(compound.tag?.localRaw).toBe('*');
    expect(compound.classes?.map((x) => x.raw)).toEqual(['foo']);
    expect(compound.tests).toEqual([]);
  });

  it('attaches attribute and pseudo selectors to test source', () => {
    const c = new TextCursor('p[data-x="a b"]:not(.hidden)');
    const compound = parseCompoundSelector(c, {});

    expect(compound.tag?.localRaw).toBe('p');
    expect(compound.tests.length).toBeGreaterThan(0);
    expect(c.eof()).toBe(true);
  });

  it('does not stop on spaces or combinators inside attribute strings and pseudo args', () => {
    const c = new TextCursor(`p[data-x="a > b"]:not(.a > .b) + span`);
    const compound = parseCompoundSelector(c, {});

    expect(compound.tag?.localRaw).toBe('p');
    expect(compound.tests.length).toBeGreaterThan(0);
    expect(c.peek()).toBe(' ');
  });

  it('stops before whitespace or combinator', () => {
    const c = new TextCursor('div.foo > p');
    const compound = parseCompoundSelector(c, {});

    expect(compound.tag?.localRaw).toBe('div');
    expect(compound.classes?.map((x) => x.raw)).toEqual(['foo']);
    expect(compound.tests).toEqual([]);
    expect(c.peek()).toBe(' ');
  });

  it('throws on missing selector after class/id prefix', () => {
    expect(() => parseCompoundSelector(new TextCursor('.'), {})).toThrow('Expected identifier');
    expect(() => parseCompoundSelector(new TextCursor('#'), {})).toThrow('Expected identifier');
  });

  it('throws on empty input', () => {
    expect(() => parseCompoundSelector(new TextCursor(''), {})).toThrow('Expected compound selector');
  });

  it('parses escaped characters in identifiers', () => {
    const compound = parseCompoundSelector(new TextCursor(String.raw`div.foo\+bar#id\31 a`), {});

    expect(compound.tag?.localRaw).toBe('div');
    expect(compound.classes?.[0].raw).toBe(String.raw`foo\+bar`);
    expect(compound.id?.raw).toBe(String.raw`id\31 a`);
  });

  it('accepts nth structural pseudo-classes', () => {
    for (const pseudo of ['nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type']) {
      const compound = parseCompoundSelector(new TextCursor(`div:${pseudo}(2n+1)`), {});

      expect(compound.tag?.localRaw).toBe('div');
      expect(compound.tests.length).toBeGreaterThan(0);
    }
  });

  it('accepts multiple ID selectors in one compound 1', () => {
    expect(() => parseCompoundSelector(new TextCursor('#a#a'), {})).not.toThrow();
    expect(() => parseCompoundSelector(new TextCursor('#a#b'), {})).not.toThrow();
    expect(() => parseSelectorList('#a#b, #ok', {})).not.toThrow();
  });

  it('accepts multiple ID selectors in one compound 2', () => {
    let compound = parseCompoundSelector(new TextCursor('#a#a'), {});
    expect(compound.id?.raw).toBe('a');

    compound = parseCompoundSelector(new TextCursor('#a#b'), {});
    expect(compound.id?.raw).toBe('a');

    expect(() => parseSelectorList('#a#b, #ok', {})).not.toThrow();
  });
});

describe('consumeIdent', () => {
  it('consumes ordinary identifiers', () => {
    const c = new TextCursor('foo.bar');

    expect(consumeIdent(c)).toBe('foo');
    expect(c.peek()).toBe('.');
  });

  it('allows leading dash before an ident head', () => {
    const c = new TextCursor('-foo.bar');

    expect(consumeIdent(c)).toBe('-foo');
    expect(c.peek()).toBe('.');
  });

  it('allows double-dash identifiers', () => {
    const c = new TextCursor('--foo.bar');

    expect(consumeIdent(c)).toBe('--foo');
    expect(c.peek()).toBe('.');
  });

  it('allows bare double-dash by old regex behavior', () => {
    const c = new TextCursor('--.foo');

    expect(consumeIdent(c)).toBe('--');
    expect(c.peek()).toBe('.');
  });

  it('consumes simple escapes in identifiers', () => {
    const c = new TextCursor(String.raw`foo\+bar.baz`);

    expect(consumeIdent(c)).toBe(String.raw`foo\+bar`);
    expect(c.peek()).toBe('.');
  });

  it('consumes unicode escapes and one trailing whitespace', () => {
    const c = new TextCursor(String.raw`foo\31 bar.baz`);

    expect(consumeIdent(c)).toBe(String.raw`foo\31 bar`);
    expect(c.peek()).toBe('.');
  });

  it('consumes unicode escapes with CRLF trailing whitespace', () => {
    const c = new TextCursor('foo\\31\r\nbar.baz');

    expect(consumeIdent(c)).toBe('foo\\31\r\nbar');
    expect(c.peek()).toBe('.');
  });

  it('does not consume invalid identifiers', () => {
    expect(() => consumeIdent(new TextCursor('1foo'))).toThrow('Expected identifier');
    expect(() => consumeIdent(new TextCursor('-1foo'))).toThrow('Expected identifier');
    expect(() => consumeIdent(new TextCursor('\\\nfoo'))).toThrow('Expected identifier');
  });
});

describe('parseTagSelector namespace forms', () => {
  it('parses plain tag and universal tag selectors', () => {
    expect(parseCompoundSelector(new TextCursor('div'), {}).tag).toMatchObject({ localRaw: 'div' });
    expect(parseCompoundSelector(new TextCursor('*'), {}).tag).toMatchObject({ localRaw: '*' });
  });

  it('parses supported namespace tag selectors', () => {
    expect(parseCompoundSelector(new TextCursor('*|circle'), {}).tag).toMatchObject({
      prefixRaw: '*',
      localRaw: 'circle',
    });

    expect(parseCompoundSelector(new TextCursor('|circle'), {}).tag).toMatchObject({
      prefixRaw: '',
      localRaw: 'circle',
    });
  });

  it('parses supported namespaced universal local selectors', () => {
    expect(parseCompoundSelector(new TextCursor('*|*'), {}).tag).toMatchObject({
      prefixRaw: '*',
      localRaw: '*',
    });

    expect(parseCompoundSelector(new TextCursor('|*'), {}).tag).toMatchObject({
      prefixRaw: '',
      localRaw: '*',
    });
  });

  it('parses classes after supported namespace tag selectors', () => {
    const compound = parseCompoundSelector(new TextCursor('*|circle.icon'), {});

    expect(compound.tag).toMatchObject({
      prefixRaw: '*',
      localRaw: 'circle',
    });
    expect(compound.classes?.map((c) => c.raw)).toEqual(['icon']);
  });

  it('rejects named namespace prefixes', () => {
    expect(() => parseCompoundSelector(new TextCursor('svg|circle'), {})).toThrow(
      'Unsupported namespace prefix'
    );

    expect(() => parseCompoundSelector(new TextCursor('svg|*'), {})).toThrow(
      'Unsupported namespace prefix'
    );
  });

  it('throws when namespace tag selector has no local part', () => {
    expect(() => parseCompoundSelector(new TextCursor('*|'), {})).toThrow('Expected identifier');
    expect(() => parseCompoundSelector(new TextCursor('|'), {})).toThrow('Expected identifier');
  });

  it('does not treat escaped pipe as a namespace separator', () => {
    const compound = parseCompoundSelector(new TextCursor(String.raw`svg\|circle.foo`), {});

    expect(compound.tag).toMatchObject({
      localRaw: String.raw`svg\|circle`,
    });
    expect(compound.classes?.map((c) => c.raw)).toEqual(['foo']);
  });
});

describe('parseAttributeSelector', () => {
  it('parses attribute presence selectors', () => {
    expect(parseAttributeSelector(new TextCursor('[attr]'))).toEqual({
      localRaw: 'attr',
    });

    expect(parseAttributeSelector(new TextCursor('[data-id]'))).toEqual({
      localRaw: 'data-id',
    });
  });

  it('parses supported namespace attribute selectors', () => {
    expect(parseAttributeSelector(new TextCursor('[|attr]'))).toEqual({
      prefixRaw: '',
      localRaw: 'attr',
    });

    expect(parseAttributeSelector(new TextCursor('[*|attr]'))).toEqual({
      prefixRaw: '*',
      localRaw: 'attr',
    });
  });

  it('rejects named namespace prefixes', () => {
    expect(() => parseAttributeSelector(new TextCursor('[xml|lang]'))).toThrow(
      'Unsupported namespace prefix'
    );
  });

  it('does not treat escaped pipe as a namespace separator', () => {
    expect(parseAttributeSelector(new TextCursor(String.raw`[xml\|lang]`))).toEqual({
      localRaw: String.raw`xml\|lang`,
    });
  });

  it('parses standard attribute operators with unquoted values', () => {
    expect(parseAttributeSelector(new TextCursor('[attr=value]'))).toEqual({
      localRaw: 'attr',
      op: '=',
      valueRaw: 'value',
    });

    expect(parseAttributeSelector(new TextCursor('[attr~=token]'))).toEqual({
      localRaw: 'attr',
      op: '~=',
      valueRaw: 'token',
    });

    expect(parseAttributeSelector(new TextCursor('[attr|=en]'))).toEqual({
      localRaw: 'attr',
      op: '|=',
      valueRaw: 'en',
    });

    expect(parseAttributeSelector(new TextCursor('[attr^=pre]'))).toEqual({
      localRaw: 'attr',
      op: '^=',
      valueRaw: 'pre',
    });

    expect(parseAttributeSelector(new TextCursor('[attr$=suf]'))).toEqual({
      localRaw: 'attr',
      op: '$=',
      valueRaw: 'suf',
    });

    expect(parseAttributeSelector(new TextCursor('[attr*=mid]'))).toEqual({
      localRaw: 'attr',
      op: '*=',
      valueRaw: 'mid',
    });
  });

  it('parses quoted attribute values without quotes', () => {
    expect(parseAttributeSelector(new TextCursor('[attr="value"]'))).toEqual({
      localRaw: 'attr',
      op: '=',
      valueRaw: 'value',
    });

    expect(parseAttributeSelector(new TextCursor("[attr='value']"))).toEqual({
      localRaw: 'attr',
      op: '=',
      valueRaw: 'value',
    });
  });

  it('preserves raw escapes inside attribute values', () => {
    expect(parseAttributeSelector(new TextCursor(String.raw`[attr="a\+b"]`))).toEqual({
      localRaw: 'attr',
      op: '=',
      valueRaw: String.raw`a\+b`,
    });

    expect(parseAttributeSelector(new TextCursor(String.raw`[attr=a\+b]`))).toEqual({
      localRaw: 'attr',
      op: '=',
      valueRaw: String.raw`a\+b`,
    });
  });

  it('parses normalized attribute selector flags', () => {
    expect(parseAttributeSelector(new TextCursor('[attr=value i]'))).toEqual({
      localRaw: 'attr',
      op: '=',
      valueRaw: 'value',
      flag: 'i',
    });

    expect(parseAttributeSelector(new TextCursor('[attr=value S]'))).toEqual({
      localRaw: 'attr',
      op: '=',
      valueRaw: 'value',
      flag: 's',
    });
  });

  it('allows whitespace around attribute selector parts', () => {
    expect(parseAttributeSelector(new TextCursor('[  attr  =  "value"  i  ]'))).toEqual({
      localRaw: 'attr',
      op: '=',
      valueRaw: 'value',
      flag: 'i',
    });
  });

  it('throws on unsupported attribute operators', () => {
    expect(() => parseAttributeSelector(new TextCursor('[attr!=value]'))).toThrow(
      'Expected attribute operator'
    );

    expect(() => parseAttributeSelector(new TextCursor('[attr?=value]'))).toThrow(
      'Expected attribute operator'
    );
  });

  it('throws when an operator has no value', () => {
    expect(() => parseAttributeSelector(new TextCursor('[attr=]'))).toThrow(
      'Expected identifier'
    );

    expect(() => parseAttributeSelector(new TextCursor('[attr=   ]'))).toThrow(
      'Expected identifier'
    );
  });

  it('throws when a flag appears without an operator/value', () => {
    expect(() => parseAttributeSelector(new TextCursor('[attr i]'))).toThrow();
  });

  it('throws on invalid flags', () => {
    expect(() => parseAttributeSelector(new TextCursor('[attr=value q]'))).toThrow(
      'Invalid attribute selector flag'
    );
  });

  it('throws on extra trailing content before closing bracket', () => {
    expect(() => parseAttributeSelector(new TextCursor('[attr=value i extra]'))).toThrow();
  });

  it('does not throw on missing right bracket for now', () => {
    expect(parseAttributeSelector(new TextCursor('[attr=value'))).toEqual({
      localRaw: 'attr',
      op: '=',
      valueRaw: 'value',
    });
  });

  it('accepts EOF as the end of a quoted attribute string', () => {
    const attr = parseAttributeSelector(new TextCursor('[attr="value'));

    expect(attr.localRaw).toBe('attr');
    expect(attr.op).toBe('=');
    expect(attr.valueRaw).toBe('value');
  });

  it('parses escaped attribute selector flags', () => {
    expect(parseAttributeSelector(new TextCursor(String.raw`[attr=value \69]`))).toEqual({
      localRaw: 'attr',
      op: '=',
      valueRaw: 'value',
      flag: 'i',
    });
  });
});

describe('parseNthArgs', () => {
  it('parses odd and even', () => {
    expect(parseNthArgs(new TextCursor('(odd)'))).toEqual({ step: 2, offset: 1 });
    expect(parseNthArgs(new TextCursor('(even)'))).toEqual({ step: 2, offset: 0 });
  });

  it('parses integer indexes', () => {
    expect(parseNthArgs(new TextCursor('(1)'))).toEqual({ step: 0, offset: 1 });
    expect(parseNthArgs(new TextCursor('(-3)'))).toEqual({ step: 0, offset: -3 });
    expect(parseNthArgs(new TextCursor('(+5)'))).toEqual({ step: 0, offset: 5 });
  });

  it('parses n forms', () => {
    expect(parseNthArgs(new TextCursor('(n)'))).toEqual({ step: 1, offset: 0 });
    expect(parseNthArgs(new TextCursor('(-n)'))).toEqual({ step: -1, offset: 0 });
    expect(parseNthArgs(new TextCursor('(+n)'))).toEqual({ step: 1, offset: 0 });
  });

  it('parses An+B forms', () => {
    expect(parseNthArgs(new TextCursor('(2n+1)'))).toEqual({ step: 2, offset: 1 });
    expect(parseNthArgs(new TextCursor('(2n - 1)'))).toEqual({ step: 2, offset: -1 });
    expect(parseNthArgs(new TextCursor('(-2n+3)'))).toEqual({ step: -2, offset: 3 });
  });

  it('throws on missing or invalid arguments', () => {
    expect(() => parseNthArgs(new TextCursor('()'))).toThrow();
    expect(() => parseNthArgs(new TextCursor('(n+)'))).toThrow('Expected offset in nth expression');
    expect(() => parseNthArgs(new TextCursor('(foo)'))).toThrow('Expected nth expression');
  });
});

describe('parsePseudoBodySelectorList', () => {
  it('parses a single selector arm', () => {
    const parsed = parseStrictSelectorList(new TextCursor('(div.foo)'), {});

    expect(parsed.arms).toHaveLength(1);

    const parts = parsed.arms[0].parts;
    expect(parts).toHaveLength(1);
    expect(parts[0].combinator).toBeNull();
    expect(parts[0].compound.tag).toMatchObject({ localRaw: 'div' });
    expect(parts[0].compound.classes?.map((c) => c.raw)).toEqual(['foo']);
  });

  it('parses comma-separated selector arms', () => {
    const parsed = parseStrictSelectorList(new TextCursor('(#a, .b, div)'), {});

    expect(parsed.arms).toHaveLength(3);

    expect(parsed.arms[0].parts[0].compound.id?.raw).toBe('a');
    expect(parsed.arms[1].parts[0].compound.classes?.map((c) => c.raw)).toEqual(['b']);
    expect(parsed.arms[2].parts[0].compound.tag).toMatchObject({ localRaw: 'div' });
  });

  it('parses complex selector arms', () => {
    const parsed = parseStrictSelectorList(new TextCursor('(#root > p + a ~ span)'), {});

    expect(parsed.arms).toHaveLength(1);

    const parts = parsed.arms[0].parts;
    expect(parts.map((p) => p.combinator)).toEqual([null, '>', '+', '~']);
    expect(parts[0].compound.id?.raw).toBe('root');
    expect(parts[1].compound.tag).toMatchObject({ localRaw: 'p' });
    expect(parts[2].compound.tag).toMatchObject({ localRaw: 'a' });
    expect(parts[3].compound.tag).toMatchObject({ localRaw: 'span' });
  });

  it('ignores padding whitespace around arms and before closing paren', () => {
    const parsed = parseStrictSelectorList(new TextCursor('(  #a  ,   .b   )'), {});

    expect(parsed.arms).toHaveLength(2);
    expect(parsed.arms[0].parts[0].compound.id?.raw).toBe('a');
    expect(parsed.arms[1].parts[0].compound.classes?.map((c) => c.raw)).toEqual(['b']);
  });

  it('stops at the closing paren without consuming following text', () => {
    const c = new TextCursor('(div.foo) + span');
    const parsed = parseStrictSelectorList(c, {});

    expect(parsed.arms).toHaveLength(1);
    expect(parsed.arms[0].parts[0].compound.tag).toMatchObject({ localRaw: 'div' });
    expect(c.peek()).toBe(' ');
  });

  it('allows EOF in place of the closing paren for now', () => {
    const parsed = parseStrictSelectorList(new TextCursor('(div.foo'), {});

    expect(parsed.arms).toHaveLength(1);
    expect(parsed.arms[0].parts[0].compound.tag).toMatchObject({ localRaw: 'div' });
    expect(parsed.arms[0].parts[0].compound.classes?.map((c) => c.raw)).toEqual(['foo']);
  });

  it('does not split on commas inside attribute strings or nested pseudo bodies', () => {
    const parsed = parseStrictSelectorList(new TextCursor(`([data-x="a,b"]:not(.hidden), div)`), {});

    expect(parsed.arms).toHaveLength(2);
    expect(parsed.arms[0].parts).toHaveLength(1);
    expect(parsed.arms[0].parts[0].compound.tests.length).toBeGreaterThan(0);
    expect(parsed.arms[1].parts[0].compound.tag).toMatchObject({ localRaw: 'div' });
  });

  it('throws on empty body', () => {
    expect(() => parseStrictSelectorList(new TextCursor('()'), {})).toThrow(
      'Expected selector in pseudo-class body'
    );

    expect(() => parseStrictSelectorList(new TextCursor('(   )'), {})).toThrow(
      'Expected selector in pseudo-class body'
    );
  });

  it('throws on trailing comma', () => {
    expect(() => parseStrictSelectorList(new TextCursor('(div,)'), {})).toThrow(
      'Expected selector after comma in pseudo-class body'
    );

    expect(() => parseStrictSelectorList(new TextCursor('(div,   )'), {})).toThrow(
      'Expected selector after comma in pseudo-class body'
    );
  });

  it('rejects leading combinators because this is not a relative selector list', () => {
    expect(() => parseStrictSelectorList(new TextCursor('(> img)'), {})).toThrow(
      'Expected compound selector'
    );

    expect(() => parseStrictSelectorList(new TextCursor('(+ dt)'), {})).toThrow(
      'Expected compound selector'
    );
  });

  it('throws when a combinator has no right compound', () => {
    expect(() => parseStrictSelectorList(new TextCursor('(div >)'), {})).toThrow(
      'Expected compound selector after combinator'
    );

    expect(() => parseStrictSelectorList(new TextCursor('(div > , .b)'), {})).toThrow(
      'Expected compound selector after combinator'
    );
  });
});

describe('parsePseudoBodyRelativeSelectorList', () => {
  it('parses a descendant relative selector by default', () => {
    const parsed = parseRelativeSelectorList(new TextCursor('(img)'), {});

    expect(parsed.arms).toHaveLength(1);
    expect(parsed.arms[0].steps).toHaveLength(1);

    expect(parsed.arms[0].steps[0].combinator).toBe(' ');
    expect(describeRelativeCompound(parsed.arms[0].steps[0].compound)).toBe('img');
  });

  it('parses an explicit leading child combinator', () => {
    const parsed = parseRelativeSelectorList(new TextCursor('(> img)'), {});

    expect(parsed.arms).toHaveLength(1);
    expect(parsed.arms[0].steps).toHaveLength(1);

    expect(parsed.arms[0].steps[0].combinator).toBe('>');
    expect(describeRelativeCompound(parsed.arms[0].steps[0].compound)).toBe('img');
  });

  it('parses explicit leading sibling combinators', () => {
    expect(describeRelativeStep(
      parseRelativeSelectorList(new TextCursor('(+ dt)'), {})
        .arms[0].steps[0])).toBe('+ dt');

    expect(parseRelativeSelectorList(new TextCursor('(~ .item)'), {})
      .arms[0].steps[0].combinator).toBe('~');

    expect(describeRelativeCompound(
      parseRelativeSelectorList(new TextCursor('(~ .item)'), {})
        .arms[0].steps[0].compound)).toBe('.item');
  });

  it('parses multiple steps with mixed combinators', () => {
    const parsed = parseRelativeSelectorList(new TextCursor('(> .item + dt ~ dd span)'), {});

    const steps = parsed.arms[0].steps;

    expect(steps.map((s) => s.combinator)).toEqual(['>', '+', '~', ' ']);
    expect(steps.map((s) => describeRelativeCompound(s.compound))).toEqual(['.item', 'dt', 'dd', 'span']);
  });

  it('parses comma-separated relative selector arms', () => {
    const parsed = parseRelativeSelectorList(new TextCursor('(> img, + dt, .item .child)'), {});

    expect(parsed.arms).toHaveLength(3);

    expect(parsed.arms[0].steps.map((s) => s.combinator)).toEqual(['>']);
    expect(parsed.arms[0].steps.map((s) => describeRelativeCompound(s.compound))).toEqual(['img']);

    expect(parsed.arms[1].steps.map((s) => s.combinator)).toEqual(['+']);
    expect(parsed.arms[1].steps.map((s) => describeRelativeCompound(s.compound))).toEqual(['dt']);

    expect(parsed.arms[2].steps.map((s) => s.combinator)).toEqual([' ', ' ']);
    expect(parsed.arms[2].steps.map((s) => describeRelativeCompound(s.compound))).toEqual(['.item', '.child']);
  });

  it('ignores padding whitespace around arms and before closing paren', () => {
    const parsed = parseRelativeSelectorList(new TextCursor('(  > img  ,   .item   )'), {});

    expect(parsed.arms).toHaveLength(2);

    expect(parsed.arms[0].steps[0].combinator).toBe('>');
    expect(describeRelativeCompound(parsed.arms[0].steps[0].compound)).toBe('img');

    expect(parsed.arms[1].steps[0].combinator).toBe(' ');
    expect(describeRelativeCompound(parsed.arms[1].steps[0].compound)).toBe('.item');
  });

  it('allows EOF in place of the closing paren for now', () => {
    const parsed = parseRelativeSelectorList(new TextCursor('(> img'), {});

    expect(parsed.arms).toHaveLength(1);
    expect(parsed.arms[0].steps[0].combinator).toBe('>');
    expect(describeRelativeCompound(parsed.arms[0].steps[0].compound)).toBe('img');
  });

  it('throws on empty body', () => {
    expect(() => parseRelativeSelectorList(new TextCursor('()'), {})).toThrow(
      'Expected relative selector in pseudo-class body'
    );

    expect(() => parseRelativeSelectorList(new TextCursor('(   )'), {})).toThrow(
      'Expected relative selector in pseudo-class body'
    );
  });

  it('throws on trailing comma', () => {
    expect(() => parseRelativeSelectorList(new TextCursor('(> img,)'), {})).toThrow(
      'Expected relative selector after comma in pseudo-class body'
    );

    expect(() => parseRelativeSelectorList(new TextCursor('(> img,   )'), {})).toThrow(
      'Expected relative selector after comma in pseudo-class body'
    );
  });

  it('throws when a combinator has no right compound', () => {
    expect(() => parseRelativeSelectorList(new TextCursor('(>)'), {})).toThrow(
      'Expected compound selector after combinator'
    );

    expect(() => parseRelativeSelectorList(new TextCursor('(> img +)'), {})).toThrow(
      'Expected compound selector after combinator in relative selector'
    );
  });

  it('does not split on commas inside attribute strings or pseudo bodies', () => {
    const parsed = parseRelativeSelectorList(new TextCursor(`([data-x="a,b"]:not(.hidden), > img)`), {});

    expect(parsed.arms).toHaveLength(2);

    expect(parsed.arms[0].steps).toHaveLength(1);
    expect(parsed.arms[1].steps[0].combinator).toBe('>');
    expect(describeRelativeCompound(parsed.arms[1].steps[0].compound)).toBe('img');
  });
});

describe('parsePseudoTestSource linguistic and location pseudos', () => {
  it('accepts linguistic pseudo-classes', () => {
    expect(parseCompoundSelector(new TextCursor('div:dir(ltr)'), {}).tests.length).toBeGreaterThan(0);
    expect(parseCompoundSelector(new TextCursor('div:dir(rtl)'), {}).tests.length).toBeGreaterThan(0);
    expect(parseCompoundSelector(new TextCursor('div:lang(en)'), {}).tests.length).toBeGreaterThan(0);
  });

  it('accepts location pseudo-classes', () => {
    for (const pseudo of ['any-link', 'link', 'visited', 'target', 'defined']) {
      const compound = parseCompoundSelector(new TextCursor(`a:${pseudo}`), {});

      expect(compound.tag).toMatchObject({ localRaw: 'a' });
      expect(compound.tests.length).toBeGreaterThan(0);
    }
  });

  it('rejects empty linguistic pseudo-class arguments', () => {
    expect(() => parseCompoundSelector(new TextCursor('div:dir()'), {})).toThrow('Expected argument in pseudo-class');
    expect(() => parseCompoundSelector(new TextCursor('div:lang()'), {})).toThrow('Expected argument in pseudo-class');
  });
});

describe('parsePseudoTestSource oddball pseudo parsing', () => {
  it('accepts no-op autofill pseudo-classes', () => {
    expect(parseCompoundSelector(new TextCursor('input:autofill'), {}).tests.length).toBeGreaterThan(0);
    expect(parseCompoundSelector(new TextCursor('input:-webkit-autofill'), {}).tests.length).toBeGreaterThan(0);
  });

  it('accepts legacy single-colon pseudo-elements as no-match pseudos', () => {
    for (const pseudo of ['after', 'before', 'first-letter', 'first-line']) {
      const compound = parseCompoundSelector(new TextCursor(`div:${pseudo}`), {});

      expect(compound.tag).toMatchObject({ localRaw: 'div' });
      expect(compound.tests.length).toBeGreaterThan(0);
    }
  });

  it('accepts supported double-colon pseudo-elements as no-match pseudos', () => {
    for (const pseudo of ['after', 'before', 'first-letter', 'first-line', 'selection', 'placeholder']) {
      const compound = parseCompoundSelector(new TextCursor(`div::${pseudo}`), {});

      expect(compound.tag).toMatchObject({ localRaw: 'div' });
      expect(compound.tests.length).toBeGreaterThan(0);
    }
  });

  it('accepts arbitrary double-colon -webkit pseudo-elements', () => {
    const compound = parseCompoundSelector(new TextCursor('input::-webkit-search-cancel-button'), {});

    expect(compound.tag).toMatchObject({ localRaw: 'input' });
    expect(compound.tests.length).toBeGreaterThan(0);
  });

  it('rejects arbitrary single-colon -webkit pseudos except -webkit-autofill', () => {
    expect(() => parseCompoundSelector(new TextCursor('input:-webkit-search-cancel-button'), {})).toThrow(
      'Unsupported pseudo-class'
    );
  });

  it('rejects unsupported double-colon pseudo-elements', () => {
    expect(() => parseCompoundSelector(new TextCursor('div::marker'), {})).toThrow(
      'Unsupported pseudo-element'
    );
  });

  it('accepts EOF in place of closing paren for supported pseudo-element args', () => {
    expect(parseCompoundSelector(new TextCursor(':lang(foo'), {}).tests.length).toBe(1);
    expect(parseCompoundSelector(new TextCursor('::slotted(foo'), {}).tests.length).toBe(1);
    expect(parseCompoundSelector(new TextCursor('::part(foo'), {}).tests.length).toBe(1);
  });
});

describe('parseAttributeSelector escaped values', () => {
  it('preserves raw escaped quoted attribute values', () => {
    expect(parseAttributeSelector(new TextCursor(String.raw`[attr="foo\"bar"]`))).toMatchObject({ localRaw: 'attr', op: '=', valueRaw: String.raw`foo\"bar` });
    expect(parseAttributeSelector(new TextCursor(String.raw`[attr="foo\\bar"]`))).toMatchObject({ localRaw: 'attr', op: '=', valueRaw: String.raw`foo\\bar` });
    expect(parseAttributeSelector(new TextCursor(String.raw`[attr="foo\a bar"]`))).toMatchObject({ localRaw: 'attr', op: '=', valueRaw: String.raw`foo\a bar` });
  });
});

describe('parse namespace edge cases', () => {
  it('rejects named namespace tag prefixes even when escaped or non-ASCII', () => {
    expect(() => parseCompoundSelector(new TextCursor('föo|item'), {})).toThrow('Unsupported namespace prefix');
    expect(() => parseCompoundSelector(new TextCursor('名前|item'), {})).toThrow('Unsupported namespace prefix');
    expect(() => parseCompoundSelector(new TextCursor(String.raw`foo\+bar|item`), {})).toThrow('Unsupported namespace prefix');
    expect(() => parseCompoundSelector(new TextCursor(String.raw`foo\:bar|item`), {})).toThrow('Unsupported namespace prefix');
    expect(() => parseCompoundSelector(new TextCursor(String.raw`\31 23|item`), {})).toThrow('Unsupported namespace prefix');
  });

  it('rejects named namespace attribute prefixes even when escaped or non-ASCII', () => {
    expect(() => parseAttributeSelector(new TextCursor('[föo|item]'))).toThrow('Unsupported namespace prefix');
    expect(() => parseAttributeSelector(new TextCursor('[名前|item]'))).toThrow('Unsupported namespace prefix');
    expect(() => parseAttributeSelector(new TextCursor(String.raw`[foo\+bar|item]`))).toThrow('Unsupported namespace prefix');
    expect(() => parseAttributeSelector(new TextCursor(String.raw`[foo\:bar|item]`))).toThrow('Unsupported namespace prefix');
    expect(() => parseAttributeSelector(new TextCursor(String.raw`[\31 23|item]`))).toThrow('Unsupported namespace prefix');
  });
});

describe('parsePseudoTestSource continuation boundaries', () => {
  it('continues after no-arg pseudo-classes', () => {
    for (const input of ['div:scope.item', 'div:first-child.foo', 'div:only-of-type + span', 'a:any-link.foo', 'input:enabled.foo', 'input:read-only + input', 'input:checked.foo', 'input:out-of-range + label', 'video:playing.foo', 'video:volume-locked + video']) {
      const complex = parseComplexSelector(new TextCursor(input), {});
      expect(complex.parts[0].compound.tests.length).toBeGreaterThan(0);
    }
  });

  it('continues after functional pseudo-classes', () => {
    for (const input of ['div:nth-child(2n+1).item', 'div:nth-last-of-type(odd) > span', 'div:lang(en).item', 'div:dir(rtl) > span']) {
      const complex = parseComplexSelector(new TextCursor(input), {});
      expect(complex.parts[0].compound.tests.length).toBeGreaterThan(0);
    }
  });

  it('continues after logical pseudo-classes followed by functional pseudos', () => {
    for (const input of ['div:is(.a):nth-child(2n+1)', 'div:not(.a):nth-of-type(2)', 'div:has(> .a):not(.disabled)', 'div:where(.a):lang(en)', 'div:is(.a):has(+ .b)']) {
      const compound = parseCompoundSelector(new TextCursor(input), {});
      expect(compound.tag).toMatchObject({ localRaw: 'div' });
      expect(compound.tests.length).toBe(2);
    }
  });

  it('handles nested logical pseudo-classes before following functional pseudos', () => {
    for (const input of ['div:is(:not(.a), .b):nth-child(2n+1)', 'div:where(:has(> .a)):lang(en)', 'div:not(:is(.a, .b)):nth-of-type(2)', 'div:has(:not(.disabled)):has(+ .item)']) {
      const compound = parseCompoundSelector(new TextCursor(input), {});
      expect(compound.tag).toMatchObject({ localRaw: 'div' });
      expect(compound.tests.length).toBe(2);
    }
  });
});

describe('parseCompoundSelector continuation edge cases', () => {
  it('continues after id, class, tag, attrs, and no-match pseudos', () => {
    let c = parseCompoundSelector(new TextCursor(String.raw`#foo\:bar.item`), {});
    expect(c.id?.raw).toBe(String.raw`foo\:bar`); expect(c.classes?.map((x) => x.raw)).toEqual(['item']);

    c = parseCompoundSelector(new TextCursor(String.raw`.foo\+bar`), {});
    expect(c.classes?.map((x) => x.raw)).toEqual([String.raw`foo\+bar`]);

    c = parseCompoundSelector(new TextCursor('foo-bar[attr]'), {});
    expect(c.tag).toMatchObject({ localRaw: 'foo-bar' }); expect(c.tests.length).toBe(1);

    c = parseCompoundSelector(new TextCursor('föo.item'), {});
    expect(c.tag).toMatchObject({ localRaw: 'föo' }); expect(c.classes?.map((x) => x.raw)).toEqual(['item']);

    c = parseCompoundSelector(new TextCursor(':autofill.foo'), {});
    expect(c.tests.length).toBe(1); expect(c.classes?.map((x) => x.raw)).toEqual(['foo']);

    c = parseCompoundSelector(new TextCursor('::before.foo'), {});
    expect(c.tests.length).toBe(1); expect(c.classes?.map((x) => x.raw)).toEqual(['foo']);
  });
});

describe('parseAttributeSelector legacy edge cases', () => {
  it('parses escaped attr names and adjacent flags', () => {
    expect(parseAttributeSelector(new TextCursor(String.raw`[foo\:bar]`))).toEqual({ localRaw: String.raw`foo\:bar` });
    expect(parseAttributeSelector(new TextCursor("[foo='bar'i]"))).toEqual({ localRaw: 'foo', op: '=', valueRaw: 'bar', flag: 'i' });
    expect(parseAttributeSelector(new TextCursor(String.raw`[foo='bar'\i]`))).toEqual({ localRaw: 'foo', op: '=', valueRaw: 'bar', flag: 'i' });
    expect(parseAttributeSelector(new TextCursor(String.raw`[foo='bar'\69]`))).toEqual({ localRaw: 'foo', op: '=', valueRaw: 'bar', flag: 'i' });
  });

  it('does not misparse ~= values with spaces as selector flags', () => {
    expect(parseAttributeSelector(new TextCursor('[class~=brothers]'))).toEqual({ localRaw: 'class', op: '~=', valueRaw: 'brothers' });
    // expect(() => parseAttributeSelector(new Cursor('[class~=brother s]'))).toThrow('Invalid attribute selector flag');
    expect(parseAttributeSelector(new TextCursor('[class~=brother s]'))).toEqual({ localRaw: 'class', op: '~=', valueRaw: 'brother', flag: 's' });
  });
});

describe('parse logical pseudo nesting and continuation', () => {
  it('parses empty forgiving is/where pseudos', () => {
    for (const input of [':is()', ':where()']) {
      const c = parseCompoundSelector(new TextCursor(input), {});
      expect(c.tests.length).toBe(1);
    }
  });

  it('parses empty forgiving is/where selector lists', () => {
    for (const input of [':is()', ':where()']) {
      const list = parseSelectorList(input, {});
      expect(list.arms).toHaveLength(1);
      expect(list.arms[0].parts[0].compound.tests.length).toBe(1);
    }
  });

  it('rejects empty non-forgiving functional pseudos', () => {
    for (const input of [':not()', ':has()']) {
      expect(() => parseSelectorList(input, {})).toThrow();
    }
  });

  it('parses nested logical selectors followed by functional pseudos', () => {
    for (const input of [
      ':is(:not(.a), .b):nth-child(2n+1)',
      ':where(:has(> .a)):lang(en)',
      ':not(:is(.a, .b)):nth-of-type(2)',
      ':has(:not(.disabled)):has(+ .item)',
    ]) {
      const c = parseCompoundSelector(new TextCursor(input), {});
      expect(c.tests.length).toBe(2);
    }
  });

  it('parses top-level commas around nested logical pseudos', () => {
    let list = parseSelectorList(':is(:not(.a), .b):nth-child(2n+1), .fallback', {});
    expect(list.arms).toHaveLength(2);
    expect(list.arms[0].parts[0].compound.tests.length).toBe(2);
    expect(list.arms[1].parts[0].compound.classes?.map((c) => c.raw)).toEqual(['fallback']);

    list = parseSelectorList(':not(:is(.a, .b)):nth-of-type(2), span', {});
    expect(list.arms).toHaveLength(2);
    expect(list.arms[0].parts[0].compound.tests.length).toBe(2);
    expect(list.arms[1].parts[0].compound.tag).toMatchObject({ localRaw: 'span' });
  });
});

describe('consumeIdent escaped syntax boundaries', () => {
  it('keeps escaped selector syntax inside identifiers', () => {
    let c = new TextCursor(String.raw`foo\.bar#id`);
    expect(consumeIdent(c)).toBe(String.raw`foo\.bar`);
    expect(c.peek()).toBe('#');

    c = new TextCursor(String.raw`foo\#bar.item`);
    expect(consumeIdent(c)).toBe(String.raw`foo\#bar`);
    expect(c.peek()).toBe('.');

    c = new TextCursor(String.raw`foo\[bar\].item`);
    expect(consumeIdent(c)).toBe(String.raw`foo\[bar\]`);
    expect(c.peek()).toBe('.');
  });
});

describe('parseSelectorList common validator cases', () => {
  it('accepts common selector forms', () => {
    let list = parseSelectorList('div', {});
    expect(list.arms).toHaveLength(1);
    expect(list.arms[0].parts[0].compound.tag).toMatchObject({ localRaw: 'div' });

    list = parseSelectorList('div.item#id', {});
    expect(list.arms[0].parts[0].compound.tag).toMatchObject({ localRaw: 'div' });
    expect(list.arms[0].parts[0].compound.classes?.map((c) => c.raw)).toEqual(['item']);
    expect(list.arms[0].parts[0].compound.id?.raw).toBe('id');

    list = parseSelectorList('[data-x="a, b"]', {});
    expect(list.arms[0].parts[0].compound.tests.length).toBe(1);

    list = parseSelectorList('div > span + a ~ em', {});
    expect(list.arms[0].parts.map((p) => p.combinator)).toEqual([null, '>', '+', '~']);
    expect(list.arms[0].parts.map((p) => p.compound.tag?.localRaw)).toEqual(['div', 'span', 'a', 'em']);
  });

  it('accepts logical, relative, and structural pseudo selectors', () => {
    for (const input of [':is(.a, .b)', ':not(.disabled)', ':has(+ .item)', ':nth-child(2n + 1)']) {
      const compound = parseSelectorList(input, {}).arms[0].parts[0].compound;
      expect(compound.tests.length).toBe(1);
    }

    expect(parseNthArgs(new TextCursor('(2n + 1)'))).toEqual({ step: 2, offset: 1 });
  });

  it('splits only top-level selector groups after validation', () => {
    let list = parseSelectorList('div, span', {});
    expect(list.arms).toHaveLength(2);
    expect(list.arms[0].parts[0].compound.tag).toMatchObject({ localRaw: 'div' });
    expect(list.arms[1].parts[0].compound.tag).toMatchObject({ localRaw: 'span' });

    list = parseSelectorList(':is(:not(.a), .b):nth-child(2n+1), span', {});
    expect(list.arms).toHaveLength(2);
    expect(list.arms[0].parts[0].compound.tests.length).toBe(2);
    expect(list.arms[1].parts[0].compound.tag).toMatchObject({ localRaw: 'span' });
  });

  it('rejects empty and trailing-comma selectors', () => {
    expect(() => parseSelectorList('', {})).toThrow('Expected selector');
    expect(() => parseSelectorList('div,', {})).toThrow('Expected selector after comma');
  });

  it('rejects malformed combinator placement', () => {
    expect(() => parseSelectorList('> div', {})).toThrow('Expected compound selector');
    expect(() => parseSelectorList('div >> span', {})).toThrow('Expected compound selector after combinator');
    expect(() => parseSelectorList('div + > span', {})).toThrow('Expected compound selector after combinator');
  });
});

describe('parse functional pseudo namespace and combinator cases', () => {
  it('accepts supported namespace type selectors inside functional pseudos', () => {
    for (const input of [':is(*|item)', ':is(|item)', ':has(> *|item)']) {
      const compound = parseSelectorList(input, {}).arms[0].parts[0].compound;
      expect(compound.tests.length).toBe(1);
    }
  });

  it('forgivingly accepts named namespace type selectors inside :is and :where', () => {
    for (const input of [':is(test|item)', ':where(test|item)']) {
      const compound = parseSelectorList(input, {}).arms[0].parts[0].compound;
      expect(compound.tests.length).toBe(1);
    }
  });

  it('rejects named namespace type selectors in strict and :has contexts', () => {
    expect(() => parseSelectorList('test|item', {})).toThrow('Unsupported namespace prefix');
    expect(() => parseSelectorList(':has(> test|item)', {})).toThrow('Unsupported namespace prefix');
  });

  it('accepts explicit combinators inside relative functional pseudos', () => {
    for (const input of [':has(> h1)', ':has(>h1)', ':has(+ .item)', ':has(~ .item)']) {
      const compound = parseSelectorList(input, {}).arms[0].parts[0].compound;
      expect(compound.tests.length).toBe(1);
    }
  });
});

describe('parseSelectorList validator edge cases', () => {
  it('validates nested logical selectors inside functional pseudos', () => {
    for (const input of [':is(:where(:not(.a, .b)), .c)', ':has(:is(.a, .b):not(.c))']) {
      const compound = parseSelectorList(input, {}).arms[0].parts[0].compound;
      expect(compound.tests.length).toBe(1);
    }
  });

  it('rejects raw colon in attribute names and accepts escaped colon', () => {
    expect(() => parseSelectorList('[foo:bar]', {})).toThrow();
    expect(parseAttributeSelector(new TextCursor(String.raw`[foo\:bar]`))).toEqual({ localRaw: String.raw`foo\:bar` });
  });

  it('accepts supported namespace attribute syntax and rejects named prefixes for now', () => {
    expect(parseAttributeSelector(new TextCursor('[*|href]'))).toEqual({ prefixRaw: '*', localRaw: 'href' });
    expect(parseAttributeSelector(new TextCursor('[|href]'))).toEqual({ prefixRaw: '', localRaw: 'href' });
    expect(() => parseAttributeSelector(new TextCursor('[xlink|href]'))).toThrow('Unsupported namespace prefix');

    expect(parseAttributeSelector(new TextCursor('[lang]'))).toEqual({ localRaw: 'lang' });
    expect(parseAttributeSelector(new TextCursor('[*|lang]'))).toEqual({ prefixRaw: '*', localRaw: 'lang' });
    expect(parseAttributeSelector(new TextCursor('[|lang]'))).toEqual({ prefixRaw: '', localRaw: 'lang' });
    expect(() => parseAttributeSelector(new TextCursor('[xml|lang]'))).toThrow('Unsupported namespace prefix');
  });

  it('validates nth pseudo-class formulas with signed offsets', () => {
    expect(parseNthArgs(new TextCursor('(n-128)'))).toEqual({ step: 1, offset: -128 });
    expect(parseNthArgs(new TextCursor('(n+10)'))).toEqual({ step: 1, offset: 10 });
    expect(parseNthArgs(new TextCursor('(4n+100)'))).toEqual({ step: 4, offset: 100 });
    expect(parseNthArgs(new TextCursor('(-n+3)'))).toEqual({ step: -1, offset: 3 });

    for (const input of ['ul > li:nth-child(n-128)', '#t > *:nth-child(n+10)', ':nth-child(4n+100)', ':nth-child(-n+3)']) {
      expect(parseSelectorList(input, {}).arms[0].parts.at(-1)?.compound.tests.length).toBeGreaterThan(0);
    }
  });

  it('rejects unquoted numeric attribute selector values', () => {
    expect(() => parseSelectorList('#level1 *[id*=2]', {})).toThrow('Expected identifier');
    expect(() => parseSelectorList('[id=2]', {})).toThrow('Expected identifier');
    expect(() => parseSelectorList('[data-x^=123]', {})).toThrow('Expected identifier');
  });

  it('rejects raw digit-start class and id selectors', () => {
    for (const input of ['.5cm', '#x .5cm', '#5cm', 'div .5cm', 'div#5cm']) {
      expect(() => parseSelectorList(input, {})).toThrow('Expected identifier');
    }
  });

  it('accepts escaped digit-start class and id selectors', () => {
    let c = parseCompoundSelector(new TextCursor(String.raw`.\35 cm`), {});
    expect(c.classes?.map((x) => x.raw)).toEqual([String.raw`\35 cm`]);

    c = parseCompoundSelector(new TextCursor(String.raw`#\35 cm`), {});
    expect(c.id?.raw).toBe(String.raw`\35 cm`);
  });
});

describe('parseSelectorList validator compound and attribute edge cases', () => {
  it('rejects universal local names in attribute selectors', () => {
    expect(() => parseAttributeSelector(new TextCursor('[*|*]'))).toThrow('Expected identifier');
    expect(() => parseAttributeSelector(new TextCursor('[|*]'))).toThrow('Expected identifier');
  });

  it('validates compound :scope selectors', () => {
    let list = parseSelectorList('div:scope > *', {});
    expect(list.arms[0].parts.map((p) => p.combinator)).toEqual([null, '>']);
    expect(list.arms[0].parts[0].compound.tag).toMatchObject({ localRaw: 'div' });
    expect(list.arms[0].parts[0].compound.tests.length).toBe(1);
    expect(list.arms[0].parts[1].compound.tag).toMatchObject({ localRaw: '*' });

    list = parseSelectorList(':scope > *', {});
    expect(list.arms[0].parts.map((p) => p.combinator)).toEqual([null, '>']);
    expect(list.arms[0].parts[0].compound.tests.length).toBe(1);
    expect(list.arms[0].parts[1].compound.tag).toMatchObject({ localRaw: '*' });
  });

  it('accepts missing right bracket at EOF for attribute selectors', () => {
    let list = parseSelectorList('meta[charset="utf-8"', {});
    expect(list.arms[0].parts[0].compound.tag).toMatchObject({ localRaw: 'meta' });
    expect(list.arms[0].parts[0].compound.tests.length).toBe(1);

    list = parseSelectorList('#attr-value [align="center"', {});
    expect(list.arms[0].parts.map((p) => p.combinator)).toEqual([null, ' ']);
    expect(list.arms[0].parts[0].compound.id?.raw).toBe('attr-value');
    expect(list.arms[0].parts[1].compound.tests.length).toBe(1);
  });

  it('rejects invalid unquoted attribute values', () => {
    expect(() => parseSelectorList('[id*=2]', {})).toThrow('Expected identifier');
    expect(() => parseSelectorList('a[href=#]', {})).toThrow('Expected identifier');
    expect(() => parseSelectorList('[class= space unquoted ]', {})).toThrow();
    expect(() => parseSelectorList('.blox23s1[foo="blox" erroneous]', {})).toThrow();
  });

  it('accepts universal selectors inside functional pseudos', () => {
    const compound = parseSelectorList(':not(*)', {}).arms[0].parts[0].compound;
    expect(compound.tests.length).toBe(1);
  });

  it('rejects type selectors after subclass selectors in a compound', () => {
    for (const input of ["[foo='bar']i", '[foo]div', '[foo]*', '.foo div[attr]span', '#foo span[attr]div', '.foo)', '[foo])', '[foo i]']) {
      expect(() => parseSelectorList(input, {})).toThrow();
    }
  });

  it('accepts subclass selectors after type selectors and combinators', () => {
    let c = parseSelectorList('div[foo]', {}).arms[0].parts[0].compound;
    expect(c.tag).toMatchObject({ localRaw: 'div' }); expect(c.tests.length).toBe(1);

    c = parseSelectorList('[foo].bar', {}).arms[0].parts[0].compound;
    expect(c.tests.length).toBe(1); expect(c.classes?.map((x) => x.raw)).toEqual(['bar']);

    c = parseSelectorList('[foo]#bar', {}).arms[0].parts[0].compound;
    expect(c.tests.length).toBe(1); expect(c.id?.raw).toBe('bar');

    c = parseSelectorList('[foo]:empty', {}).arms[0].parts[0].compound;
    expect(c.tests.length).toBe(2);

    let list = parseSelectorList('[foo] [bar]', {});
    expect(list.arms[0].parts.map((p) => p.combinator)).toEqual([null, ' ']);
    expect(list.arms[0].parts.every((p) => p.compound.tests.length === 1)).toBe(true);

    list = parseSelectorList('[foo] > i', {});
    expect(list.arms[0].parts.map((p) => p.combinator)).toEqual([null, '>']);
    expect(list.arms[0].parts[1].compound.tag).toMatchObject({ localRaw: 'i' });

    list = parseSelectorList('[foo], i', {});
    expect(list.arms).toHaveLength(2);
    expect(list.arms[0].parts[0].compound.tests.length).toBe(1);
    expect(list.arms[1].parts[0].compound.tag).toMatchObject({ localRaw: 'i' });
  });

  it('handles parentheses in compound selectors', () => {
    for (const input of ["[foo='bar']i", '[foo]div', '.foo)']) {
      expect(() => parseSelectorList(input, {})).toThrow();
    }

    for (const input of [':is(.a)', ':is(.a,.b)', ':is([data-x])', ':is(:not(.a), .b)']) {
      const compound = parseSelectorList(input, {}).arms[0].parts[0].compound;
      expect(compound.tests.length).toBe(1);
    }
  });
});

describe('parse attribute selector case-sensitivity flag syntax', () => {
  it('accepts valid attribute selector case flags, comments, and whitespace', () => {
    for (const input of [
      "[foo='BAR'] /* sanity check (valid) */",
      "[foo='bar' i]",
      "[foo='bar' I]",
      '[foo=bar i]',
      '[foo="bar" i]',
      "[foo='bar'i]",
      "[foo='bar'i ]",
      "[foo='bar' i ]",
      "[foo='bar' /**/ i]",
      "[foo='bar' i /**/ ]",
      "[foo='bar'/**/i/**/]",
      '[foo=bar/**/i]',
      "[foo='bar'\ti\t] /* \\t */",
      "[foo='bar'\ni\n] /* \\n */",
      "[foo='bar'\ri\r] /* \\r */",
      String.raw`[foo='bar' \i]`,
      String.raw`[foo='bar' \69]`,
      "[foo~='bar' i]",
      "[foo^='bar' i]",
      "[foo$='bar' i]",
      "[foo*='bar' i]",
      "[foo|='bar' i]",
      "[|foo='bar' i]",
      "[*|foo='bar' i]",
      'div[class~=brothers]',
    ]) {
      expect(() => parseSelectorList(input, {})).not.toThrow();
    }
  });
});

describe('parseAttributeSelector invalid case-sensitivity flag syntax', () => {
  it('rejects invalid attribute selector case flag syntax', () => {
    for (const input of [
      '[foo[ /* sanity check (invalid) */',
      "[foo='bar' i i]",
      "[foo i ='bar']",
      "[foo= i 'bar']",
      "[i foo='bar']",
      "[foo='bar' i\u0000] /* \\0 */",
      "[foo='bar' \u0130]",
      "[foo='bar' \u0131]",
      "[foo='bar' ii]",
      "[foo='bar' ij]",
      "[foo='bar' j]",
      "[foo='bar' \\\\i]",
      "[foo='bar' \\\\69]",
      "[foo='bar' i()]",
      "[foo='bar' i ()]",
      "[foo='bar' () i]",
      "[foo='bar' (i)]",
      "[foo='bar' i []]",
      "[foo='bar' [] i]",
      "[foo='bar' [i]]",
      "[foo='bar' i {}]",
      "[foo='bar' {} i]",
      "[foo='bar' {i}]",
      "[foo='bar' 1i]",
      "[foo='bar' 1]",
      "[foo='bar' 'i']",
      "[foo='bar' url(i)]",
      "[foo='bar' ,i]",
      "[foo='bar' i,]",
      "[foo='bar']i",
      "[foo='bar' |i]",
      "[foo='bar' \\|i]",
      "[foo='bar' *|i]",
      "[foo='bar' \\*|i]",
      "[foo='bar' *]",
      "[foo='bar' \\*]",
      '[foo i]',
      '[foo/**/i]',
    ]) {
      expect(() => parseSelectorList(input, {})).toThrow();
    }
  });
});

describe('parseSelectorList whitespace and common selector cases', () => {
  it('treats vertical whitespace as descendant combinators', () => {
    for (const input of ['div\nspan', 'div\r\nspan', 'div\fspan']) {
      const list = parseSelectorList(input, {});
      expect(list.arms).toHaveLength(1);
      expect(list.arms[0].parts.map((p) => p.combinator)).toEqual([null, ' ']);
      expect(list.arms[0].parts.map((p) => p.compound.tag?.localRaw)).toEqual(['div', 'span']);
    }
  });

  it('splits comma groups with surrounding whitespace', () => {
    const list = parseSelectorList('div , span', {});
    expect(list.arms).toHaveLength(2);
    expect(list.arms[0].parts[0].compound.tag).toMatchObject({ localRaw: 'div' });
    expect(list.arms[1].parts[0].compound.tag).toMatchObject({ localRaw: 'span' });
  });

  it('accepts common selector forms through parseSelectorList', () => {
    for (const input of ['div', 'div p', 'div > p', '[data-nwsapi-scope] > p', '*|p', '|p', ':scope > *|item', '[data-nwsapi-scope] > *|item', '[data-nwsapi-scope] > |item']) {
      expect(() => parseSelectorList(input, {})).not.toThrow();
    }
  });
});

describe('parseNthArgs formula grammar', () => {
  it('parses valid nth pseudo-class formulas', () => {
    const valid: Array<[string, { step: number; offset: number; }]> = [
      ['(1)', { step: 0, offset: 1 }], ['(+1)', { step: 0, offset: 1 }], ['(-1)', { step: 0, offset: -1 }],
      ['(n)', { step: 1, offset: 0 }], ['(+n)', { step: 1, offset: 0 }], ['(-n)', { step: -1, offset: 0 }],
      ['(2n)', { step: 2, offset: 0 }], ['(+2n)', { step: 2, offset: 0 }], ['(-2n)', { step: -2, offset: 0 }],
      ['(n+1)', { step: 1, offset: 1 }], ['(n-1)', { step: 1, offset: -1 }],
      ['(2n+1)', { step: 2, offset: 1 }], ['(2n-1)', { step: 2, offset: -1 }],
      ['(0n+2)', { step: 0, offset: 2 }], ['(+0n+2)', { step: 0, offset: 2 }], ['(-0n+2)', { step: 0, offset: 2 }],
      ['(even)', { step: 2, offset: 0 }], ['(odd)', { step: 2, offset: 1 }],
      ['(EVEN)', { step: 2, offset: 0 }], ['(ODD)', { step: 2, offset: 1 }],
    ];

    for (const [input, expected] of valid) {
      expect(parseNthArgs(new TextCursor(input))).toEqual(expected);
    }

    for (const input of [':nth-last-child(2n+1)', ':nth-of-type(2n+1)', ':nth-last-of-type(2n+1)']) {
      expect(parseSelectorList(input, {}).arms[0].parts[0].compound.tests.length).toBe(1);
    }
  });

  it('rejects invalid nth pseudo-class formulas', () => {
    for (const input of ['()', '( )', '(n1)', '(2n0)', '(2n1)', '(1n2)', '(1+n)', '(1+2n)', '(foo)', '(2nn+1)']) {
      expect(() => parseNthArgs(new TextCursor(input))).toThrow();
    }
  });
});

describe('parseSelectorList functional pseudo bodies', () => {
  it('validates shallow functional pseudo selector lists', () => {
    for (const input of [':is(.a, .b)', ':where(.a, .b)', ':not(.disabled)', ':has(+ .item)', ':has(> h1)', ':has(> *|item)']) {
      expect(() => parseSelectorList(input, {})).not.toThrow();
    }
  });

  it('validates nested functional pseudo selector lists', () => {
    for (const input of [':is(:not(.a), .b)', ':is(:where(.a), .b)', ':is(:where(:not(.a, .b)), .c)', ':has(:is(.a, .b):not(.c))']) {
      expect(() => parseSelectorList(input, {})).not.toThrow();
    }
  });

  it('validates chained pseudos after functional pseudo bodies', () => {
    for (const input of [
      ':is(.a, .b):nth-child(2n)',
      ':is(.a, .b):nth-child(2n+1)',
      ':is(:not(.a), .b):nth-child(2n+1)',
      ':has(> .item):not(.disabled)',
      ':where(.a, .b):is(.c, .d):nth-child(odd)',
    ]) {
      expect(() => parseSelectorList(input, {})).not.toThrow();
    }
  });

  it('validates nested functional pseudos without nth formulas', () => {
    for (const input of [
      ':is(:not(.a), .b)',
      ':is(:where(.a), .b)',
      ':where(:not(.a), .b)',
      ':not(:is(.a, .b))',
      ':has(:is(.a, .b))',
      ':has(:is(.a, .b):not(.c))',
      ':is(:where(:not(.a, .b)), .c)',
    ]) {
      expect(() => parseSelectorList(input, {})).not.toThrow();
    }
  });
});

describe('parseSelectorList nth formulas after functional pseudos', () => {
  it('keeps nth functions strict inside chained functional pseudo selectors', () => {
    expect(() => parseSelectorList(':is(.a, .b):nth-child(2n+1)', {})).not.toThrow();

    for (const input of [':is(.a, .b):nth-child(2n1)', ':is(.a, .b):nth-child(n1)', ':is(.a, .b):nth-child()', ':is(.a, .b):nth-child(1+n)']) {
      expect(() => parseSelectorList(input, {})).toThrow();
    }
  });
});

describe('parseSelectorList chained and scoped functional pseudos', () => {
  it('validates chained functional pseudos without nth formulas', () => {
    for (const input of [
      ':is(.a, .b):not(.c)',
      ':where(.a, .b):is(.c, .d)',
      ':has(> .item):not(.disabled)',
      ':has(+ .item):where(.enabled, .selected)',
      ':not(.a):not(.b):is(.c, .d)',
    ]) {
      expect(() => parseSelectorList(input, {})).not.toThrow();
    }
  });

  it('validates non-nth content inside functional pseudos', () => {
    for (const input of [
      ':is([data-x="a, b"], .c)',
      ':has([data-x="a, b"])',
      ':has(> [data-x="a, b"])',
      ':is(*|item, |item, test|item)',
      ':has(> *|item, + |item)',
    ]) {
      expect(() => parseSelectorList(input, {})).not.toThrow();
    }
  });

  it('accepts EOF-tolerant malformed functional pseudo bodies for now', () => {
    expect(() => parseSelectorList(':is(.a, .b', {})).not.toThrow();
  });

  it('rejects malformed generic functional pseudo bodies', () => {
    for (const input of [':has(> )', ':has(+ )', ':not()']) {
      expect(() => parseSelectorList(input, {})).toThrow();
    }

    for (const input of [':is()', ':where()', ':is(,)', ':where(,)', ':is(.a,, .b)', ':where(.a,, .b)']) {
      expect(() => parseSelectorList(input, {})).not.toThrow();
    }
  });

  it('validates scoped relative selectors inside functional pseudos', () => {
    for (const input of [
      ':is(:scope > .item)',
      ':is(:scope > .item, .alt)',
      ':where(:scope > .item)',
      ':not(:scope > .disabled)',
    ]) {
      expect(() => parseSelectorList(input, {})).not.toThrow();
    }
  });

  it('validates compact scoped relative selectors inside functional pseudos', () => {
    for (const input of [':is(:scope>.item)', ':is(:scope+.item)', ':is(:scope~.item)']) {
      expect(() => parseSelectorList(input, {})).not.toThrow();
    }
  });
});

describe('parseSelectorList namespace selector oracle cases', () => {
  it('accepts supported namespace type selectors', () => {
    for (const input of ['*|p', '|p', ':scope > *|item', '[data-nwsapi-scope] > *|item', '[data-nwsapi-scope] > |item']) {
      expect(() => parseSelectorList(input, {})).not.toThrow();
    }
  });

  it('rejects bare unresolvable named namespace type selectors', () => {
    for (const input of ['test|p', ':scope > test|item', '[data-nwsapi-scope] > test|item']) {
      expect(() => parseSelectorList(input, {})).toThrow('Unsupported namespace prefix');
    }
  });

  it('accepts forgiving namespace arms inside :is and :where', () => {
    for (const input of [
      ':is(*|item)',
      ':is(|item)',
      ':is(test|item)',
      ':is(*|item, |item, test|item)',
      ':where(*|item)',
      ':where(|item)',
      ':where(test|item)',
      ':where(*|item, |item, test|item)',
    ]) {
      expect(() => parseSelectorList(input, {})).not.toThrow();
    }
  });

  it('keeps :has relative selector lists strict for named namespace prefixes', () => {
    for (const input of [':has(> test|item)', ':has(> *|item, > test|item)']) {
      expect(() => parseSelectorList(input, {})).toThrow('Unsupported namespace prefix');
    }

    for (const input of [':has(> *|item)', ':has(> |item)', ':has(> *|item, + |item)']) {
      expect(() => parseSelectorList(input, {})).not.toThrow();
    }
  });

  it('accepts supported namespace attribute selectors and rejects named prefixes', () => {
    for (const input of ["[foo|='bar' i]", "[|foo='bar' i]", "[*|foo='bar' i]", '[*|href]', '[|href]']) {
      expect(() => parseSelectorList(input, {})).not.toThrow();
    }

    for (const input of ['[xlink|href]', '[xml|lang]']) {
      expect(() => parseSelectorList(input, {})).toThrow('Unsupported namespace prefix');
    }
  });

  it('rejects universal local names in attribute selectors', () => {
    for (const input of ['[*|*]', '[|*]']) {
      expect(() => parseSelectorList(input, {})).toThrow();
    }
  });
});

describe('parseForgivingPseudoBodySelectorList', () => {
  it('drops invalid namespace arms but keeps valid arms', () => {
    const list = parseForgivingSelectorList(new TextCursor('(*|item, |item, test|item)'), {});
    expect(list.arms).toHaveLength(2);
    expect(list.arms[0].parts[0].compound.tag).toMatchObject({ prefixRaw: '*', localRaw: 'item' });
    expect(list.arms[1].parts[0].compound.tag).toMatchObject({ prefixRaw: '', localRaw: 'item' });
  });

  it('allows all arms to be invalid as a valid no-match forgiving list', () => {
    const list = parseForgivingSelectorList(new TextCursor('(test|item)'), {});
    expect(list.arms).toHaveLength(0);
  });

  it('accepts empty or syntactically empty forgiving lists', () => {
    expect(parseForgivingSelectorList(new TextCursor('()'), {}).arms).toHaveLength(0);
    expect(parseForgivingSelectorList(new TextCursor('(,)'), {}).arms).toHaveLength(0);
    expect(parseForgivingSelectorList(new TextCursor('(.a,, .b)'), {}).arms).toHaveLength(2);
  });
});

describe('parseSelectorList functional pseudo spacing and nested nth cases', () => {
  it('validates spaced combinators inside functional pseudos', () => {
    for (const input of [':is(.a > .b)', ':is(.a + .b)', ':is(.a ~ .b)', ':has(.a > .b)']) {
      const c = parseSelectorList(input, {}).arms[0].parts[0].compound;
      expect(c.tests.length).toBe(1);
    }
  });

  it('validates whitespace around non-combinator tokens inside functional pseudos', () => {
    for (const input of [
      ':is( .a)', ':is(.a )', ':is( .a )',
      ':is( [data-x="a, b"])', ':is([data-x="a, b"] )', ':is( [data-x="a, b"] )',
      ':is( *|item)', ':is(*|item )', ':is( *|item )',
    ]) {
      const c = parseSelectorList(input, {}).arms[0].parts[0].compound;
      expect(c.tests.length).toBe(1);
    }
  });

  it('validates whitespace around commas inside functional pseudos', () => {
    for (const input of [':is(.a,.b)', ':is(.a, .b)', ':is(.a , .b)', ':is(.a , .b )']) {
      const c = parseSelectorList(input, {}).arms[0].parts[0].compound;
      expect(c.tests.length).toBe(1);
    }
  });

  it('keeps quoted commas inside attribute selectors opaque in functional pseudos', () => {
    for (const input of [':is([data-x="a, b"])', ':is([data-x="a, b"], .c)', ':has(> [data-x="a, b"])']) {
      const c = parseSelectorList(input, {}).arms[0].parts[0].compound;
      expect(c.tests.length).toBe(1);
    }
  });

  it('validates simple attributes inside functional pseudos', () => {
    for (const input of [':is([data-x])', ':is([data-x=value])', ':is(.a[data-x=value])']) {
      const c = parseSelectorList(input, {}).arms[0].parts[0].compound;
      expect(c.tests.length).toBe(1);
    }
  });

  it('validates nested nth pseudo-classes inside functional pseudos', () => {
    for (const input of [
      ':not(:nth-child(1))',
      ':not(:nth-child(n))',
      ':not(:nth-child(-n+3))',
      ':not(:nth-of-type(1))',
      ':not(:nth-of-type(n))',
      ':not(:nth-last-child(1))',
      ':not(:nth-last-of-type(1))',
    ]) {
      const c = parseSelectorList(input, {}).arms[0].parts[0].compound;
      expect(c.tests.length).toBe(1);
    }
  });

  it('validates nested nth pseudo-classes inside functional pseudos with selector context', () => {
    let list = parseSelectorList('p:not(:nth-child(1))', {});
    expect(list.arms[0].parts[0].compound.tag).toMatchObject({ localRaw: 'p' });
    expect(list.arms[0].parts[0].compound.tests.length).toBe(1);

    list = parseSelectorList('div:not(:nth-child(n))', {});
    expect(list.arms[0].parts[0].compound.tag).toMatchObject({ localRaw: 'div' });
    expect(list.arms[0].parts[0].compound.tests.length).toBe(1);

    list = parseSelectorList('div:not(:nth-of-type(n))', {});
    expect(list.arms[0].parts[0].compound.tag).toMatchObject({ localRaw: 'div' });
    expect(list.arms[0].parts[0].compound.tests.length).toBe(1);

    list = parseSelectorList('#p a:not(:nth-of-type(1))', {});
    expect(list.arms[0].parts.map((p) => p.combinator)).toEqual([null, ' ']);
    expect(list.arms[0].parts[0].compound.id?.raw).toBe('p');
    expect(list.arms[0].parts[1].compound.tag).toMatchObject({ localRaw: 'a' });
    expect(list.arms[0].parts[1].compound.tests.length).toBe(1);

    list = parseSelectorList(`#form option:not([id^='opt']:nth-child(-n+3))`, {});
    expect(list.arms[0].parts.map((p) => p.combinator)).toEqual([null, ' ']);
    expect(list.arms[0].parts[0].compound.id?.raw).toBe('form');
    expect(list.arms[0].parts[1].compound.tag).toMatchObject({ localRaw: 'option' });
    expect(list.arms[0].parts[1].compound.tests.length).toBe(1);
  });

  it('does not let nested invalid nth pseudo-classes escape strict validation', () => {
    for (const input of [':not(:nth-child(n1))', ':not(:nth-child(2n1))', 'p:not(:nth-of-type(1n2))']) {
      expect(() => parseSelectorList(input, {})).toThrow();
    }
  });
});

describe('parseSelectorList nested pseudo and attribute edge cases', () => {
  it('validates nested supported pseudo-class tokens inside functional pseudo bodies', () => {
    for (const input of [':not(:hover)', ':not(:first-child)', ':not(:nth-child(1))', ':is(:not(.a), .b)', ':not(:-webkit-autofill)']) {
      const c = parseSelectorList(input, {}).arms[0].parts[0].compound;
      expect(c.tests.length).toBe(1);
    }
  });

  it('rejects unknown nested pseudo-class tokens in strict :not bodies', () => {
    for (const input of [':not(:foo)', ':not(:foo-bar)']) {
      expect(() => parseSelectorList(input, {})).toThrow('Unsupported pseudo-class');
    }
  });

  it('validates nth pseudo-class formulas with signed offsets', () => {
    for (const input of ['ul > li:nth-child(n-128)', '#t > *:nth-child(n+10)', ':nth-child(4n+100)', ':nth-child(-n+3)']) {
      expect(() => parseSelectorList(input, {})).not.toThrow();
    }

    expect(parseNthArgs(new TextCursor('(n-128)'))).toEqual({ step: 1, offset: -128 });
    expect(parseNthArgs(new TextCursor('(n+10)'))).toEqual({ step: 1, offset: 10 });
    expect(parseNthArgs(new TextCursor('(4n+100)'))).toEqual({ step: 4, offset: 100 });
    expect(parseNthArgs(new TextCursor('(-n+3)'))).toEqual({ step: -1, offset: 3 });
  });

  it('rejects invalid top-level selector tokens', () => {
    for (const input of ['#level1 *[id*=2]', '.5cm']) {
      expect(() => parseSelectorList(input, {})).toThrow();
    }
  });

  it('parses quoted attribute values containing brackets', () => {
    expect(parseAttributeSelector(new TextCursor(`[name='types[]']`))).toEqual({ localRaw: 'name', op: '=', valueRaw: 'types[]' });
    expect(parseAttributeSelector(new TextCursor(`[name^='foo[']`))).toEqual({ localRaw: 'name', op: '^=', valueRaw: 'foo[' });
    expect(parseAttributeSelector(new TextCursor(`[name="brackets[5][]"]`))).toEqual({ localRaw: 'name', op: '=', valueRaw: 'brackets[5][]' });
  });

  it('parses :scope with selector suffixes', () => {
    const list = parseSelectorList(':scope > *', {});
    expect(list.arms[0].parts.map((p) => p.combinator)).toEqual([null, '>']);
    expect(list.arms[0].parts[0].compound.tests.length).toBe(1);
    expect(list.arms[0].parts[1].compound.tag).toMatchObject({ localRaw: '*' });

    const c = parseCompoundSelector(new TextCursor(':scope.item'), {});
    expect(c.tests.length).toBe(1);
    expect(c.classes?.map((x) => x.raw)).toEqual(['item']);
  });

  it('validates universal and namespace type selectors inside functional pseudos', () => {
    for (const input of [':not(*)', ':is(*)', ':is(*|item)', ':is(|item)', ':is(test|item)', ':is(*|*)']) {
      const c = parseSelectorList(input, {}).arms[0].parts[0].compound;
      expect(c.tests.length).toBe(1);
    }
  });
});

describe('consumeIdent source-fragment legacy cases', () => {
  it('accepts ordinary identifier names', () => {
    for (const input of ['div', 'foo', 'foo123', 'foo-bar', 'foo_bar', '_private', '-foo', '--foo']) {
      expect(consumeIdent(new TextCursor(input))).toBe(input);
    }
  });

  it('accepts non-ASCII and escaped identifier starts', () => {
    for (const input of ['é', 'éclair', String.raw`\35 cm`, String.raw`\31 23`, String.raw`\e9`, String.raw`\.`, String.raw`\+foo`]) {
      expect(consumeIdent(new TextCursor(input))).toBe(input);
    }
  });

  it('rejects raw identifiers that start with digits', () => {
    for (const input of ['5cm', '123', '1foo', '-5cm']) {
      expect(() => consumeIdent(new TextCursor(input))).toThrow();
    }
  });

  it('accepts digits after a valid identifier start', () => {
    for (const input of ['a5cm', '_123', '-a5cm', '--a5cm']) {
      expect(consumeIdent(new TextCursor(input))).toBe(input);
    }
  });

  it('rejects invalid identifier escape forms', () => {
    for (const input of ['\\\n', '\\\r', '\\\f']) {
      expect(() => consumeIdent(new TextCursor(input))).toThrow();
    }
  });

  it('accepts trailing EOF escape in identifiers', () => {
    expect(consumeIdent(new TextCursor('\\'))).toBe('\\');
    expect(consumeIdent(new TextCursor('foo\\'))).toBe('foo\\');
  });
});

describe('parseAttributeSelector value fragment legacy cases', () => {
  it('parses identifier and quoted attribute values', () => {
    expect(parseAttributeSelector(new TextCursor('[x=foo]'))).toEqual({ localRaw: 'x', op: '=', valueRaw: 'foo' });
    expect(parseAttributeSelector(new TextCursor('[x=foo-bar]'))).toEqual({ localRaw: 'x', op: '=', valueRaw: 'foo-bar' });
    expect(parseAttributeSelector(new TextCursor(`[x="foo"]`))).toEqual({ localRaw: 'x', op: '=', valueRaw: 'foo' });
    expect(parseAttributeSelector(new TextCursor(`[x='foo']`))).toEqual({ localRaw: 'x', op: '=', valueRaw: 'foo' });
    expect(parseAttributeSelector(new TextCursor(`[x="types[]"]`))).toEqual({ localRaw: 'x', op: '=', valueRaw: 'types[]' });
    expect(parseAttributeSelector(new TextCursor(`[x="brackets[5][]"]`))).toEqual({ localRaw: 'x', op: '=', valueRaw: 'brackets[5][]' });
    expect(parseAttributeSelector(new TextCursor(`[x='foo[']`))).toEqual({ localRaw: 'x', op: '=', valueRaw: 'foo[' });
  });

  it('parses escaped quotes inside quoted attribute values', () => {
    expect(parseAttributeSelector(new TextCursor(String.raw`[x="a\"b"]`))).toEqual({ localRaw: 'x', op: '=', valueRaw: String.raw`a\"b` });
    expect(parseAttributeSelector(new TextCursor(String.raw`[x='a\'b']`))).toEqual({ localRaw: 'x', op: '=', valueRaw: String.raw`a\'b` });
  });

  it('rejects raw numeric unquoted attribute values', () => {
    for (const input of ['[x=2]', '[x=123]']) {
      expect(() => parseAttributeSelector(new TextCursor(input))).toThrow('Expected identifier');
    }
  });
});

describe('parseNthArgs multi-digit signed offsets', () => {
  it('parses nth formulas with multi-digit signed offsets', () => {
    expect(parseNthArgs(new TextCursor('(n-128)'))).toEqual({ step: 1, offset: -128 });
    expect(parseNthArgs(new TextCursor('(n+10)'))).toEqual({ step: 1, offset: 10 });
    expect(parseNthArgs(new TextCursor('(4n+100)'))).toEqual({ step: 4, offset: 100 });
    expect(parseNthArgs(new TextCursor('(-n+12)'))).toEqual({ step: -1, offset: 12 });
  });

  it('continues correctly after nth pseudo selectors', () => {
    const c = parseCompoundSelector(new TextCursor(':nth-child(n-128).item'), {});
    expect(c.tests.length).toBe(1); expect(c.classes?.map((x) => x.raw)).toEqual(['item']);

    const list = parseSelectorList(':nth-child(n+10) > span', {});
    expect(list.arms[0].parts.map((p) => p.combinator)).toEqual([null, '>']);
    expect(list.arms[0].parts[0].compound.tests.length).toBe(1);
    expect(list.arms[0].parts[1].compound.tag).toMatchObject({ localRaw: 'span' });
  });
});

describe('parseAttributeSelector quoted bracket values and EOF bracket tolerance', () => {
  it('parses quoted attribute values containing brackets', () => {
    expect(parseAttributeSelector(new TextCursor(`[name='types[]']`))).toEqual({ localRaw: 'name', op: '=', valueRaw: 'types[]' });
    expect(parseAttributeSelector(new TextCursor(`[name^='foo[']`))).toEqual({ localRaw: 'name', op: '^=', valueRaw: 'foo[' });
    expect(parseAttributeSelector(new TextCursor(`[name="brackets[5][]"]`))).toEqual({ localRaw: 'name', op: '=', valueRaw: 'brackets[5][]' });
  });

  it('accepts missing right bracket at EOF with quoted values', () => {
    expect(parseAttributeSelector(new TextCursor(`[charset="utf-8"`))).toEqual({ localRaw: 'charset', op: '=', valueRaw: 'utf-8' });
    expect(parseAttributeSelector(new TextCursor(`[align="center"`))).toEqual({ localRaw: 'align', op: '=', valueRaw: 'center' });
    expect(parseAttributeSelector(new TextCursor(`[name='types[]'`))).toEqual({ localRaw: 'name', op: '=', valueRaw: 'types[]' });
  });
});

function stepsOf(source: string) {
  const parsed = parseRelativeSelectorList(new TextCursor(`(${source})`), {});

  return parsed.arms.map((arm) =>
    arm.steps.map((step) => [step.combinator, describeRelativeCompound(step.compound)])
  );
}

describe('parsePseudoBodyRelativeSelectorList legacy relative selector cases', () => {
  it('parses a single implicit descendant step', () => {
    expect(stepsOf('.a')).toEqual([[[' ', '.a']]]);
  });

  it('parses implicit descendant chains', () => {
    expect(stepsOf('.a .b .c')).toEqual([[[' ', '.a'], [' ', '.b'], [' ', '.c']]]);
  });

  it('parses leading explicit combinators', () => {
    expect(stepsOf('> .a')).toEqual([[['>', '.a']]]);
    expect(stepsOf('+ .next')).toEqual([[['+', '.next']]]);
    expect(stepsOf('~ .after')).toEqual([[['~', '.after']]]);
  });

  it('parses mixed child, sibling, and descendant steps', () => {
    expect(stepsOf('> .a + .b .c')).toEqual([[['>', '.a'], ['+', '.b'], [' ', '.c']]]);
  });
});

describe('parsePseudoBodyRelativeSelectorList advanced relative selector cases', () => {
  it('parses general sibling followed by child and descendant steps', () => {
    expect(stepsOf('~ .a > .b .c')).toEqual([[['~', '.a'], ['>', '.b'], [' ', '.c']]]);
  });

  it('ignores whitespace around explicit combinators', () => {
    expect(stepsOf('  >   .a   +   .b   ~   .c  ')).toEqual([[['>', '.a'], ['+', '.b'], ['~', '.c']]]);
  });

  it('splits selector-list branches at top-level commas', () => {
    expect(stepsOf('.a, > .b, + .c')).toEqual([[[' ', '.a']], [['>', '.b']], [['+', '.c']]]);
  });

  it('does not split commas inside functional pseudos', () => {
    expect(stepsOf('.a:is(.x, .y), > .b:not(.c, .d)')).toEqual([[[' ', '.a:is(.x, .y)']], [['>', '.b:not(.c, .d)']]]);
  });

  it('does not split combinators inside functional pseudos', () => {
    expect(stepsOf('.a:is(.x > .y) > .b:not(.c + .d)')).toEqual([[[' ', '.a:is(.x > .y)'], ['>', '.b:not(.c + .d)']]]);
  });

  it('does not split combinators inside attribute selectors', () => {
    expect(stepsOf('[data-x="a>b"] + [data-y="c+d"] ~ [data-z="e~f"]')).toEqual([[[' ', '[data-x="a>b"]'], ['+', '[data-y="c+d"]'], ['~', '[data-z="e~f"]']]]);
  });

  it('does not split commas inside quoted attribute values', () => {
    expect(stepsOf('[data-x=","] , [data-y="a,b"]')).toEqual([[[' ', '[data-x=","]']], [[' ', '[data-y="a,b"]']]]);
  });

  it('preserves escaped combinator-like characters in compounds', () => {
    expect(stepsOf(String.raw`.a\+b > .c\~d + .e\>f`)).toEqual([[[' ', String.raw`.a\+b`], ['>', String.raw`.c\~d`], ['+', String.raw`.e\>f`]]]);
  });

  it('preserves escaped commas in compounds', () => {
    expect(stepsOf(String.raw`.a\,b, .c`)).toEqual([[[' ', String.raw`.a\,b`]], [[' ', '.c']]]);
  });

  it('parses nested :has as part of the compound test set', () => {
    const parsed = parseRelativeSelectorList(new TextCursor('(.a:has(> .x + .y) > .b)'), {});
    const arms = parsed.arms[0].steps;
    expect(arms.map((s) => s.combinator)).toEqual([' ', '>']);
    expect(describeRelativeCompound(arms[0].compound)).toBe('.a:has(> .x + .y)');
    expect(describeRelativeCompound(arms[1].compound)).toBe('.b');
  });

  it('parses nested logical pseudos with selector lists as part of the compound test set', () => {
    const parsed = parseRelativeSelectorList(new TextCursor('(:is(.a > .b, .c + .d) ~ .e)'), {});
    const arms = parsed.arms[0].steps;
    expect(arms.map((s) => s.combinator)).toEqual([' ', '~']);
    expect(describeRelativeCompound(arms[1].compound)).toBe('.e');
  });
});

describe('parseSelectorList escaped whitespace in class identifiers', () => {
  it('parses escaped whitespace in class selectors', () => {
    let c = parseCompoundSelector(new TextCursor(String.raw`.foo\ `), {});
    expect(c.classes?.map((x) => x.raw)).toEqual([String.raw`foo\ `]);

    c = parseCompoundSelector(new TextCursor(String.raw`.foo\a bar`), {});
    expect(c.classes?.map((x) => x.raw)).toEqual([String.raw`foo\a bar`]);
  });

  it('does not treat escaped whitespace as a descendant combinator', () => {
    let list = parseSelectorList(String.raw`.foo\ .bar`, {});
    expect(list.arms).toHaveLength(1);
    expect(list.arms[0].parts).toHaveLength(1);
    expect(list.arms[0].parts[0].compound.classes?.map((x) => x.raw)).toEqual([String.raw`foo\ `, 'bar']);

    list = parseSelectorList(String.raw`.foo\a bar.baz`, {});
    expect(list.arms).toHaveLength(1);
    expect(list.arms[0].parts).toHaveLength(1);
    expect(list.arms[0].parts[0].compound.classes?.map((x) => x.raw)).toEqual([String.raw`foo\a bar`, 'baz']);
  });
});

describe('parseSelectorList normalized whitespace legacy cases', () => {
  it('parses ordinary selector whitespace without preserving normalizer output', () => {
    let list = parseSelectorList('  .foo  ', {});
    expect(list.arms).toHaveLength(1);
    expect(list.arms[0].parts).toHaveLength(1);
    expect(list.arms[0].parts[0].compound.classes?.map((c) => c.raw)).toEqual(['foo']);

    list = parseSelectorList('  .foo,\n.bar\t', {});
    expect(list.arms).toHaveLength(2);
    expect(list.arms[0].parts[0].compound.classes?.map((c) => c.raw)).toEqual(['foo']);
    expect(list.arms[1].parts[0].compound.classes?.map((c) => c.raw)).toEqual(['bar']);

    list = parseSelectorList('div   >   .foo', {});
    expect(list.arms[0].parts.map((p) => p.combinator)).toEqual([null, '>']);
    expect(list.arms[0].parts[0].compound.tag).toMatchObject({ localRaw: 'div' });
    expect(list.arms[0].parts[1].compound.classes?.map((c) => c.raw)).toEqual(['foo']);

    const c = parseCompoundSelector(new TextCursor(':not( .foo )'), {});
    expect(c.tests.length).toBe(1);
  });

  it('preserves escaped trailing whitespace inside identifiers', () => {
    let c = parseCompoundSelector(new TextCursor(String.raw`.foo\ `), {});
    expect(c.classes?.map((x) => x.raw)).toEqual([String.raw`foo\ `]);

    c = parseSelectorList(String.raw`  .foo\   `, {}).arms[0].parts[0].compound;
    expect(c.classes?.map((x) => x.raw)).toEqual([String.raw`foo\ `]);
  });

  it('preserves hex-escape terminator whitespace inside identifiers', () => {
    let c = parseCompoundSelector(new TextCursor(String.raw`.foo\a bar`), {});
    expect(c.classes?.map((x) => x.raw)).toEqual([String.raw`foo\a bar`]);

    c = parseSelectorList(String.raw`  .foo\a bar  `, {}).arms[0].parts[0].compound;
    expect(c.classes?.map((x) => x.raw)).toEqual([String.raw`foo\a bar`]);
  });

  it('accepts escaped backslashes', () => {
    expect(() => parseSelectorList(String.raw`.foo\\`, {})).not.toThrow();
  });
});

describe('parseSelectorList dangling and escaped backslash identifiers', () => {
  it('accepts trailing EOF escape in class identifiers', () => {
    const list = parseSelectorList('.foo\\', {});
    const compound = list.arms[0].parts[0].compound;

    expect(compound.classes?.[0].raw).toBe('foo\\');
  });

  it('accepts trailing EOF escape in id identifiers', () => {
    const list = parseSelectorList('#foo\\', {});
    const compound = list.arms[0].parts[0].compound;

    expect(compound.id?.raw).toBe('foo\\');
  });

  it('accepts escaped backslash inside identifiers', () => {
    const c = parseCompoundSelector(new TextCursor('.foo\\\\'), {});
    expect(c.classes?.map((x) => x.raw)).toEqual(['foo\\\\']);
  });
});

describe('parse attribute strings with EOF', () => {
  it('accepts EOF as the end of a quoted attribute value', () => {
    const list = parseSelectorList('meta[charset="utf-8', {});
    const compound = list.arms[0].parts[0].compound;

    expect(compound.tag?.localRaw).toBe('meta');
    expect(compound.tests).toHaveLength(1);
  });

  it('accepts missing closing bracket after quoted attribute value at EOF', () => {
    expect(() => parseSelectorList('meta[charset="utf-8', {})).not.toThrow();
  });
});

describe('scope propagation through nested selector pseudos', () => {
  it('propagates :scope through forgiving logical pseudos', () => {
    expect(parseSelectorList(':is(:scope > .item)', {}).usesScope).toBe(true);
    expect(parseSelectorList(':where(:scope > .item)', {}).usesScope).toBe(true);
  });

  it('propagates :scope through strict logical pseudos', () => {
    expect(parseSelectorList(':not(:scope)', {}).usesScope).toBe(true);
    expect(parseSelectorList(':not(:scope > .item)', {}).usesScope).toBe(true);
  });

  it('propagates :scope through relative selector pseudos', () => {
    expect(parseSelectorList(':has(:scope > .item)', {}).usesScope).toBe(true);
  });
});

describe('parseRelativeSelectorList', () => {
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

  it('returns arms with compound source strings', () => {
    const parsed = parseRelativeSelectorList(new TextCursor('(> div.foo[attr="x"], .c)'), {});

    expect(parsed.arms).toHaveLength(2);

    expect(describeRelativeStep(parsed.arms[0].steps[0])).toBe(
      '> div.foo[attr="x"]');

    expect(describeRelativeStep(parsed.arms[1].steps[0])).toBe(' .c');
  });
});

describe('registered pseudo parse context', () => {
  it('rejects unknown pseudos without a registered pseudo context entry', () => {
    expect(() => parseSelectorList(':x-control', {})).toThrow(
      `Unsupported pseudo-class ':x-control'`
    );
  });

  it('accepts custom pseudos registered in parse context', () => {
    const ctx: ParseContext = {
      pseudos: {
        'x-control': () => true,
      },
    };

    expect(() => parseSelectorList(':x-control', ctx)).not.toThrow();
  });

  it('accepts registered custom pseudos inside compounds', () => {
    const ctx: ParseContext = {
      pseudos: {
        'x-control': () => true,
      },
    };

    expect(() => parseSelectorList('button:x-control.enabled', ctx)).not.toThrow();
  });
});

describe('parseCompoundSelector', () => {
  it('rejects invalid characters immediately after a simple selector', () => {
    const ctx = { pseudos: {} };

    expect(() => parseCompoundSelector(new TextCursor('.foo@'), ctx))
      .toThrow('Expected simple selector boundary, got @');

    expect(() => parseSelectorList('.foo@', ctx))
      .toThrow('Expected simple selector boundary, got @');
  });
});

describe('parseAttributeSelector errors', () => {
  it.each([
    ['[*=x]', 'Expected "|" after "*" in attribute namespace prefix'],
    ['[*|=x]', 'Expected identifier'],
    ['[|=x]', 'Expected identifier'],
    ['[foo|bar=x]', 'Unsupported namespace prefix foo'],
    ['[foo=x i z]', 'Expected "]" at end of attribute selector'],
  ])('%s', (source, error) => {
    expect(() => parseAttributeSelector(new TextCursor(source))).toThrow(error);
  });
});

describe('Cursor.next EOF behavior', () => {
  it('returns an empty string when called at EOF', () => {
    const c = new TextCursor('');

    expect(c.next()).toBe('');
    expect(c.next()).toBe('');
  });

  it('keeps position stable when called at EOF', () => {
    const c = new TextCursor('');
    const pos = c.pos();

    expect(c.next()).toBe('');
    expect(c.pos()).toBe(pos);
  });

  it('returns an empty string at EOF after consuming input', () => {
    const c = new TextCursor('*');

    expect(c.next()).toBe('*');
    expect(c.next()).toBe('');
    expect(c.next()).toBe('');
  });
});
