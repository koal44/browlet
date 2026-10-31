import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { StorageShelf } from '../../../src/storage/index';
import { createOpaqueOrigin } from '../../../src/url/index';
import type { GlobalObject } from '../../../src/js-engine/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { observeBrowletPromise, performTestMicrotaskCheckpoint } from '../test-runtime';

afterEach(() => { vi.restoreAllMocks(); });

describe('Storage §8: NavigatorStorage and persisted()', () => {
  it('exposes stable Navigator/StorageManager identities and reads the initial mode through author code', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(async () => {
      let illegalConstructor = false;
      try { Reflect.construct(StorageManager, []); } catch (error) { illegalConstructor = error instanceof TypeError; }
      const result = navigator.storage.persisted();
      return {
        navigatorIdentity: navigator === window.navigator && navigator === window.clientInformation,
        managerIdentity: navigator.storage === navigator.storage,
        navigatorBrand: navigator instanceof Navigator,
        managerBrand: navigator.storage instanceof StorageManager,
        nativePromise: result instanceof Promise,
        persisted: await result,
        illegalConstructor,
      };
    })).toEqual({
      navigatorIdentity: true, managerIdentity: true, navigatorBrand: true, managerBrand: true,
      nativePromise: true, persisted: false, illegalConstructor: true,
    });
    const env = getRelevantRealm(browser.window).env;
    expect(env.userAgent.storageShed.size).toBe(1);
    expect(env.storageManager.env).toBe(env);
  });

  it('keeps Navigator available but hides storage and StorageManager in non-secure contexts', async () => {
    const browser = await createBrowser('http://example.test/');
    expect(await browser.evaluate(() => ({
      secure: isSecureContext,
      navigator: typeof navigator,
      storage: 'storage' in navigator,
      constructor: typeof StorageManager,
    }))).toEqual({ secure: false, navigator: 'object', storage: false, constructor: 'undefined' });
  });

  it('distinguishes granted permission from bucket protection and observes revocation', async () => {
    const browser = await createBrowser();
    const env = getRelevantRealm(browser.window).env;
    const persistence = env.userAgent.storagePersistence;
    expect(await browser.evaluate(() => navigator.storage.persisted())).toBe(false);
    persistence.setPermission(env.origin, 'granted');
    expect(await browser.evaluate(() => navigator.storage.persisted())).toBe(false);
    expect(persistence.persist(env.origin)).toBe(true);
    expect(await browser.evaluate(() => navigator.storage.persisted())).toBe(true);
    persistence.setPermission(env.origin, 'prompt');
    expect(await browser.evaluate(() => navigator.storage.persisted())).toBe(false);
  });

  it.each(['disabled', 'opaque'] as const)('rejects %s storage with a realm TypeError and no background task', async (reason) => {
    const browser = await createBrowser();
    const env = getRelevantRealm(browser.window).env;
    if (reason === 'disabled') env.userAgent.storageEnabled = false;
    else vi.spyOn(env, 'origin', 'get').mockReturnValue(createOpaqueOrigin());
    const background = vi.spyOn(env, 'runInParallel');
    const delivery = vi.spyOn(env, 'queueStorageTask');
    expect(await browser.evaluate(async () => {
      const result = navigator.storage.persisted();
      try {
        await result;
        return { promise: result instanceof Promise, rejected: false };
      } catch (error) {
        return { promise: result instanceof Promise, rejected: error instanceof TypeError };
      }
    })).toEqual({ promise: true, rejected: true });
    expect(background).not.toHaveBeenCalled();
    expect(delivery).not.toHaveBeenCalled();
    expect(env.userAgent.storageShed.size).toBe(0);
  });

  it('gives replacement settings new objects while retaining the same-origin bucket', async () => {
    const browser = await createBrowser();
    const previousNavigator = browser.window.navigator;
    const previousManager = previousNavigator.storage;
    const env = getRelevantRealm(browser.window).env;
    StorageShelf.obtainLocal(env);
    env.userAgent.storagePersistence.setPermission(env.origin, 'granted');
    expect(env.userAgent.storagePersistence.persist(env.origin)).toBe(true);

    await browser.navigate('https://example.test/second');
    expect(browser.window.navigator).not.toBe(previousNavigator);
    expect(browser.window.navigator.storage).not.toBe(previousManager);
    expect(await browser.evaluate(() => navigator.storage.persisted())).toBe(true);

    await browser.navigate('https://other.test/');
    expect(await browser.evaluate(() => navigator.storage.persisted())).toBe(false);
  });

  it('uses the receiver settings when another realm supplies the method', async () => {
    const first = await createBrowser();
    const second = await createBrowser();
    const env = getRelevantRealm(first.window).env;
    StorageShelf.obtainLocal(env);
    env.userAgent.storagePersistence.setPermission(env.origin, 'granted');
    expect(env.userAgent.storagePersistence.persist(env.origin)).toBe(true);

    const firstManager = first.window.navigator.storage;
    const secondManager = second.window.navigator.storage;
    expect(await second.window.StorageManager.prototype.persisted.call(firstManager)).toBe(true);
    expect(await first.window.StorageManager.prototype.persisted.call(secondManager)).toBe(false);
  });

  it('reads in background work, then queues the captured result to the relevant global', async () => {
    const browser = await createBrowser();
    const env = getRelevantRealm(browser.window).env;
    const background: (() => void)[] = [];
    const delivery: { global: GlobalObject; steps: () => void; }[] = [];
    vi.spyOn(env, 'runInParallel').mockImplementation((steps) => { background.push(steps); });
    vi.spyOn(env, 'queueStorageTask').mockImplementation((global, steps) => { delivery.push({ global, steps }); });

    const result = browser.window.navigator.storage.persisted();
    const observed = observeBrowletPromise(browser.window, result);
    expect(env.userAgent.storageShed.size).toBe(1);
    expect(background).toHaveLength(1);
    expect(delivery).toHaveLength(0);
    env.userAgent.storagePersistence.setPermission(env.origin, 'granted');
    expect(env.userAgent.storagePersistence.persist(env.origin)).toBe(true);

    background[0]!();
    expect(delivery).toHaveLength(1);
    expect(delivery[0]!.global).toBe(env.realm.globalObject);
    env.userAgent.storagePersistence.setPermission(env.origin, 'denied');
    delivery[0]!.steps();
    performTestMicrotaskCheckpoint(browser.window);
    expect(await observed).toBe(true);
  });

  it('reports an internal bucket read failure as false', async () => {
    const browser = await createBrowser();
    const env = getRelevantRealm(browser.window).env;
    const shelf = StorageShelf.obtainLocal(env)!;
    vi.spyOn(shelf.bucketMap, 'get').mockImplementation(() => { throw new Error('Storage read failed'); });
    expect(await browser.evaluate(() => navigator.storage.persisted())).toBe(false);
  });
});

async function createBrowser(url = 'https://example.test/') {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate(url);
  return browser;
}
