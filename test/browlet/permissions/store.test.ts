import { describe, expect, it } from 'vitest';

import { persistentStoragePermission } from '../../../src/storage/index';
import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../support/browlet-binding';

describe('Permissions §3.2: user-agent store ownership', () => {
  it('retains one store through navigation and keeps different browsers isolated', async () => {
    const browser = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    await other.navigate('https://example.test/');
    const firstEnv = getRelevantRealm(browser.window).env;
    const store = firstEnv.userAgent.permissionStore;
    const otherStore = getRelevantRealm(other.window).env.userAgent.permissionStore;
    const descriptor = { name: 'persistent-storage' };
    expect(store.getFeature(descriptor.name)?.key).toBe(persistentStoragePermission.key);
    expect(store.getFeature(descriptor.name)?.defaultState).toBe('prompt');
    expect(store.getFeature('camera')).toBeUndefined();
    store.setEntry(descriptor, firstEnv.origin, 'granted');

    await browser.navigate('https://example.test/second');
    const nextEnv = getRelevantRealm(browser.window).env;
    expect(nextEnv).not.toBe(firstEnv);
    expect(nextEnv.userAgent.permissionStore).toBe(store);
    expect(store.getEntry(descriptor, nextEnv.origin)?.state).toBe('granted');
    expect(otherStore).not.toBe(store);
    expect(otherStore.getEntry(descriptor, nextEnv.origin)).toBeNull();

    await browser.navigate('https://other.test/');
    const foreignEnv = getRelevantRealm(browser.window).env;
    expect(foreignEnv.userAgent.permissionStore).toBe(store);
    expect(store.getEntry(descriptor, foreignEnv.origin)).toBeNull();
    expect(store.getEntry(descriptor, firstEnv.origin)?.state).toBe('granted');
  });
});
