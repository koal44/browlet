import { describe, expect, it } from 'vitest';
import { MediaListImpl } from '../../../../src/stylelet/cssom/media-list';

describe('MediaListImpl', () => {
  it('parses and serializes mediaText', () => {
    const list = new MediaListImpl(' SCREEN , (WIDTH >= 10PX) ');

    expect(list.mediaText).toBe('screen, (width >= 10px)');
    expect(list.length).toBe(2);
    expect(list.item(0)).toBe('screen');
    expect(list.item(1)).toBe('(width >= 10px)');
    expect(list.item(2)).toBeNull();
    expect(list[0]).toBe('screen');
    expect(list[1]).toBe('(width >= 10px)');
    expect(list[2]).toBeUndefined();
    expect(list.toString()).toBe(list.mediaText);
    expect([...list]).toEqual(['screen', '(width >= 10px)']);
  });

  it('replaces the collection and treats null as the empty string', () => {
    const list = new MediaListImpl('screen, print');

    list.mediaText = 'speech';
    expect(list.mediaText).toBe('speech');
    expect(list[0]).toBe('speech');
    expect(list[1]).toBeUndefined();

    list.mediaText = null;
    expect(list.mediaText).toBe('');
    expect(list.length).toBe(0);
    expect(list[0]).toBeUndefined();
  });

  it('converts item indices to Web IDL unsigned longs', () => {
    const list = new MediaListImpl('screen, print');

    expect(list.item(1.9)).toBe('print');
    expect(list.item(-1)).toBeNull();
    expect(list.item(2 ** 32)).toBe('screen');
    expect(list.item(Number.NaN)).toBe('screen');
  });

  it('represents an invalid list entry as not all', () => {
    const list = new MediaListImpl('screen, &, print');

    expect(list.mediaText).toBe('screen, not all, print');
  });

  it('appends one query and ignores an equivalent query', () => {
    const list = new MediaListImpl('screen');

    list.appendMedium('PRINT');
    list.appendMedium('print');
    list.appendMedium('screen, speech');

    expect(list.mediaText).toBe('screen, print');
  });

  it('treats the empty query before a lone comma as not all', () => {
    const list = new MediaListImpl('screen');

    list.appendMedium(',');
    expect(list.mediaText).toBe('screen, not all');

    list.deleteMedium(',');
    expect(list.mediaText).toBe('screen');
  });

  it('deletes every equivalent query', () => {
    const list = new MediaListImpl('screen, SCREEN, print');

    list.deleteMedium('screen');

    expect(list.mediaText).toBe('print');
  });

  it('throws NotFoundError when no query is removed', () => {
    const list = new MediaListImpl('screen');
    let error: unknown;

    try {
      list.deleteMedium('print');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(DOMException);
    expect(error).toMatchObject({
      name: 'NotFoundError',
      code: 8,
      NOT_FOUND_ERR: 8,
    });
  });
});
