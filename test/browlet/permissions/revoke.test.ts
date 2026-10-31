import { describe, expect, it } from 'vitest';


import { obtainURLOrigin, parseURL } from '../../../src/url/index';
import { StorageBottle, StorageShelf, type LocalStorageBucket } from '../../../src/storage/index';
import { Browlet } from '../../../src/browlet/browlet';
import { UserAgent } from '../../../src/browlet/user-agent';
import { getRelevantRealm } from '../../support/browlet-binding';

describe('Permissions §5.4: browser-owned Storage cleanup', () => {
  it('revokes persistence through the shared permission store without deleting local/session data or affecting another browser', async () => {
    const browser = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/');
    await other.navigate('https://example.test/');
    const env = getRelevantRealm(browser.window).env;
    const otherEnv = getRelevantRealm(other.window).env;
    const local = StorageBottle.obtainLocalMap(env, 'localStorage')!;
    const session = StorageBottle.obtainSessionMap(env, 'sessionStorage')!;
    local.set('saved', 'local value');
    session.set('saved', 'session value');
    for (const target of [env, otherEnv]) {
      StorageShelf.obtainLocal(target);
      target.userAgent.storagePersistence.setPermission(target.origin, 'granted');
      expect(target.userAgent.storagePersistence.persist(target.origin)).toBe(true);
    }
    expect(await browser.evaluate(() => navigator.storage.persisted())).toBe(true);

    env.userAgent.permissionStore.revoke(
      { name: 'persistent-storage' }, obtainURLOrigin(parseURL('https://example.test:443/elsewhere').url!),
    );

    expect(env.permissions.getCurrentPermissionState('persistent-storage')).toBe('prompt');
    expect(await browser.evaluate(() => navigator.storage.persisted())).toBe(false);
    expect(await other.evaluate(() => navigator.storage.persisted())).toBe(true);
    expect(otherEnv.userAgent.storagePersistence.getPermission(otherEnv.origin)).toBe('granted');
    expect(local.get('saved')).toBe('local value');
    expect(session.get('saved')).toBe('session value');
  });

  it('cleans retained storage after navigation and while storage access is disabled, without affecting the new origin', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/');
    const env = getRelevantRealm(browser.window).env;
    const userAgent = env.userAgent;
    const bucket = StorageShelf.obtainLocal(env)!.bucketMap.get('default') as LocalStorageBucket;
    userAgent.storagePersistence.setPermission(env.origin, 'granted');
    expect(userAgent.storagePersistence.persist(env.origin)).toBe(true);
    await browser.navigate('https://other.test/');
    const otherEnv = getRelevantRealm(browser.window).env;
    const otherBucket = StorageShelf.obtainLocal(otherEnv)!.bucketMap.get('default') as LocalStorageBucket;
    userAgent.storagePersistence.setPermission(otherEnv.origin, 'granted');
    expect(userAgent.storagePersistence.persist(otherEnv.origin)).toBe(true);
    userAgent.storageEnabled = false;

    userAgent.permissionStore.revoke({ name: 'persistent-storage' }, env.origin);

    expect(bucket.mode).toBe('best-effort');
    expect(userAgent.storagePersistence.getPermission(env.origin)).toBe('prompt');
    expect(otherBucket.mode).toBe('persistent');
    expect(userAgent.storagePersistence.getPermission(otherEnv.origin)).toBe('granted');
  });

  it('requires no Window and does not allocate storage for an absent bucket or decision', () => {
    const userAgent = new UserAgent();
    const origin = obtainURLOrigin(parseURL('https://example.test/').url!);
    userAgent.storagePersistence.setPermission(origin, 'granted');
    userAgent.permissionStore.revoke({ name: 'persistent-storage' }, origin);
    userAgent.permissionStore.revoke({ name: 'persistent-storage' }, origin);
    expect(userAgent.storageShed.size).toBe(0);
    expect(userAgent.permissionStore.size).toBe(0);
    expect(userAgent.storagePersistence.getPermission(origin)).toBe('prompt');
  });
});
