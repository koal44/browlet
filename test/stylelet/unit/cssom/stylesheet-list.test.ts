import type { CSSStyleSheetImpl } from '../../../../src/stylelet/cssom/css-stylesheet';
import { describe, expect, it } from 'vitest';

import { StyleSheetListImpl } from '../../../../src/stylelet/cssom/stylesheet-list';

describe('StyleSheetListImpl', () => {
  it('exposes its stylesheets by item and supported index', () => {
    const first = {} as CSSStyleSheetImpl;
    const second = {} as CSSStyleSheetImpl;
    const list = new StyleSheetListImpl();

    list.insert(0, first);
    list.insert(1, second);

    expect(list).toHaveLength(2);
    expect(list.item(0)).toBe(first);
    expect(list[1]).toBe(second);
    expect(list.item(2)).toBeNull();
    expect([...list]).toEqual([first, second]);
  });

  it('keeps item, index, and iteration views live across mutation', () => {
    const first = {} as CSSStyleSheetImpl;
    const second = {} as CSSStyleSheetImpl;
    const third = {} as CSSStyleSheetImpl;
    const list = new StyleSheetListImpl();

    list.insert(0, first);
    list.insert(1, third);

    list.insert(1, second);

    expect(list).toHaveLength(3);
    expect(list[1]).toBe(second);
    expect(list[2]).toBe(third);
    expect([...list]).toEqual([first, second, third]);

    expect(list.remove(second)).toBe(true);
    expect(list.remove(second)).toBe(false);
    expect(list).toHaveLength(2);
    expect(list[1]).toBe(third);
    expect(list[2]).toBeUndefined();
  });
});
