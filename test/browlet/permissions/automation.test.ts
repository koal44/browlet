import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { type PermissionState } from '../../../src/permissions/index';
import { StorageBottle, StorageShelf } from '../../../src/storage/index';
import { obtainURLOrigin, parseURL } from '../../../src/url/index';
import { getRelevantRealm } from '../../support/browlet-binding';

const descriptor = { name: 'persistent-storage' };

describe('Permissions Appendix B: browser integration', () => {
  it.each(['granted', 'denied', 'prompt'] as const)('exposes a recorded %s decision after navigating to its origin', async (state) => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    const key = obtainURLOrigin(parseURL('https://example.test/').url!);
    await env.userAgent.setPermission(descriptor, state, key, [env]);
    expect(env.userAgent.permissionStore.getEntry(descriptor, key)?.state).toBe(state);
    await browser.navigate('https://example.test/');
    expect(await browser.evaluate(async () => (await navigator.permissions.query({ name: 'persistent-storage' })).state)).toBe(state);
  });

  it('delivers live status changes through author code without adding a public permission setter', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/');
    const env = getRelevantRealm(browser.window).env;
    const prompt = vi.spyOn(env.userAgent, 'promptForPermission');
    await browser.exposeFunction('automatePermission', (state: PermissionState) =>
      new Promise<void>((resolve, reject) => {
        env.userAgent.setPermission(descriptor, state, env.origin, [env]).observe(resolve, reject);
      }));

    expect(await browser.evaluate(async () => {
      const host = window as unknown as { automatePermission(state: PermissionState): Promise<void>; };
      const status = await navigator.permissions.query({ name: 'persistent-storage' });
      const events: [string, boolean, boolean][] = [];
      for (const state of ['granted', 'denied', 'prompt'] as const) {
        const changed = new Promise<void>((resolve) => {
          status.onchange = (event) => {
            events.push([status.state, event.isTrusted, event.target === status]);
            resolve();
          };
        });
        await host.automatePermission(state);
        await changed;
      }
      status.onchange = null;
      return { events, exposesSetter: 'setPermission' in navigator.permissions };
    })).toEqual({ events: [['granted', true, true], ['denied', true, true], ['prompt', true, true]], exposesSetter: false });
    expect(prompt).not.toHaveBeenCalled();
  });

  it('removes persistence protection on denial while preserving data and other browsers', async () => {
    const browser = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/');
    await other.navigate('https://example.test/');
    const env = getRelevantRealm(browser.window).env;
    const otherEnv = getRelevantRealm(other.window).env;
    const local = StorageBottle.obtainLocalMap(env, 'localStorage')!;
    local.set('saved', 'value');
    for (const target of [env, otherEnv]) {
      StorageShelf.obtainLocal(target);
      target.userAgent.storagePersistence.setPermission(target.origin, 'granted');
      expect(target.userAgent.storagePersistence.persist(target.origin)).toBe(true);
    }
    await env.userAgent.setPermission(descriptor, 'denied', env.origin, [env, otherEnv]);
    expect(await browser.evaluate(() => navigator.storage.persisted())).toBe(false);
    expect(await other.evaluate(() => navigator.storage.persisted())).toBe(true);
    expect(await browser.evaluate(async () => (await navigator.permissions.query({ name: 'persistent-storage' })).state)).toBe('denied');
    expect(local.get('saved')).toBe('value');
  });

  it('keeps secure-context restrictions even when automation records a grant', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('http://example.test/');
    const env = getRelevantRealm(browser.window).env;
    await env.userAgent.setPermission(descriptor, 'granted', env.origin, [env]);
    expect(env.userAgent.permissionStore.getEntry(descriptor, env.origin)?.state).toBe('granted');
    expect(await browser.evaluate(async () => (await navigator.permissions.query({ name: 'persistent-storage' })).state)).toBe('denied');
  });
});
