import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet, type BrowletConfig } from '../../../src/browlet/browlet';
import type { GlobalObject } from '../../../src/js-engine/index';
import { StorageShelf, type LocalStorageBucket } from '../../../src/storage/index';
import { createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../../src/url/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { observeBrowletPromise, performTestMicrotaskCheckpoint } from '../test-runtime';

afterEach(() => { vi.restoreAllMocks(); });

describe('Storage §8: persist()', () => {
  it('requests asynchronous consent, protects the bucket, and reuses the saved grant', async () => {
    const permissionPrompt = vi.fn(() => Promise.resolve(true));
    const browser = await createBrowser({ permissionPrompt });
    expect(await browser.evaluate(async () => {
      const result = navigator.storage.persist();
      return { promise: result instanceof Promise, granted: await result, persisted: await navigator.storage.persisted() };
    })).toEqual({ promise: true, granted: true, persisted: true });
    expect(permissionPrompt).toHaveBeenCalledExactlyOnceWith({
      descriptor: { name: 'persistent-storage' }, origin: 'https://example.test', topLevelOrigin: 'https://example.test',
    });
    const env = getRelevantRealm(browser.window).env;
    await new Promise<void>((resolve) => { env.queueTask('permissions', resolve); });
    expect(await browser.evaluate(async () => (await navigator.permissions.query({ name: 'persistent-storage' })).state)).toBe('granted');
    expect(await browser.evaluate(() => navigator.storage.persist())).toBe(true);
    expect(permissionPrompt).toHaveBeenCalledOnce();
  });

  it.each(['default', 'refused'] as const)('leaves the bucket best-effort when consent is %s', async (kind) => {
    const permissionPrompt = vi.fn(() => false);
    const browser = await createBrowser(kind === 'default' ? {} : { permissionPrompt });
    expect(await browser.evaluate(async () => [await navigator.storage.persist(), await navigator.storage.persisted()])).toEqual([false, false]);
    const env = getRelevantRealm(browser.window).env;
    await new Promise<void>((resolve) => { env.queueTask('permissions', resolve); });
    expect(await browser.evaluate(() => navigator.storage.persist())).toBe(false);
    expect(permissionPrompt).toHaveBeenCalledTimes(kind === 'default' ? 0 : 1);
  });

  it.each(['disabled', 'opaque'] as const)('rejects %s storage before requesting permission', async (reason) => {
    const permissionPrompt = vi.fn(() => true);
    const browser = await createBrowser({ permissionPrompt });
    const env = getRelevantRealm(browser.window).env;
    if (reason === 'disabled') env.userAgent.storageEnabled = false;
    else vi.spyOn(env, 'origin', 'get').mockReturnValue(createOpaqueOrigin());
    const background = vi.spyOn(env, 'runInParallel');
    const delivery = vi.spyOn(env, 'queueStorageTask');
    expect(await browser.evaluate(async () => {
      const result = navigator.storage.persist();
      try { await result; return false; }
      catch (error) { return result instanceof Promise && error instanceof TypeError; }
    })).toBe(true);
    expect(permissionPrompt).not.toHaveBeenCalled();
    expect(background).not.toHaveBeenCalled();
    expect(delivery).not.toHaveBeenCalled();
    expect(env.userAgent.storageShed.size).toBe(0);
  });

  it('uses the returned grant before it is stored and resolves only through the storage task', async () => {
    const permissionPrompt = vi.fn(() => true);
    const browser = await createBrowser({ permissionPrompt });
    const env = getRelevantRealm(browser.window).env;
    const background: (() => void)[] = [];
    const permissions: (() => void)[] = [];
    const delivery: { global: GlobalObject; steps: () => void; }[] = [];
    const queued = Promise.withResolvers<void>();
    vi.spyOn(env, 'runInParallel').mockImplementation((steps) => { background.push(steps); });
    vi.spyOn(env, 'queueTask').mockImplementation((source, steps) => {
      expect(source).toBe('permissions');
      permissions.push(steps);
      return { remove() { permissions.splice(permissions.indexOf(steps), 1); } };
    });
    vi.spyOn(env, 'queueStorageTask').mockImplementation((global, steps) => {
      delivery.push({ global, steps });
      queued.resolve();
    });
    const result = browser.window.navigator.storage.persist();
    const observed = observeBrowletPromise(browser.window, result);
    const bucket = StorageShelf.obtainLocal(env)!.bucketMap.get('default') as LocalStorageBucket;
    let complete = false;
    void observed.then(() => { complete = true; });
    expect(bucket.mode).toBe('best-effort');
    expect(background).toHaveLength(1);
    expect(permissionPrompt).not.toHaveBeenCalled();

    background[0]!();
    await queued.promise;
    expect(permissions).toHaveLength(1);
    expect(env.userAgent.storagePersistence.getPermission(env.origin)).toBe('prompt');
    expect(bucket.mode).toBe('persistent');
    expect(complete).toBe(false);
    expect(delivery).toHaveLength(1);
    expect(delivery[0]!.global).toBe(env.realm.globalObject);
    // The result records the completed attempt, even if protection changes before delivery.
    bucket.mode = 'best-effort';
    delivery[0]!.steps();
    performTestMicrotaskCheckpoint(browser.window);
    expect(await observed).toBe(true);
    permissions[0]!();
    expect(env.userAgent.storagePersistence.getPermission(env.origin)).toBe('granted');
  });

  it.each(['throw', 'reject'] as const)('rejects a host prompt %s without recording a denial or protecting storage', async (kind) => {
    const error = new Error('Consent UI failed');
    const browser = await createBrowser({
      permissionPrompt: () => {
        if (kind === 'throw') throw error;
        return Promise.reject(error);
      },
    });
    await expect(browser.evaluate(() => navigator.storage.persist())).rejects.toThrow('Consent UI failed');
    const env = getRelevantRealm(browser.window).env;
    expect(env.userAgent.permissionStore.size).toBe(0);
    expect(await browser.evaluate(() => navigator.storage.persisted())).toBe(false);
  });

  it.each(['read', 'write', 'missing'] as const)('reports an internal bucket %s failure as false', async (kind) => {
    const browser = await createBrowser();
    const env = getRelevantRealm(browser.window).env;
    env.userAgent.storagePersistence.setPermission(env.origin, 'granted');
    const shelf = StorageShelf.obtainLocal(env)!;
    const bucket = shelf.bucketMap.get('default') as LocalStorageBucket;
    if (kind === 'read') vi.spyOn(shelf.bucketMap, 'get').mockImplementation(() => { throw new Error('Storage read failed'); });
    else if (kind === 'write') Object.freeze(bucket);
    else shelf.bucketMap.delete('default');
    expect(await browser.evaluate(() => navigator.storage.persist())).toBe(false);
    expect(env.userAgent.storagePersistence.getPermission(env.origin)).toBe('granted');
  });

  it('reports an already-protected bucket even when the permission request is denied', async () => {
    const browser = await createBrowser();
    const env = getRelevantRealm(browser.window).env;
    const bucket = StorageShelf.obtainLocal(env)!.bucketMap.get('default') as LocalStorageBucket;
    bucket.mode = 'persistent';
    // Low-level store bookkeeping does not run revocation cleanup.
    env.userAgent.permissionStore.setEntry({ name: 'persistent-storage' }, env.origin, 'denied');
    expect(await browser.evaluate(() => navigator.storage.persist())).toBe(true);
    expect(env.userAgent.storagePersistence.getPermission(env.origin)).toBe('denied');
  });

  it.each(['prompt', 'granted'] as const)('uses the existing request eligibility rules with cross-origin %s state', async (state) => {
    const permissionPrompt = vi.fn(() => true);
    const browser = await createBrowser({ permissionPrompt });
    const env = getRelevantRealm(browser.window).env;
    env.topLevelOrigin = obtainURLOrigin(parseURL('https://embedder.test/').url!);
    env.userAgent.storagePersistence.setPermission(env.origin, state);
    expect(await browser.evaluate(() => navigator.storage.persist())).toBe(state === 'granted');
    expect(permissionPrompt).not.toHaveBeenCalled();
    expect(env.userAgent.storagePersistence.getPermission(env.origin)).toBe(state);
  });

  it('uses the receiver environment and keeps another browser isolated when the method is borrowed', async () => {
    const first = await createBrowser({ permissionPrompt: () => true });
    const second = await createBrowser({ permissionPrompt: () => false });
    const firstManager = first.window.navigator.storage;
    const secondManager = second.window.navigator.storage;
    const result = second.window.StorageManager.prototype.persist.call(firstManager);
    expect(result).toBeInstanceOf(getRelevantRealm(first.window).NativePromise);
    expect(await result).toBe(true);
    expect(await first.window.StorageManager.prototype.persist.call(secondManager)).toBe(false);
    expect(await first.evaluate(() => navigator.storage.persisted())).toBe(true);
    expect(await second.evaluate(() => navigator.storage.persisted())).toBe(false);
  });
});

async function createBrowser(config: Partial<BrowletConfig> = {}) {
  const browser = new Browlet({ route: () => '', ...config });
  await browser.navigate('https://example.test/');
  return browser;
}
