import { describe, expect, expectTypeOf, it } from 'vitest';

import { registeredStorageEndpoints, StorageEndpoint } from '../../src/storage/endpoints';
import { StorageBucket, LocalStorageBucket, SessionStorageBucket } from '../../src/storage/buckets';
import { StorageProxyMap } from '../../src/storage/bottles';
import { StorageShelf } from '../../src/storage/sheds';

describe('Storage §4.5: creating storage buckets', () => {
  it('selects the bucket type and includes only endpoints supporting that type', () => {
    const local = StorageBucket.create('local');
    const session = StorageBucket.create('session');
    expect(local).toBeInstanceOf(LocalStorageBucket);
    expect(local).toHaveProperty('mode', 'best-effort');
    expect(session).toBeInstanceOf(SessionStorageBucket);
    expect(session).not.toHaveProperty('mode');

    expect(local.bottleMap.has('localStorage')).toBe(true);
    expect(local.bottleMap.has('sessionStorage')).toBe(false);
    expect(session.bottleMap.has('sessionStorage')).toBe(true);
    expect(session.bottleMap.has('localStorage')).toBe(false);
    expect(session.bottleMap.has('indexedDB')).toBe(false);
    expectTypeOf(local.getBottle('localStorage')!.map).toEqualTypeOf<Map<string, string>>();
    expectTypeOf(session.getBottle('sessionStorage')!.map).toEqualTypeOf<Map<string, string>>();
  });

  it('keeps bottle data and proxy references independent across endpoints and buckets', () => {
    const shelf = StorageShelf.create('local');
    const first = shelf.bucketMap.get('default')!;
    const second = StorageBucket.create('local');
    const local = first.bottleMap.get('localStorage')!;
    const indexedDB = first.bottleMap.get('indexedDB')!;
    const otherLocal = second.bottleMap.get('localStorage')!;
    expect(local.map.size).toBe(0);
    expect(local.proxyMapReferenceSet.size).toBe(0);

    local.map.set('saved', 'value');
    local.proxyMapReferenceSet.add(new StorageProxyMap(local, shelf));
    expect(indexedDB.map.size).toBe(0);
    expect(indexedDB.proxyMapReferenceSet.size).toBe(0);
    expect(otherLocal.map.size).toBe(0);
    expect(otherLocal.proxyMapReferenceSet.size).toBe(0);

    otherLocal.map.set('saved', 'another value');
    expect(local.map.get('saved')).toBe('value');
    expect(indexedDB.map.has('saved')).toBe(false);
  });

  it('initializes each new bottle from its endpoint quota, including endpoints supporting both types', () => {
    const endpoint = new StorageEndpoint('test-shared-endpoint', new Set(['local', 'session']), 2048);
    registeredStorageEndpoints.set(endpoint.identifier, endpoint);
    try {
      const local = StorageBucket.create('local').bottleMap.get(endpoint.identifier)!;
      const session = StorageBucket.create('session').bottleMap.get(endpoint.identifier)!;
      expect(local.quota).toBe(2048);
      expect(session.quota).toBe(2048);
      local.map.set('saved', 'local only');
      expect(session.map.has('saved')).toBe(false);

      endpoint.quota = null;
      const later = StorageBucket.create('local').bottleMap.get(endpoint.identifier)!;
      expect(later.quota).toBeNull();
      expect(later.map.size).toBe(0);
      expect(local.quota).toBe(2048);
      expect(session.quota).toBe(2048);
    } finally {
      registeredStorageEndpoints.delete(endpoint.identifier);
    }
  });
});
