import { describe, expect, it } from 'vitest';

import { createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../src/url/index';
import { StorageKey } from '../../src/storage/keys';
import { StorageShed, StorageShelf } from '../../src/storage/sheds';
import type { StorageUserAgent } from '../../src/storage/environment';

import { createStorageUserAgent } from '../support/storage';

describe('Storage §4.4: obtaining storage shelves', () => {
  it.each(['local', 'session'] as const)('creates and reuses a %s shelf in the supplied shed', (type) => {
    const shed = new StorageShed();
    const env = createEnvironment('https://example.test/first');
    const shelf = StorageShelf.obtain(shed, env, type)!;
    expect(shed.get(StorageKey.obtain(env)!)).toBe(shelf);
    expect([...shelf.bucketMap.keys()]).toEqual(['default']);
    const bucket = shelf.bucketMap.get('default')!;
    const bottle = bucket.bottleMap.get(type === 'local' ? 'localStorage' : 'sessionStorage')!;
    bottle.map.set('saved', 'value');

    const sameOrigin = createEnvironment('https://example.test:443/second', env.userAgent);
    const reused = StorageShelf.obtain(shed, sameOrigin, type)!;
    expect(reused).toBe(shelf);
    expect(reused.bucketMap.get('default')).toBe(bucket);
    expect(bottle.map.get('saved')).toBe('value');
    expect(shed.size).toBe(1);
    expect(env.userAgent.storageShed.size).toBe(0);
  });

  it('keeps different origins and different sheds independent', () => {
    const shed = new StorageShed();
    const otherShed = new StorageShed();
    const env = createEnvironment('https://example.test/');
    const otherOrigin = createEnvironment('https://other.test/', env.userAgent);
    const first = StorageShelf.obtain(shed, env, 'session')!;
    const second = StorageShelf.obtain(shed, otherOrigin, 'session')!;
    const separate = StorageShelf.obtain(otherShed, env, 'session')!;

    expect(shed.size).toBe(2);
    expect(otherShed.size).toBe(1);
    expect(first).not.toBe(second);
    expect(first).not.toBe(separate);
    expect(first.bucketMap.get('default')).not.toBe(second.bucketMap.get('default'));
    expect(first.bucketMap.get('default')).not.toBe(separate.bucketMap.get('default'));
  });

  it('uses the settings origin when the creation URL is about:blank', () => {
    const env = createEnvironment('https://creator.test/');
    const inherited = { ...env, creationURL: parseURL('about:blank').url! };
    const shelf = StorageShelf.obtainLocal(inherited)!;
    expect(shelf).not.toBeNull();
    expect(StorageShelf.obtainLocal(env)).toBe(shelf);
    expect(env.userAgent.storageShed.size).toBe(1);
  });

  it('fails for opaque settings origins without exposing an existing shelf', () => {
    const env = createEnvironment('https://example.test/');
    const shed = env.userAgent.storageShed;
    const original = StorageShelf.obtainLocal(env)!;
    env.origin = createOpaqueOrigin();

    expect(StorageShelf.obtainLocal(env)).toBeNull();
    expect([...shed.values()]).toEqual([original]);

    shed.clear();
    expect(StorageShelf.obtainLocal(env)).toBeNull();
    expect(shed.size).toBe(0);
  });

  it('checks disabled storage before reuse or allocation without discarding stored data', () => {
    const env = createEnvironment('https://example.test/');
    const shed = env.userAgent.storageShed;
    const shelf = StorageShelf.obtainLocal(env)!;
    const bottle = shelf.bucketMap.get('default')!.bottleMap.get('localStorage')!;
    bottle.map.set('saved', 'value');
    env.userAgent.storageEnabled = false;

    expect(StorageShelf.obtainLocal(env)).toBeNull();
    expect(StorageShelf.obtainLocal(createEnvironment('https://other.test/', env.userAgent))).toBeNull();
    expect([...shed.values()]).toEqual([shelf]);
    expect(bottle.map.get('saved')).toBe('value');

    env.userAgent.storageEnabled = true;
    expect(StorageShelf.obtainLocal(env)).toBe(shelf);
    expect(bottle.map.get('saved')).toBe('value');
  });

  it('selects the environment owner\'s local shed', () => {
    const first = createEnvironment('https://example.test/');
    const second = createEnvironment('https://example.test/');
    const firstShelf = StorageShelf.obtainLocal(first)!;
    const secondShelf = StorageShelf.obtainLocal(second)!;
    expect(firstShelf).not.toBe(secondShelf);
    expect([...first.userAgent.storageShed.values()]).toEqual([firstShelf]);
    expect([...second.userAgent.storageShed.values()]).toEqual([secondShelf]);
  });
});

function createEnvironment(url: string, userAgent?: StorageUserAgent) {
  const creationURL = parseURL(url).url!;
  return {
    creationURL,
    origin: obtainURLOrigin(creationURL),
    userAgent: userAgent ?? createStorageUserAgent(),
  };
}
