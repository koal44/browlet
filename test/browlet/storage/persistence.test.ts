import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { type LocalStorageBucket, StorageBottle, StorageShelf } from '../../../src/storage/index';
import { getRelevantRealm } from '../../support/browlet-binding';

describe('Storage §5: browser persistence ownership', () => {
  it('retains origin-wide decisions across navigation and revokes without clearing local or session data', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    const firstEnv = getRelevantRealm(browser.window).env;
    const persistence = firstEnv.userAgent.storagePersistence;
    const shelf = StorageShelf.obtainLocal(firstEnv)!;
    const bucket = shelf.bucketMap.get('default') as LocalStorageBucket;
    const local = StorageBottle.obtainLocalMap(firstEnv, 'localStorage')!;
    const session = StorageBottle.obtainSessionMap(firstEnv, 'sessionStorage')!;
    local.set('saved', 'local value');
    session.set('saved', 'session value');
    persistence.setPermission(firstEnv.origin, 'granted');
    expect(persistence.persist(firstEnv.origin)).toBe(true);

    await browser.navigate('https://example.test/second');
    const nextEnv = getRelevantRealm(browser.window).env;
    expect(nextEnv).not.toBe(firstEnv);
    expect(nextEnv.userAgent.storagePersistence.getPermission(nextEnv.origin)).toBe('granted');
    expect(StorageShelf.obtainLocal(nextEnv)).toBe(shelf);
    persistence.setPermission(nextEnv.origin, 'prompt');
    expect(bucket.mode).toBe('best-effort');
    expect(persistence.getPermission(firstEnv.origin)).toBe('prompt');
    expect(StorageBottle.obtainLocalMap(nextEnv, 'localStorage')!.get('saved')).toBe('local value');
    expect(StorageBottle.obtainSessionMap(nextEnv, 'sessionStorage')!.get('saved')).toBe('session value');

    await browser.navigate('https://other.test/');
    const otherEnv = getRelevantRealm(browser.window).env;
    persistence.setPermission(otherEnv.origin, 'granted');
    expect(persistence.getPermission(firstEnv.origin)).toBe('prompt');
    expect(bucket.mode).toBe('best-effort');
  });
});
