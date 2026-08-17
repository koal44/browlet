import { describe, expect, it } from 'vitest';

import { StyleSheetListImpl } from '../../../../src/stylelet/cssom/stylesheet-list';

describe('StyleSheetListImpl', () => {
  it('exposes its stylesheets by item and supported index', () => {
    const first = {} as CSSStyleSheet;
    const second = {} as CSSStyleSheet;
    const list = new StyleSheetListImpl();

    list.__insert(0, first);
    list.__insert(1, second);

    expect(list).toHaveLength(2);
    expect(list.item(0)).toBe(first);
    expect(list[1]).toBe(second);
    expect(list.item(2)).toBeNull();
    expect([...list]).toEqual([first, second]);
  });

  it('keeps item, index, and iteration views live across mutation', () => {
    const first = {} as CSSStyleSheet;
    const second = {} as CSSStyleSheet;
    const third = {} as CSSStyleSheet;
    const list = new StyleSheetListImpl();

    list.__insert(0, first);
    list.__insert(1, third);

    list.__insert(1, second);

    expect(list).toHaveLength(3);
    expect(list[1]).toBe(second);
    expect(list[2]).toBe(third);
    expect([...list]).toEqual([first, second, third]);

    expect(list.__remove(second)).toBe(true);
    expect(list.__remove(second)).toBe(false);
    expect(list).toHaveLength(2);
    expect(list[1]).toBe(third);
    expect(list[2]).toBeUndefined();
  });

  it('does not expose internal mutations as Web IDL members', () => {
    const list = new StyleSheetListImpl() as unknown as Record<string, unknown>;

    expect(list.insert).toBeUndefined();
    expect(list.remove).toBeUndefined();
  });
});
