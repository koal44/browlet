import { describe, expect, it } from 'vitest';
import { MediaListImpl } from '../../../../src/stylelet/cssom/media-list';
import { DOMExceptionImpl } from '../../../../src/web-idl/core/index';

describe('MediaListImpl', () => {
  it('parses and serializes mediaText', () => {
    const list = new MediaListImpl(' SCREEN , (WIDTH >= 10PX) ');

    expect(list.mediaText).toBe('screen, (width >= 10px)');
    expect(list.length).toBe(2);
    expect(list.item(0)).toBe('screen');
    expect(list.item(1)).toBe('(width >= 10px)');
    expect(list.item(2)).toBeNull();
    expect([...list.getSupportedPropertyIndices()]).toEqual([0, 1]);
  });

  it('replaces and clears the collection', () => {
    const list = new MediaListImpl('screen, print');

    list.mediaText = 'speech';
    expect(list.mediaText).toBe('speech');
    expect([...list.getSupportedPropertyIndices()]).toEqual([0]);

    list.mediaText = '';
    expect(list.mediaText).toBe('');
    expect(list.length).toBe(0);
    expect([...list.getSupportedPropertyIndices()]).toEqual([]);
  });

  it('preserves source order and duplicates, including recovered invalid entries', () => {
    const list = new MediaListImpl('screen, &, print, SCREEN');
    expect(list.mediaText).toBe('screen, not all, print, screen');
  });

  it('appends one query and ignores an equivalent query', () => {
    const list = new MediaListImpl('screen');

    list.appendMedium('PRINT');
    list.appendMedium('print');
    list.appendMedium('screen, speech');
    list.appendMedium('');
    list.appendMedium('   ');
    expect(list.mediaText).toBe('screen, print');
  });

  it('compares canonical media feature values', () => {
    const list = new MediaListImpl('(orientation: LANDSCAPE)');
    list.appendMedium('(ORIENTATION: landscape)');
    expect(list.length).toBe(1);
    list.deleteMedium('(orientation: LANDSCAPE)');
    expect(list.length).toBe(0);
  });

  it('ignores multiple queries, including two empty entries around a comma', () => {
    const list = new MediaListImpl('screen');

    list.appendMedium(',');
    expect(list.mediaText).toBe('screen');
    list.deleteMedium(',');
    list.deleteMedium('screen, print');
    list.deleteMedium('');
    expect(list.mediaText).toBe('screen');
  });

  it('deletes every equivalent query', () => {
    const list = new MediaListImpl('screen, SCREEN, print');
    list.deleteMedium('screen');
    expect(list.mediaText).toBe('print');
  });

  it('reports NotFoundError without changing the list', () => {
    const list = new MediaListImpl('screen');
    let error: unknown;
    try {
      list.deleteMedium('print');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DOMExceptionImpl);
    expect(error).toMatchObject({ name: 'NotFoundError', code: 8 });
    expect(list.mediaText).toBe('screen');
  });
});
