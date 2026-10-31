import { describe, expect, expectTypeOf, it } from 'vitest';

import { createOpaqueOrigin } from '../../src/url/index';
import { StorageKey } from '../../src/storage/keys';
import { StorageBottle } from '../../src/storage/bottles';
import { StorageShed } from '../../src/storage/sheds';
import { createStorageEnvironment as createEnvironment, createStorageUserAgent as createUserAgent } from '../support/storage';

describe('Storage §4.6: obtaining storage bottle maps', () => {
  it('returns fresh registered proxies over the same endpoint data', () => {
    const env = createEnvironment('https://example.test/');
    const first = StorageBottle.obtainLocalMap(env, 'localStorage')!;
    const second = StorageBottle.obtainLocalMap(env, 'localStorage')!;
    expectTypeOf(first.get('saved')).toEqualTypeOf<string | undefined>();
    expectTypeOf<typeof first.set>().parameter(1).toEqualTypeOf<string>();
    const bottle = env.userAgent.storageShed.get(StorageKey.obtain(env)!)!
      .bucketMap.get('default')!.bottleMap.get('localStorage')!;
    expect(first).not.toBe(second);
    expect(first.backingMap).toBe(bottle.map);
    expect(second.backingMap).toBe(bottle.map);
    expect([...bottle.proxyMapReferenceSet]).toEqual([first, second]);

    first.set('saved', 'value');
    expect(second.get('saved')).toBe('value');
    second.delete('saved');
    expect(first.has('saved')).toBe(false);
  });

  it('shares local data by key and user agent while isolating other endpoints and owners', () => {
    const env = createEnvironment('https://example.test/first');
    const first = StorageBottle.obtainLocalMap(env, 'localStorage')!;
    first.set('saved', 'value');
    const sameOrigin = createEnvironment('https://example.test/second', env.userAgent);
    expect(StorageBottle.obtainLocalMap(sameOrigin, 'localStorage')!.get('saved')).toBe('value');

    const otherOrigin = createEnvironment('https://other.test/', env.userAgent);
    const otherUserAgent = createEnvironment('https://example.test/');
    expect(StorageBottle.obtainLocalMap(otherOrigin, 'localStorage')!.size).toBe(0);
    expect(StorageBottle.obtainLocalMap(otherUserAgent, 'localStorage')!.size).toBe(0);
    expect(StorageBottle.obtainLocalMap(env, 'indexedDB')!.size).toBe(0);
  });

  it('does not query a Window or traversable when acquiring local storage', () => {
    const env = createEnvironment('https://example.test/');
    env.getSessionStorageShed = () => { throw new Error('No Window in this environment'); };
    expect(StorageBottle.obtainLocalMap(env, 'caches')!.size).toBe(0);
  });

  it('resolves the session shed on each acquisition and keeps it separate from local storage', () => {
    const firstShed = new StorageShed();
    const secondShed = new StorageShed();
    const env = createEnvironment('https://example.test/', createUserAgent(), firstShed);
    const first = StorageBottle.obtainSessionMap(env, 'sessionStorage')!;
    expectTypeOf(first.get('saved')).toEqualTypeOf<string | undefined>();
    first.set('saved', 'first tab');

    env.getSessionStorageShed = () => secondShed;
    const second = StorageBottle.obtainSessionMap(env, 'sessionStorage')!;
    expect(second.size).toBe(0);
    second.set('saved', 'second tab');
    expect(first.get('saved')).toBe('first tab');
    expect(env.userAgent.storageShed.size).toBe(0);

    env.getSessionStorageShed = () => firstShed;
    expect(StorageBottle.obtainSessionMap(env, 'sessionStorage')!.get('saved')).toBe('first tab');
    expect(StorageBottle.obtainLocalMap(env, 'localStorage')!.size).toBe(0);
  });

  it.each(['local', 'session'] as const)('returns failure without allocating %s data for opaque origins', (type) => {
    const sessionShed = new StorageShed();
    const env = createEnvironment('https://example.test/', createUserAgent(), sessionShed);
    env.origin = createOpaqueOrigin();
    expect(StorageBottle.obtainMap(type, env, `${type}Storage`)).toBeNull();
    expect(env.userAgent.storageShed.size).toBe(0);
    expect(sessionShed.size).toBe(0);
  });

  it.each(['local', 'session'] as const)('denies %s acquisition without registering a proxy or losing data', (type) => {
    const sessionShed = new StorageShed();
    const env = createEnvironment('https://example.test/', createUserAgent(), sessionShed);
    const identifier = `${type}Storage`;
    const initial = StorageBottle.obtainMap(type, env, identifier)!;
    initial.set('saved', 'value');
    const shed = type === 'local' ? env.userAgent.storageShed : sessionShed;
    const bottle = shed.get(StorageKey.obtain(env)!)!.bucketMap.get('default')!.bottleMap.get(identifier)!;
    env.userAgent.storageEnabled = false;

    expect(StorageBottle.obtainMap(type, env, identifier)).toBeNull();
    expect([...bottle.proxyMapReferenceSet]).toEqual([initial]);
    expect(initial.get('saved')).toBe('value');
    const otherOrigin = createEnvironment('https://other.test/', env.userAgent, sessionShed);
    expect(StorageBottle.obtainMap(type, otherOrigin, identifier)).toBeNull();
    expect(shed.size).toBe(1);

    env.userAgent.storageEnabled = true;
    const restored = StorageBottle.obtainMap(type, env, identifier)!;
    expect(restored).not.toBe(initial);
    expect(restored.get('saved')).toBe('value');
    expect([...bottle.proxyMapReferenceSet]).toEqual([initial, restored]);
  });
});
