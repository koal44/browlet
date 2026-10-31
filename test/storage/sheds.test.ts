import { describe, expect, it } from 'vitest';

import { createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../src/url/index';
import { StorageKey } from '../../src/storage/keys';
import { StorageEndpoint } from '../../src/storage/endpoints';
import { StorageShed, StorageShelf } from '../../src/storage/sheds';
import { StorageBucket } from '../../src/storage/buckets';
import { StorageBottle, StorageProxyMap } from '../../src/storage/bottles';

describe('Storage §4.3: storage sheds', () => {
  it('finds, replaces, and deletes shelves using key equality while retaining insertion order', () => {
    const shed = new StorageShed();
    expect(shed.size).toBe(0);
    const firstKey = keyFor('https://example.test/first');
    const equalKey = keyFor('https://example.test/second');
    const otherKey = keyFor('https://other.test/');
    const firstShelf = StorageShelf.create('local');
    const replacement = StorageShelf.create('local');
    const otherShelf = StorageShelf.create('local');

    shed.set(firstKey, firstShelf);
    shed.set(otherKey, otherShelf);
    expect(shed.has(equalKey)).toBe(true);
    expect(shed.get(equalKey)).toBe(firstShelf);
    expect(shed.get(keyFor('http://example.test/'))).toBeUndefined();
    expect(shed.get(keyFor('https://example.test:8443/'))).toBeUndefined();
    expect(shed.set(equalKey, replacement)).toBe(shed);
    expect(shed.size).toBe(2);
    expect([...shed.keys()]).toEqual([firstKey, otherKey]);
    expect([...shed.keys()][0]).toBe(firstKey);
    expect(shed.get(firstKey)).toBe(replacement);
    expect(shed.get(otherKey)).toBe(otherShelf);

    expect(shed.delete(equalKey)).toBe(true);
    expect(shed.has(firstKey)).toBe(false);
    expect(shed.delete(equalKey)).toBe(false);
    expect([...shed.values()]).toEqual([otherShelf]);
  });

  it('preserves opaque-origin identity rather than collapsing its null serialization', () => {
    const shed = new StorageShed();
    const origin = createOpaqueOrigin();
    const shelf = StorageShelf.create('session');
    // Acquisition rejects opaque storage keys; the map still follows key equality.
    shed.set(new StorageKey(origin), shelf);
    expect(shed.get(new StorageKey({ ...origin }))).toBe(shelf);
    expect(shed.has(new StorageKey(createOpaqueOrigin()))).toBe(false);
  });
});

describe('Storage §4.3: legacy-clone a traversable storage shed', () => {
  it('copies every origin into independent shelves, buckets, bottles, and data maps', () => {
    const source = new StorageShed();
    const target = new StorageShed();
    const first = putSession(source, 'https://first.test/', [['theme', 'dark'], ['count', '1']]);
    putSession(source, 'https://second.test/', [['theme', 'light']]);

    source.cloneSessionStorageInto(target);

    expect(target.size).toBe(2);
    const key = keyFor('https://first.test/');
    const sourceShelf = source.get(key)!;
    const targetShelf = target.get(key)!;
    const sourceBucket = sourceShelf.bucketMap.get('default')!;
    const targetBucket = targetShelf.bucketMap.get('default')!;
    const copy = targetBucket.bottleMap.get('sessionStorage')!;
    expect(targetShelf).not.toBe(sourceShelf);
    expect(targetBucket).not.toBe(sourceBucket);
    expect(copy).not.toBe(first);
    expect(copy.map).not.toBe(first.map);
    expect([...copy.map]).toEqual([['theme', 'dark'], ['count', '1']]);
    expect(getSession(target, 'https://second.test/').map.get('theme')).toBe('light');

    first.map.set('theme', 'changed in opener');
    copy.map.delete('count');
    copy.map.set('child', 'only');
    expect(copy.map.get('theme')).toBe('dark');
    expect(first.map.get('count')).toBe('1');
    expect(first.map.has('child')).toBe(false);
  });

  it('copies only the default sessionStorage data and resets bottle metadata', () => {
    const source = new StorageShed();
    const target = new StorageShed();
    const bottle = putSession(source, 'https://example.test/', [['saved', 'value']]);
    bottle.quota = 123;
    const shelf = source.get(keyFor('https://example.test/'))!;
    bottle.proxyMapReferenceSet.add(new StorageProxyMap(bottle, shelf));
    const defaultBucket = shelf.bucketMap.get('default')!;
    defaultBucket.bottleMap.set('anotherEndpoint', new StorageBottle(new StorageEndpoint('anotherEndpoint', new Set(['session']), null)));
    shelf.bucketMap.set('anotherBucket', StorageBucket.create('session'));

    source.cloneSessionStorageInto(target);

    const targetShelf = target.get(keyFor('https://example.test/'))!;
    const targetBucket = targetShelf.bucketMap.get('default')!;
    const copy = getSession(target, 'https://example.test/');
    expect([...targetShelf.bucketMap.keys()]).toEqual(['default']);
    expect([...targetBucket.bottleMap.keys()]).toEqual(['sessionStorage']);
    expect(copy.quota).toBe(5 * 2 ** 20);
    expect(copy.proxyMapReferenceSet.size).toBe(0);
    expect(copy.map.get('saved')).toBe('value');
    expect(bottle.quota).toBe(123);
    expect(bottle.proxyMapReferenceSet.size).toBe(1);
  });

  it('replaces equal destination keys without clearing unrelated entries', () => {
    const source = new StorageShed();
    const target = new StorageShed();
    putSession(source, 'https://example.test/source', [['copied', 'value']]);
    const replaced = putSession(target, 'https://example.test/target', [['old', 'value']]);
    const unrelated = putSession(target, 'https://other.test/', [['kept', 'value']]);

    source.cloneSessionStorageInto(target);

    const copy = getSession(target, 'https://example.test/');
    expect(target.size).toBe(2);
    expect(copy).not.toBe(replaced);
    expect([...copy.map]).toEqual([['copied', 'value']]);
    expect(getSession(target, 'https://other.test/')).toBe(unrelated);
  });

  it('does nothing when the source shed is empty', () => {
    const source = new StorageShed();
    const target = new StorageShed();
    const retained = putSession(target, 'https://example.test/', [['kept', 'value']]);

    source.cloneSessionStorageInto(target);

    expect(target.size).toBe(1);
    expect(getSession(target, 'https://example.test/')).toBe(retained);
  });
});

function keyFor(url: string): StorageKey {
  return new StorageKey(obtainURLOrigin(parseURL(url).url!));
}

function putSession(shed: StorageShed, url: string, entries: [string, string][]): StorageBottle {
  const shelf = StorageShelf.create('session');
  const bottle = shelf.bucketMap.get('default')!.bottleMap.get('sessionStorage')!;
  bottle.map = new Map(entries);
  shed.set(keyFor(url), shelf);
  return bottle;
}

function getSession(shed: StorageShed, url: string): StorageBottle {
  return shed.get(keyFor(url))!.bucketMap.get('default')!.bottleMap.get('sessionStorage')!;
}
