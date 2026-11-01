import { afterEach, describe, expect, it, vi } from 'vitest';

import { PermissionFeature, originPermissionKey, PermissionStore } from '../../../src/permissions/index';
import { StorageShelf, type LocalStorageBucket } from '../../../src/storage/index';
import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Permissions §5.1: browser settings and Storage integration', () => {
  it('uses one store for Storage consent and effective permission state, including revocation', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/');
    const env = getRelevantRealm(browser.window).env;
    const { permissionStore: store, storagePersistence: persistence } = env.userAgent;
    const descriptor = { name: 'persistent-storage' };
    const bucket = StorageShelf.obtainLocal(env)!.bucketMap.get('default') as LocalStorageBucket;
    expect(env.permissions.getCurrentPermissionState(descriptor.name)).toBe('prompt');

    persistence.setPermission(env.origin, 'granted');
    expect(store.size).toBe(1);
    expect(store.getEntry(descriptor, env.origin)?.state).toBe('granted');
    expect(env.permissions.getCurrentPermissionState(descriptor.name)).toBe('granted');
    expect(persistence.persist(env.origin)).toBe(true);
    expect(bucket.mode).toBe('persistent');

    persistence.setPermission(env.origin, 'denied');
    expect(env.permissions.getCurrentPermissionState(descriptor.name)).toBe('denied');
    expect(bucket.mode).toBe('best-effort');
    persistence.setPermission(env.origin, 'prompt');
    expect(store.size).toBe(0);
    expect(env.permissions.getCurrentPermissionState(descriptor.name)).toBe('prompt');

    // The low-level store can be read by Storage too; it does not perform revocation itself.
    store.setEntry(descriptor, env.origin, 'granted');
    expect(persistence.getPermission(env.origin)).toBe('granted');
  });

  it('denies an insecure context without overwriting a recorded host decision', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('http://insecure.test/');
    const env = getRelevantRealm(browser.window).env;
    env.userAgent.storagePersistence.setPermission(env.origin, 'granted');
    expect(env.isSecureContext).toBe(false);
    expect(env.permissions.getCurrentPermissionState('persistent-storage')).toBe('denied');
    expect(env.userAgent.storagePersistence.getPermission(env.origin)).toBe('granted');
  });

  it('calls the existing Document policy boundary only for policy-controlled features', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/');
    const env = getRelevantRealm(browser.window).env;
    const document = env.getAssociatedDocument()!;
    const check = vi.spyOn(document, 'isAllowedToUse');
    expect(env.permissions.getCurrentPermissionState('persistent-storage')).toBe('prompt');
    expect(check).not.toHaveBeenCalled();

    // A permission consumer must also register its defining Permissions Policy feature.
    env.userAgent.permissionStore = new PermissionStore([
      new PermissionFeature('test-policy-feature', originPermissionKey, { policyControlled: true }),
    ]);
    expect(() => env.permissions.getCurrentPermissionState('test-policy-feature'))
      .toThrow('Unsupported policy-controlled feature: test-policy-feature');
    expect(check).toHaveBeenCalledExactlyOnceWith('test-policy-feature');
    check.mockReturnValue(false);
    expect(env.permissions.getCurrentPermissionState('test-policy-feature')).toBe('denied');
  });
});
