import { describe, expect, it } from 'vitest';

import { obtainURLOrigin, parseURL } from '../../src/url/index';
import { createStorageEnvironment as createEnvironment } from '../support/storage';
import { StorageKey } from '../../src/storage/keys';
import { StorageBottle } from '../../src/storage/bottles';
import { StorageBucket } from '../../src/storage/buckets';
import { StorageShelf } from '../../src/storage/sheds';

describe('Storage §7: bucket management', () => {
  it.each(['local', 'session'] as const)('clears every %s endpoint while keeping retained and newly acquired views connected', (type) => {
    const env = createEnvironment();
    const identifier = `${type}Storage`;
    const first = StorageBottle.obtainMap(type, env, identifier)!;
    const second = StorageBottle.obtainMap(type, env, identifier)!;
    const shed = type === 'local' ? env.userAgent.storageShed : env.getSessionStorageShed();
    const shelf = shed.get(StorageKey.obtain(env)!)!;
    const bucket = shelf.bucketMap.get('default')!;
    for (const bottle of bucket.bottleMap.values()) bottle.map.set('saved', 'value');
    expect(first.get('saved')).toBe('value');

    bucket.clear();

    for (const bottle of bucket.bottleMap.values()) expect(bottle.map.size).toBe(0);
    expect(first.size).toBe(0);
    expect(second.size).toBe(0);
    expect(shelf.usage).toBe(0);
    const third = StorageBottle.obtainMap(type, env, identifier)!;
    expect(third.size).toBe(0);
    first.set('new', 'value');
    expect(second.get('new')).toBe('value');
    expect(third.get('new')).toBe('value');
    expect(shelf.usage).toBe(16);
  });

  it('clears one bucket without clearing neighboring buckets, origins, or sheds', () => {
    const env = createEnvironment();
    const local = StorageBottle.obtainLocalMap(env, 'localStorage')!;
    const session = StorageBottle.obtainSessionMap(env, 'sessionStorage')!;
    local.set('saved', 'local');
    session.set('saved', 'session');
    const shelf = env.userAgent.storageShed.get(StorageKey.obtain(env)!)!;
    const neighbor = StorageBucket.create('local');
    neighbor.bottleMap.get('localStorage')!.map.set('saved', 'neighbor');
    shelf.bucketMap.set('neighbor', neighbor);
    const otherKey = keyFor('https://other.test/');
    const otherShelf = StorageShelf.create('local');
    otherShelf.bucketMap.get('default')!.bottleMap.get('localStorage')!.map.set('saved', 'other origin');
    env.userAgent.storageShed.set(otherKey, otherShelf);

    shelf.bucketMap.get('default')!.clear();

    expect(local.size).toBe(0);
    expect(session.get('saved')).toBe('session');
    expect(neighbor.bottleMap.get('localStorage')!.map.get('saved')).toBe('neighbor');
    expect(otherShelf.bucketMap.get('default')!.bottleMap.get('localStorage')!.map.get('saved')).toBe('other origin');
    expect(env.userAgent.storageShed.size).toBe(2);
    expect(shelf.bucketMap.size).toBe(2);
  });

  it('removes a bucket by an equal key without removing a shelf that still has another bucket', () => {
    const env = createEnvironment();
    const local = StorageBottle.obtainLocalMap(env, 'localStorage')!;
    local.set('kept', 'value');
    const shed = env.userAgent.storageShed;
    const key = StorageKey.obtain(env)!;
    const shelf = shed.get(key)!;
    const bucket = StorageBucket.create('local');
    for (const bottle of bucket.bottleMap.values()) bottle.map.set('removed', 'value');
    shelf.bucketMap.set('retired', bucket);
    const equalKey = keyFor('https://example.test/another-path');
    expect(equalKey).not.toBe(key);

    expect(shed.removeBucket(equalKey, 'retired')).toBe(true);

    for (const bottle of bucket.bottleMap.values()) expect(bottle.map.size).toBe(0);
    expect(shed.get(key)).toBe(shelf);
    expect([...shelf.bucketMap.keys()]).toEqual(['default']);
    expect(local.get('kept')).toBe('value');
  });

  it.each(['local', 'session'] as const)('drops the last %s bucket and its shelf, then reacquires empty storage', (type) => {
    const env = createEnvironment();
    const identifier = `${type}Storage`;
    const retired = StorageBottle.obtainMap(type, env, identifier)!;
    retired.set('saved', 'value');
    const shed = type === 'local' ? env.userAgent.storageShed : env.getSessionStorageShed();
    const key = StorageKey.obtain(env)!;
    const shelf = shed.get(key)!;
    const otherKey = keyFor('https://other.test/');
    const otherShelf = StorageShelf.create(type);
    otherShelf.bucketMap.get('default')!.bottleMap.get(identifier)!.map.set('kept', 'other origin');
    shed.set(otherKey, otherShelf);

    expect(shed.removeBucket(keyFor('https://example.test/equal-key'), 'default')).toBe(true);

    expect(retired.size).toBe(0);
    expect(shelf.bucketMap.size).toBe(0);
    expect(shed.has(key)).toBe(false);
    expect([...shed.keys()]).toEqual([otherKey]);
    expect(otherShelf.bucketMap.get('default')!.bottleMap.get(identifier)!.map.get('kept')).toBe('other origin');
    const fresh = StorageBottle.obtainMap(type, env, identifier)!;
    expect(fresh.size).toBe(0);
    expect(shed.get(key)).not.toBe(shelf);
  });

  it('leaves existing data alone when a requested bucket or key is absent', () => {
    const env = createEnvironment();
    const local = StorageBottle.obtainLocalMap(env, 'localStorage')!;
    local.set('kept', 'value');
    const shed = env.userAgent.storageShed;
    const key = StorageKey.obtain(env)!;

    expect(shed.removeBucket(key, 'absent')).toBe(false);
    expect(shed.removeBucket(keyFor('https://absent.test/'), 'default')).toBe(false);
    expect(shed.size).toBe(1);
    expect(local.get('kept')).toBe('value');
    expect(shed.removeBucket(key, 'default')).toBe(true);
    expect(shed.removeBucket(key, 'default')).toBe(false);
    expect(shed.size).toBe(0);
  });
});


function keyFor(url: string): StorageKey {
  return new StorageKey(obtainURLOrigin(parseURL(url).url!));
}
