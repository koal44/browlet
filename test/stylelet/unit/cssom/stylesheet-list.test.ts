import { describe, expect, it } from 'vitest';

import { StyleSheetListImpl } from '../../../../src/stylelet/cssom/stylesheet-list';

describe('StyleSheetListImpl', () => {
  it('exposes its stylesheets by item and supported index', () => {
    const first = {} as CSSStyleSheet;
    const second = {} as CSSStyleSheet;
    const list = new StyleSheetListImpl([first, second]);

    expect(list).toHaveLength(2);
    expect(list.item(0)).toBe(first);
    expect(list[1]).toBe(second);
    expect(list.item(2)).toBeNull();
    expect([...list]).toEqual([first, second]);
  });

});
