import { describe, it, expect } from 'vitest';
import { consumeIdent, parseComplexSelector, parseCompoundSelector, parseSelectorList } from '../../src/parser';
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
    expect(compound.testSource).toBe('');
    expect(c.eof()).toBe(true);
  });

  it('parses class-only compounds', () => {
    const c = new Cursor('.foo.bar');
    const compound = parseCompoundSelector(c);

    expect(compound.tag).toBeUndefined();
    expect(compound.id).toBeUndefined();
    expect(compound.classes?.map(x => x.raw)).toEqual(['foo', 'bar']);
    expect(compound.testSource).toBe('');
  });

  it('parses universal tag selector', () => {
    const c = new Cursor('*.foo');
    const compound = parseCompoundSelector(c);

    expect(compound.tag?.localRaw).toBe('*');
    expect(compound.classes?.map(x => x.raw)).toEqual(['foo']);
    expect(compound.testSource).toBe('');
  });

  it('attaches attribute and pseudo selectors to test source', () => {
    const c = new Cursor('p[data-x="a b"]:not(.hidden)');
    const compound = parseCompoundSelector(c);

    expect(compound.tag?.localRaw).toBe('p');
    expect(compound.testSource?.length).toBeGreaterThan(0);
    expect(c.eof()).toBe(true);
  });

  it('does not stop on spaces or combinators inside attribute strings and pseudo args', () => {
    const c = new Cursor(`p[data-x="a > b"]:not(.a > .b) + span`);
    const compound = parseCompoundSelector(c);

    expect(compound.tag?.localRaw).toBe('p');
    expect(compound.testSource?.length).toBeGreaterThan(0);
    expect(c.peek()).toBe(' ');
    expect(c.startsWith(' + span')).toBe(true);
  });

  it('stops before whitespace or combinator', () => {
    const c = new Cursor('div.foo > p');
    const compound = parseCompoundSelector(c);

    expect(compound.tag?.localRaw).toBe('div');
    expect(compound.classes?.map(x => x.raw)).toEqual(['foo']);
    expect(compound.testSource).toBe('');
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
