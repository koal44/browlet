import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { StorageShelf } from '../../../src/storage/index';
import { getRelevantRealm } from '../../support/browlet-binding';

describe('Storage §6: shelf quota policy', () => {
  it.each([
    [undefined, 64 * 2 ** 20],
    [0, 0],
    [1024, 1024],
  ])('configures the browser budget from %s bytes', async (configured, expected) => {
    const browser = new Browlet({ route: () => '', storageQuotaBytes: configured });
    await browser.navigate('https://example.test/');
    const env = getRelevantRealm(browser.window).env;
    expect(env.userAgent.storageQuotaBytes).toBe(expected);
    // A zero budget does not disable storage-key acquisition or reads.
    expect(StorageShelf.obtainLocal(env)).not.toBeNull();
    expect(StorageShelf.obtain(env.getSessionStorageShed(), env, 'session')).not.toBeNull();
    expect(env.userAgent.storageEnabled).toBe(true);
  });

  it('retains the budget across navigation and keeps it independent of stored data and other browsers', async () => {
    const browser = new Browlet({ route: () => '', storageQuotaBytes: 32 });
    await browser.navigate('https://example.test/first');
    const firstEnv = getRelevantRealm(browser.window).env;
    const firstShelf = StorageShelf.obtainLocal(firstEnv)!;
    firstShelf.bucketMap.get('default')!.bottleMap.get('localStorage')!.map.set('key', '123');
    expect(firstShelf.usage).toBe(12);
    expect(firstEnv.userAgent.storageQuotaBytes).toBe(32);
    expect(firstShelf.bucketMap.get('default')!.bottleMap.get('localStorage')!.quota).toBe(5 * 2 ** 20);

    await browser.navigate('https://example.test/second');
    const nextEnv = getRelevantRealm(browser.window).env;
    expect(nextEnv).not.toBe(firstEnv);
    expect(nextEnv.userAgent).toBe(firstEnv.userAgent);
    expect(StorageShelf.obtainLocal(nextEnv)).toBe(firstShelf);
    expect(nextEnv.userAgent.storageQuotaBytes).toBe(32);

    await browser.navigate('https://other.test/');
    const otherOriginEnv = getRelevantRealm(browser.window).env;
    const otherShelf = StorageShelf.obtainLocal(otherOriginEnv)!;
    expect(otherShelf).not.toBe(firstShelf);
    expect(otherShelf.usage).toBe(0);
    expect(otherOriginEnv.userAgent.storageQuotaBytes).toBe(32);

    const otherBrowser = new Browlet({ route: () => '', storageQuotaBytes: 8 });
    const otherUserAgent = getRelevantRealm(otherBrowser.window).env.userAgent;
    expect(otherUserAgent).not.toBe(firstEnv.userAgent);
    expect(otherUserAgent.storageQuotaBytes).toBe(8);
    expect(firstEnv.userAgent.storageQuotaBytes).toBe(32);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid byte budget: %s', (quota) => {
    expect(() => new Browlet({ route: () => '', storageQuotaBytes: quota }))
      .toThrow('storageQuotaBytes must be a non-negative safe integer');
  });
});
