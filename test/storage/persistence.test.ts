import { describe, expect, it } from 'vitest';

import { createOpaqueOrigin, obtainURLOrigin, parseURL, type Origin } from '../../src/url/index';
import { StorageKey } from '../../src/storage/keys';
import type { LocalStorageBucket } from '../../src/storage/buckets';
import type { StorageShed } from '../../src/storage/sheds';
import { StorageShelf } from '../../src/storage/sheds';
import { StorageProxyMap } from '../../src/storage/bottles';
import { StoragePersistence } from '../../src/storage/persistence';

import { createStorageUserAgent } from '../support/storage';

describe('Storage §5: persistence permission', () => {
  it('shares decisions by security origin without creating storage', () => {
    const { userAgent, persistence } = createStorage();
    const origin = originFor('https://example.test/first');
    expect(persistence.getPermission(origin)).toBe('prompt');
    persistence.setPermission(origin, 'granted');
    expect(persistence.getPermission(originFor('https://example.test:443/second'))).toBe('granted');
    for (const url of ['http://example.test/', 'https://example.test:444/', 'https://other.test/']) {
      expect(persistence.getPermission(originFor(url))).toBe('prompt');
    }
    persistence.setPermission(originFor('https://example.test/third'), 'denied');
    expect(persistence.getPermission(origin)).toBe('denied');
    persistence.setPermission(origin, 'prompt');
    expect(persistence.getPermission(origin)).toBe('prompt');
    expect(persistence.persist(origin)).toBe(false);
    expect(userAgent.storageShed.size).toBe(0);
  });

  it('requires a grant and a separate persistence operation for an existing bucket', () => {
    const { userAgent, persistence } = createStorage();
    const origin = originFor('https://example.test/');
    const bucket = createBucket(userAgent.storageShed, origin);
    expect(persistence.persist(origin)).toBe(false);
    persistence.setPermission(origin, 'denied');
    expect(persistence.persist(origin)).toBe(false);
    expect(bucket.mode).toBe('best-effort');

    persistence.setPermission(origin, 'granted');
    expect(bucket.mode).toBe('best-effort');
    expect(persistence.persist(origin)).toBe(true);
    expect(bucket.mode).toBe('persistent');
    persistence.setPermission(origin, 'granted');
    expect(bucket.mode).toBe('persistent');

    const absent = originFor('https://absent.test/');
    persistence.setPermission(absent, 'granted');
    expect(persistence.persist(absent)).toBe(false);
    expect(userAgent.storageShed.size).toBe(1);
  });

  it.each(['denied', 'prompt'] as const)('revokes to %s without deleting data or changing other origins', (state) => {
    const { userAgent, persistence } = createStorage();
    const origin = originFor('https://example.test/');
    const otherOrigin = originFor('https://other.test/');
    const bucket = createBucket(userAgent.storageShed, origin);
    const otherBucket = createBucket(userAgent.storageShed, otherOrigin);
    for (const bottle of bucket.bottleMap.values()) bottle.map.set('saved', 'value');
    const view = new StorageProxyMap(bucket.bottleMap.get('localStorage')!.map);
    for (const key of [origin, otherOrigin]) {
      persistence.setPermission(key, 'granted');
      expect(persistence.persist(key)).toBe(true);
    }

    persistence.setPermission(originFor('https://example.test/another'), state);

    expect(persistence.getPermission(origin)).toBe(state);
    expect(bucket.mode).toBe('best-effort');
    for (const bottle of bucket.bottleMap.values()) expect(bottle.map.get('saved')).toBe('value');
    expect(view.get('saved')).toBe('value');
    expect(otherBucket.mode).toBe('persistent');
    expect(persistence.getPermission(otherOrigin)).toBe('granted');
    expect(userAgent.storageShed.size).toBe(2);
  });

  it('revokes retained storage even while storage access is disabled', () => {
    const { userAgent, persistence } = createStorage();
    const origin = originFor('https://example.test/');
    const bucket = createBucket(userAgent.storageShed, origin);
    persistence.setPermission(origin, 'granted');
    expect(persistence.persist(origin)).toBe(true);
    userAgent.storageEnabled = false;
    persistence.setPermission(origin, 'denied');
    expect(bucket.mode).toBe('best-effort');
    persistence.setPermission(origin, 'granted');
    expect(persistence.persist(origin)).toBe(false);
    expect(bucket.mode).toBe('best-effort');
    userAgent.storageEnabled = true;
    expect(persistence.persist(origin)).toBe(true);
  });

  it('keeps permissions when data is removed, but does not automatically persist a replacement bucket', () => {
    const { userAgent, persistence } = createStorage();
    const origin = originFor('https://example.test/');
    createBucket(userAgent.storageShed, origin);
    persistence.setPermission(origin, 'granted');
    expect(persistence.persist(origin)).toBe(true);
    userAgent.storageShed.removeBucket(new StorageKey(origin), 'default');
    expect(persistence.getPermission(origin)).toBe('granted');
    expect(persistence.persist(origin)).toBe(false);
    const replacement = createBucket(userAgent.storageShed, origin);
    expect(replacement.mode).toBe('best-effort');
    expect(persistence.persist(origin)).toBe(true);
    expect(replacement.mode).toBe('persistent');
  });

  it('does not share decisions between browser owners', () => {
    const first = createStorage();
    const second = createStorage();
    const origin = originFor('https://example.test/');
    first.persistence.setPermission(origin, 'granted');
    expect(second.persistence.getPermission(origin)).toBe('prompt');
    second.persistence.setPermission(origin, 'denied');
    expect(first.persistence.getPermission(origin)).toBe('granted');
  });

  it('keeps opaque identities separate and cannot persist their storage', () => {
    const { persistence } = createStorage();
    const origin = createOpaqueOrigin();
    persistence.setPermission(origin, 'granted');
    expect(persistence.getPermission({ ...origin })).toBe('granted');
    expect(persistence.getPermission(createOpaqueOrigin())).toBe('prompt');
    expect(persistence.persist(origin)).toBe(false);
  });
});

function createStorage() {
  const userAgent = createStorageUserAgent();
  return { userAgent, persistence: new StoragePersistence(userAgent) };
}

function originFor(url: string): Origin {
  return obtainURLOrigin(parseURL(url).url!);
}

function createBucket(shed: StorageShed, origin: Origin): LocalStorageBucket {
  const shelf = StorageShelf.create('local');
  shed.set(new StorageKey(origin), shelf);
  return shelf.bucketMap.get('default') as LocalStorageBucket;
}
