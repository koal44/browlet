import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet, type BrowletConfig } from '../../../src/browlet/browlet';
import type { GlobalObject } from '../../../src/js-engine/index';
import { StorageBottle, StorageBucket, StorageShelf } from '../../../src/storage/index';
import { createOpaqueOrigin } from '../../../src/url/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { observeBrowletPromise, performTestMicrotaskCheckpoint } from '../test-runtime';

afterEach(() => { vi.restoreAllMocks(); });

describe('Storage §8: estimate()', () => {
  it.each([undefined, 0, 1024])('returns a realm-owned dictionary and the configured %s byte quota', async (storageQuotaBytes) => {
    const permissionPrompt = vi.fn(() => true);
    const browser = await createBrowser({ storageQuotaBytes, permissionPrompt });
    expect(await browser.evaluate(async () => {
      const result = navigator.storage.estimate();
      const estimate = await result;
      return {
        promise: result instanceof Promise,
        ownRealm: Object.getPrototypeOf(estimate) === Object.prototype,
        keys: Object.keys(estimate).sort(),
        estimate,
        constructorExposed: 'StorageEstimate' in globalThis,
      };
    })).toEqual({
      promise: true, ownRealm: true, keys: ['quota', 'usage'],
      estimate: { usage: 0, quota: storageQuotaBytes ?? 64 * 2 ** 20 }, constructorExposed: false,
    });
    const env = getRelevantRealm(browser.window).env;
    expect(env.userAgent.permissionStore.size).toBe(0);
    expect(permissionPrompt).not.toHaveBeenCalled();
    expect(await browser.evaluate(() => navigator.storage.persisted())).toBe(false);
  });

  it('measures current local buckets, excludes session data, and leaves over-quota values intact', async () => {
    const browser = await createBrowser({ storageQuotaBytes: 1 });
    const env = getRelevantRealm(browser.window).env;
    // HTML's Storage facade is still pending; seed its existing backing maps.
    const local = StorageBottle.obtainLocalMap(env, 'localStorage')!;
    local.set('a', '\u{1F600}');
    StorageBottle.obtainSessionMap(env, 'sessionStorage')!.set('session', 'excluded');
    const extra = StorageBucket.create('local');
    extra.bottleMap.get('localStorage')!.map.set('\u00E9', '\u754C');
    StorageShelf.obtainLocal(env)!.bucketMap.set('extra', extra);

    const first = await browser.evaluate(() => navigator.storage.estimate());
    expect(first).toEqual({ usage: 10, quota: 1 });
    local.set('a', 'x');
    expect(await browser.evaluate(() => navigator.storage.estimate())).toEqual({ usage: 8, quota: 1 });
    extra.clear();
    expect(await browser.evaluate(() => navigator.storage.estimate())).toEqual({ usage: 4, quota: 1 });
    local.clear();
    expect(await browser.evaluate(() => navigator.storage.estimate())).toEqual({ usage: 0, quota: 1 });
    expect(first).toEqual({ usage: 10, quota: 1 });
  });

  it('returns independent mutable snapshots without exposing the backing state', async () => {
    const browser = await createBrowser({ storageQuotaBytes: 64 });
    expect(await browser.evaluate(async () => {
      const first = await navigator.storage.estimate();
      first.usage = 100;
      first.quota = 200;
      const second = await navigator.storage.estimate();
      return { independent: first !== second, first, second };
    })).toEqual({ independent: true, first: { usage: 100, quota: 200 }, second: { usage: 0, quota: 64 } });
  });

  it('retains same-origin usage through navigation and isolates other origins and browsers', async () => {
    const browser = await createBrowser({ storageQuotaBytes: 32 });
    const env = getRelevantRealm(browser.window).env;
    StorageBottle.obtainLocalMap(env, 'localStorage')!.set('key', '123');
    await browser.navigate('https://example.test/next');
    expect(await browser.evaluate(() => navigator.storage.estimate())).toEqual({ usage: 12, quota: 32 });
    await browser.navigate('https://other.test/');
    expect(await browser.evaluate(() => navigator.storage.estimate())).toEqual({ usage: 0, quota: 32 });
    const other = await createBrowser({ storageQuotaBytes: 16 });
    expect(await other.evaluate(() => navigator.storage.estimate())).toEqual({ usage: 0, quota: 16 });
  });

  it.each(['disabled', 'opaque'] as const)('rejects %s storage before background work with a realm TypeError', async (reason) => {
    const browser = await createBrowser();
    const env = getRelevantRealm(browser.window).env;
    if (reason === 'disabled') env.userAgent.storageEnabled = false;
    else vi.spyOn(env, 'origin', 'get').mockReturnValue(createOpaqueOrigin());
    const background = vi.spyOn(env, 'runInParallel');
    const delivery = vi.spyOn(env, 'queueStorageTask');
    expect(await browser.evaluate(async () => {
      const result = navigator.storage.estimate();
      try { await result; return false; }
      catch (error) { return result instanceof Promise && error instanceof TypeError; }
    })).toBe(true);
    expect(background).not.toHaveBeenCalled();
    expect(delivery).not.toHaveBeenCalled();
    expect(env.userAgent.storageShed.size).toBe(0);
  });

  it.each(['usage', 'quota', 'unimplemented endpoint'] as const)('rejects %s accounting failures through the storage task', async (failure) => {
    const browser = await createBrowser();
    const env = getRelevantRealm(browser.window).env;
    const shelf = StorageShelf.obtainLocal(env)!;
    if (failure === 'usage') vi.spyOn(shelf, 'usage', 'get').mockImplementation(() => { throw new Error('Read failed'); });
    else if (failure === 'quota') Object.defineProperty(env.userAgent, 'storageQuotaBytes', { get() { throw new Error('Quota failed'); } });
    else shelf.bucketMap.get('default')!.bottleMap.get('indexedDB')!.map.set('unmeasured', {});
    const delivery: { global: GlobalObject; steps: () => void; }[] = [];
    const queued = Promise.withResolvers<void>();
    vi.spyOn(env, 'queueStorageTask').mockImplementation((global, steps) => { delivery.push({ global, steps }); queued.resolve(); });
    const result = browser.window.navigator.storage.estimate();
    let complete = false;
    const observed = observeBrowletPromise(browser.window, result).then(
      () => { complete = true; return null; }, (error: unknown) => { complete = true; return error; });
    await queued.promise;
    expect(complete).toBe(false);
    expect(delivery).toHaveLength(1);
    expect(delivery[0]!.global).toBe(env.realm.globalObject);
    delivery[0]!.steps();
    performTestMicrotaskCheckpoint(browser.window);
    expect(await observed).toBeInstanceOf(env.realm.TypeError);
  });

  it('takes the snapshot in background work and delivers the captured numbers later', async () => {
    const browser = await createBrowser({ storageQuotaBytes: 32 });
    const env = getRelevantRealm(browser.window).env;
    const local = StorageBottle.obtainLocalMap(env, 'localStorage')!;
    const background: (() => void)[] = [];
    const delivery: { global: GlobalObject; steps: () => void; }[] = [];
    vi.spyOn(env, 'runInParallel').mockImplementation((steps) => { background.push(steps); });
    vi.spyOn(env, 'queueStorageTask').mockImplementation((global, steps) => { delivery.push({ global, steps }); });
    const result = browser.window.navigator.storage.estimate();
    const observed = observeBrowletPromise(browser.window, result);
    let complete = false;
    void observed.then(() => { complete = true; });
    expect(background).toHaveLength(1);
    expect(delivery).toHaveLength(0);
    local.set('a', 'b');
    env.userAgent.storageQuotaBytes = 64;
    background[0]!();
    expect(delivery).toHaveLength(1);
    expect(delivery[0]!.global).toBe(env.realm.globalObject);
    local.clear();
    env.userAgent.storageQuotaBytes = 128;
    await Promise.resolve();
    expect(complete).toBe(false);
    delivery[0]!.steps();
    performTestMicrotaskCheckpoint(browser.window);
    expect(await observed).toEqual({ usage: 4, quota: 64 });
  });

  it('allocates borrowed-method results and errors in the receiver realm', async () => {
    const first = await createBrowser({ storageQuotaBytes: 16 });
    const second = await createBrowser({ storageQuotaBytes: 32 });
    const env = getRelevantRealm(first.window).env;
    StorageBottle.obtainLocalMap(env, 'localStorage')!.set('a', 'b');
    const result = second.window.StorageManager.prototype.estimate.call(first.window.navigator.storage);
    expect(result).toBeInstanceOf(env.realm.NativePromise);
    const estimate = await observeBrowletPromise(first.window, result);
    expect(estimate).toEqual({ usage: 4, quota: 16 });
    expect(Object.getPrototypeOf(estimate)).toBe(env.realm.Object.prototype);
    expect(await observeBrowletPromise(second.window,
      first.window.StorageManager.prototype.estimate.call(second.window.navigator.storage))).toEqual({ usage: 0, quota: 32 });
    env.userAgent.storageEnabled = false;
    const rejected = observeBrowletPromise(first.window,
      second.window.StorageManager.prototype.estimate.call(first.window.navigator.storage));
    performTestMicrotaskCheckpoint(first.window);
    await expect(rejected).rejects.toBeInstanceOf(env.realm.TypeError);
  });
});

async function createBrowser(config: Partial<BrowletConfig> = {}) {
  const browser = new Browlet({ route: () => '', ...config });
  await browser.navigate('https://example.test/');
  return browser;
}
