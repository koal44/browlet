import { describe, expect, it } from 'vitest';
import { Cursor } from '../../../src/selectlet/parser/cursor';
import { parseSelectorList, parseSelectorPrelude } from '../../../src/selectlet/parser/parser';

describe('parseSelectorPrelude', () => {
  it('stops before a style block opener without consuming it', () => {
    const c = new Cursor('.foo{ color: red }');
    const list = parseSelectorPrelude(c, {});

    expect(list.arms).toHaveLength(1);
    expect(list.arms[0].parts).toHaveLength(1);
    expect(list.arms[0].parts[0].compound.classes?.map((x) => x.raw)).toEqual(['foo']);
    expect(c.peek()).toBe('{');
  });

  it('accepts a compound immediately before a style block opener', () => {
    const c = new Cursor('.foo.bar{ color: red }');
    const list = parseSelectorPrelude(c, {});

    expect(list.arms).toHaveLength(1);
    expect(list.arms[0].parts).toHaveLength(1);
    expect(list.arms[0].parts[0].compound.classes?.map((x) => x.raw)).toEqual(['foo', 'bar']);
    expect(c.peek()).toBe('{');
  });

  it('accepts selector lists before a style block opener', () => {
    const c = new Cursor('.foo, #bar{ color: red }');
    const list = parseSelectorPrelude(c, {});

    expect(list.arms).toHaveLength(2);
    expect(list.arms[0].parts[0].compound.classes?.map((x) => x.raw)).toEqual(['foo']);
    expect(list.arms[1].parts[0].compound.id?.raw).toBe('bar');
    expect(c.peek()).toBe('{');
  });

  it('does not weaken direct selector-list parsing', () => {
    expect(() => parseSelectorList('.foo { color: red }', {})).toThrow();
  });

  it('rejects a trailing comma before a style block opener', () => {
    const c = new Cursor('.foo,{ color: red }');

    expect(() => parseSelectorPrelude(c, {})).toThrow('Expected selector after comma');
  });

  it('rejects a combinator before a style block opener', () => {
    const c = new Cursor('.foo > { color: red }');

    expect(() => parseSelectorPrelude(c, {})).toThrow('Expected compound selector after combinator');
  });

  it('does not treat a style block opener as a forgiving pseudo body close', () => {
    const c = new Cursor('.foo:is(.bar{ color: red }');

    expect(() => parseSelectorPrelude(c, {})).toThrow();
  });

  it('does not treat a style block opener as a strict pseudo body close', () => {
    const c = new Cursor('.foo:not(.bar{ color: red }');

    expect(() => parseSelectorPrelude(c, {})).toThrow();
  });

  it('does not treat a style block opener as an attribute selector close', () => {
    const c = new Cursor('.foo[data-x="{ color: red }');

    expect(() => parseSelectorPrelude(c, {})).toThrow();
  });

  it('allows braces inside quoted attribute values before the real block opener', () => {
    const c = new Cursor('.foo[data-x="{"]{ color: red }');
    const list = parseSelectorPrelude(c, {});

    expect(list.arms).toHaveLength(1);
    expect(list.arms[0].parts[0].compound.classes?.map((x) => x.raw)).toEqual(['foo']);
    expect(list.arms[0].parts[0].compound.tests.length).toBe(1);
    expect(c.peek()).toBe('{');
  });
});
