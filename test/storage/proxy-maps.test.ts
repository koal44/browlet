import { describe, expect, it } from 'vitest';

import { StorageProxyMap } from '../../src/storage/bottles';

describe('Storage §4.7: proxy maps', () => {
  it('forwards map operations and preserves insertion order', () => {
    const backing = new Map<unknown, unknown>();
    const proxy = new StorageProxyMap(backing);
    expect(proxy.size).toBe(0);
    expect(proxy.set('a', 1)).toBe(proxy);
    proxy.set('b', undefined);
    expect(proxy.has('b')).toBe(true);
    expect(proxy.get('b')).toBeUndefined();
    expect(proxy.has('missing')).toBe(false);
    backing.set('c', 3);
    expect(proxy.size).toBe(3);
    expect([...proxy.keys()]).toEqual(['a', 'b', 'c']);
    expect([...proxy.values()]).toEqual([1, undefined, 3]);
    expect([...proxy.entries()]).toEqual([...backing]);
    expect(new Map(proxy)).toEqual(backing);
    expect(proxy.delete('b')).toBe(true);
    expect(proxy.delete('missing')).toBe(false);
    expect([...backing]).toEqual([['a', 1], ['c', 3]]);
    proxy.clear();
    expect(backing.size).toBe(0);
  });

  it('uses a replacement backing map for subsequent reads, writes, and iteration', () => {
    const original = new Map<unknown, unknown>([['old', 1]]);
    const replacement = new Map<unknown, unknown>([['new', 2]]);
    const proxy = new StorageProxyMap(original);
    proxy.backingMap = replacement;
    expect(proxy.has('old')).toBe(false);
    expect(proxy.get('new')).toBe(2);
    expect([...proxy]).toEqual([['new', 2]]);
    proxy.set('added', 3);
    expect([...proxy.keys()]).toEqual(['new', 'added']);
    expect([...proxy.values()]).toEqual([2, 3]);
    expect(proxy.size).toBe(2);

    const visited = { entries: [] as [unknown, unknown][] };
    proxy.forEach(function(this: typeof visited, value, key, map) {
      expect(map).toBe(proxy);
      this.entries.push([key, value]);
    }, visited);
    expect(visited.entries).toEqual([...replacement]);
    const clone = new Map(proxy);
    expect([...clone]).toEqual([['new', 2], ['added', 3]]);
    clone.delete('added');
    expect(proxy.has('added')).toBe(true);
    expect(proxy.delete('new')).toBe(true);
    proxy.clear();
    expect(replacement.size).toBe(0);
    expect([...original]).toEqual([['old', 1]]);
  });

  it('retargets one proxy without redirecting other views of the original map', () => {
    const original = new Map<unknown, unknown>([['saved', 'original']]);
    const replacement = new Map<unknown, unknown>([['saved', 'replacement']]);
    const first = new StorageProxyMap(original);
    const second = new StorageProxyMap(original);
    first.backingMap = replacement;

    expect(first.get('saved')).toBe('replacement');
    expect(second.get('saved')).toBe('original');
    first.set('new', 'first only');
    second.set('old', 'second only');
    expect(first.has('old')).toBe(false);
    expect(second.has('new')).toBe(false);
    expect([...first]).toEqual([['saved', 'replacement'], ['new', 'first only']]);
    expect([...second]).toEqual([['saved', 'original'], ['old', 'second only']]);

    first.clear();
    expect(replacement.size).toBe(0);
    expect(second.size).toBe(2);
    expect(original.size).toBe(2);
  });
});
