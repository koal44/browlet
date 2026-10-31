import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { StorageShelf } from '../../../src/storage/index';
import { getRelevantRealm } from '../../support/browlet-binding';

describe('Storage §4.4: browser shelf acquisition', () => {
  it('reacquires a shelf from new same-origin settings and keeps other origins separate', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    const firstEnv = getRelevantRealm(browser.window).env;
    const shelf = StorageShelf.obtainLocal(firstEnv)!;
    const bottle = shelf.bucketMap.get('default')!.bottleMap.get('localStorage')!;
    bottle.map.set('saved', 'value');

    await browser.navigate('https://example.test/second');
    const nextEnv = getRelevantRealm(browser.window).env;
    expect(nextEnv).not.toBe(firstEnv);
    expect(StorageShelf.obtainLocal(nextEnv)).toBe(shelf);

    await browser.navigate('https://other.test/');
    const otherShelf = StorageShelf.obtainLocal(getRelevantRealm(browser.window).env)!;
    expect(otherShelf).not.toBe(shelf);
    expect(otherShelf.bucketMap.get('default')!.bottleMap.get('localStorage')!.map.size).toBe(0);

    await browser.navigate('https://example.test/return');
    expect(StorageShelf.obtainLocal(getRelevantRealm(browser.window).env)).toBe(shelf);
    expect(bottle.map.get('saved')).toBe('value');
    expect(firstEnv.userAgent.storageShed.size).toBe(2);
  });

  it('rejects opaque Window settings and observes the browser\'s current storage preference', async () => {
    const browser = new Browlet({ route: () => '' });
    const initialEnv = getRelevantRealm(browser.window).env;
    expect(initialEnv.origin.kind).toBe('opaque');
    expect(StorageShelf.obtainLocal(initialEnv)).toBeNull();
    expect(initialEnv.userAgent.storageShed.size).toBe(0);

    await browser.navigate('https://example.test/');
    const env = getRelevantRealm(browser.window).env;
    const shelf = StorageShelf.obtainLocal(env)!;
    expect(shelf).not.toBeNull();
    env.userAgent.storageEnabled = false;
    expect(StorageShelf.obtainLocal(env)).toBeNull();
    env.userAgent.storageEnabled = true;
    expect(StorageShelf.obtainLocal(env)).toBe(shelf);
    expect([...env.userAgent.storageShed.values()]).toEqual([shelf]);
  });
});
