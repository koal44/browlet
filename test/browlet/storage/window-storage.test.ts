import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { BrowsingContext, Navigable, TopLevelTraversable, DocumentState } from '../../../src/browlet/browsing/navigation/index';
import type { Window as WindowPlatform } from '../../../src/browlet/platform';
import type { StorageImpl } from '../../../src/browlet/storage/index';
import { StorageBottle } from '../../../src/storage/index';
import { obtainURLOrigin, parseURL } from '../../../src/url/index';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';

describe('HTML §§12.2.2–12.2.3: Window storage getters', () => {
  it.each(['http://example.test/', 'https://example.test/'])('lazily acquires distinct, stable Storage objects at %s', async (url) => {
    const browser = await createBrowser(url);
    const { env } = getRelevantRealm(browser.window);
    const document = env.window.document;
    expect([document.sessionStorageHolder, document.localStorageHolder]).toEqual([null, null]);
    expect(env.userAgent.storageShed.size).toBe(0);
    expect(env.getSessionStorageShed().size).toBe(0);

    expect(await browser.evaluate(() => {
      const local = localStorage;
      const session = sessionStorage;
      return [local === window.localStorage, session === window.sessionStorage, local !== session,
        local instanceof Storage, session instanceof Storage, local.length, session.length,
        'WindowLocalStorage' in globalThis, 'WindowSessionStorage' in globalThis];
    })).toEqual([true, true, true, true, true, 0, 0, false, false]);
    expect(document.localStorageHolder).toBe(unwrap(browser.window.localStorage));
    expect(document.sessionStorageHolder).toBe(unwrap(browser.window.sessionStorage));
    expect(document.localStorageHolder!.type).toBe('local');
    expect(document.sessionStorageHolder!.type).toBe('session');
  });

  it('reads the existing local and session bottles through the public getters', async () => {
    const browser = await createBrowser();
    const { env } = getRelevantRealm(browser.window);
    const local = StorageBottle.obtainLocalMap(env, 'localStorage')!;
    const session = StorageBottle.obtainSessionMap(env, 'sessionStorage')!;
    local.set('saved', 'local');
    session.set('saved', 'session');
    expect(await browser.evaluate(() => [localStorage.getItem('saved'), sessionStorage.getItem('saved')]))
      .toEqual(['local', 'session']);
    local.set('saved', 'changed');
    session.clear();
    expect(await browser.evaluate(() => [localStorage.getItem('saved'), sessionStorage.length]))
      .toEqual(['changed', 0]);
  });

  it('rejects an opaque origin with SecurityError without retaining either holder', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => ['sessionStorage', 'localStorage'].map((name) => {
      try { Reflect.get(window, name); } catch (error) {
        return error instanceof DOMException && error.name === 'SecurityError';
      }
      return false;
    }))).toEqual([true, true]);
    const { env } = getRelevantRealm(browser.window);
    expect([env.window.document.sessionStorageHolder, env.window.document.localStorageHolder]).toEqual([null, null]);
    expect(env.userAgent.storageShed.size).toBe(0);
    expect(env.getSessionStorageShed().size).toBe(0);
  });

  it('retries failed acquisition when storage is enabled and subsequently returns the cached holders', async () => {
    const browser = await createBrowser();
    const { env } = getRelevantRealm(browser.window);
    env.userAgent.storageEnabled = false;
    expect(await browser.evaluate(() => ['sessionStorage', 'localStorage'].map((name) => {
      try { Reflect.get(window, name); } catch (error) {
        return error instanceof DOMException && error.name === 'SecurityError';
      }
      return false;
    }))).toEqual([true, true]);
    expect([env.window.document.sessionStorageHolder, env.window.document.localStorageHolder]).toEqual([null, null]);
    expect(env.userAgent.storageShed.size).toBe(0);
    expect(env.getSessionStorageShed().size).toBe(0);

    env.userAgent.storageEnabled = true;
    await browser.evaluate(() => {
      Reflect.set(globalThis, 'savedLocal', localStorage);
      Reflect.set(globalThis, 'savedSession', sessionStorage);
    });
    env.userAgent.storageEnabled = false;
    // Both specified getters return an existing holder before attempting acquisition.
    expect(await browser.evaluate(() => [
      localStorage === Reflect.get(globalThis, 'savedLocal'), sessionStorage === Reflect.get(globalThis, 'savedSession'),
    ])).toEqual([true, true]);
  });

  it.each(['localStorage', 'sessionStorage'] as const)('keeps %s readonly and rejects an incompatible receiver', async (name) => {
    const browser = await createBrowser();
    expect(await browser.evaluate((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(window, name)!;
      const storage = window[name];
      let invalidReceiver = false;
      try { descriptor.get!.call({}); } catch (error) { invalidReceiver = error instanceof TypeError; }
      return [descriptor.enumerable, descriptor.configurable, descriptor.set === undefined,
        Reflect.set(window, name, 'replacement'), window[name] === storage, invalidReceiver];
    }, name)).toEqual([true, true, true, false, true, true]);
  });

  it.each(['localStorage', 'sessionStorage'] as const)('acquires %s in a borrowed getter receiver\'s realm', async (name) => {
    const caller = await createBrowser();
    const owner = await createBrowser();
    Reflect.set(caller.window, 'otherWindow', owner.window);
    expect(await caller.evaluate((name) => {
      const other = Reflect.get(globalThis, 'otherWindow') as WindowPlatform;
      const descriptor = Object.getOwnPropertyDescriptor(window, name)!;
      const storage = descriptor.get!.call(other) as Storage;
      return [storage === other[name], storage instanceof other.Storage, storage instanceof Storage, storage !== window[name]];
    }, name)).toEqual([true, true, false, true]);
    const implementation = unwrap<StorageImpl>(owner.window[name]);
    expect(implementation.env).toBe(getRelevantRealm(owner.window).env);
  });

  it('rejects cross-origin receivers through the getter binding', async () => {
    const caller = await createBrowser();
    const other = await createBrowser('https://other.test/');
    Reflect.set(caller.window, 'otherWindow', other.window);
    expect(await caller.evaluate(() => ['sessionStorage', 'localStorage'].map((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(window, name)!;
      try { descriptor.get!.call(Reflect.get(globalThis, 'otherWindow')); } catch (error) {
        return error instanceof DOMException && error.name === 'SecurityError';
      }
      return false;
    }))).toEqual([true, true]);
  });

  it('shares local data across tabs and session data only inside the same traversable', async () => {
    const browser = await createBrowser();
    const { env } = getRelevantRealm(browser.window);
    StorageBottle.obtainLocalMap(env, 'localStorage')!.set('saved', 'browser');
    StorageBottle.obtainSessionMap(env, 'sessionStorage')!.set('saved', 'tab');
    const tab = createRelatedWindow(browser);
    const child = createRelatedWindow(browser, env.window.navigable);
    const separateBrowser = await createBrowser();
    Reflect.set(browser.window, 'otherTab', tab);
    Reflect.set(browser.window, 'childWindow', child);
    Reflect.set(browser.window, 'separateBrowser', separateBrowser.window);
    expect(await browser.evaluate(() => {
      const tab = Reflect.get(globalThis, 'otherTab') as WindowPlatform;
      const child = Reflect.get(globalThis, 'childWindow') as WindowPlatform;
      const separate = Reflect.get(globalThis, 'separateBrowser') as WindowPlatform;
      return {
        local: [tab.localStorage.getItem('saved'), child.localStorage.getItem('saved'), separate.localStorage.getItem('saved')],
        session: [tab.sessionStorage.getItem('saved'), child.sessionStorage.getItem('saved'), separate.sessionStorage.getItem('saved')],
        distinct: [tab.localStorage !== localStorage, child.sessionStorage !== sessionStorage],
      };
    })).toEqual({ local: ['browser', 'browser', null], session: [null, 'tab', null], distinct: [true, true] });
  });

  it.each(['localStorage', 'sessionStorage'] as const)('replaces %s identity across navigation while retaining same-origin data', async (name) => {
    const browser = await createBrowser();
    const previous = browser.window[name];
    const implementation = unwrap<StorageImpl>(previous);
    implementation.map.set('saved', 'value');
    await browser.navigate('https://example.test/next');
    Reflect.set(browser.window, 'previousStorage', previous);
    expect(await browser.evaluate((name) => [
      window[name] !== Reflect.get(globalThis, 'previousStorage'), window[name].getItem('saved'),
    ], name)).toEqual([true, 'value']);
    unwrap<StorageImpl>(browser.window[name]).map.set('saved', 'updated');
    expect(previous.getItem('saved')).toBe('updated');
    await browser.navigate('https://other.test/');
    expect(await browser.evaluate((name) => window[name].length, name)).toBe(0);
    expect(previous.getItem('saved')).toBe('updated');
  });

  it('replaces both holders when an initial Document is replaced but its Window is reused', async () => {
    const browser = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browser.window);
    // Supply an inherited origin while creator browsing-context setup remains unfinished.
    realm.windowImplementation.document.origin = obtainURLOrigin(parseURL('https://example.test/').url!);
    const local = browser.window.localStorage;
    const session = browser.window.sessionStorage;
    const oldDocument = realm.windowImplementation.document;
    unwrap<StorageImpl>(session).map.set('saved', 'session');
    await browser.navigate('https://example.test/');

    expect(getRelevantRealm(browser.window)).toBe(realm);
    expect(realm.windowImplementation.document).not.toBe(oldDocument);
    expect(browser.window.localStorage).not.toBe(local);
    expect(browser.window.sessionStorage).not.toBe(session);
    expect(oldDocument.localStorageHolder).toBe(unwrap(local));
    expect(oldDocument.sessionStorageHolder).toBe(unwrap(session));
    expect(await browser.evaluate(() => sessionStorage.getItem('saved'))).toBe('session');
  });
});

async function createBrowser(url = 'https://example.test/') {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate(url);
  return browser;
}

/** Compose a same-origin tab or child while automatic iframe creation remains unfinished. */
function createRelatedWindow(browser: Browlet, parent: Navigable | null = null) {
  const { env } = getRelevantRealm(browser.window);
  const [, document] = BrowsingContext.createTopLevel(env.userAgent);
  document.url = env.window.document.url;
  document.origin = env.origin;
  const state = DocumentState.create(document);
  const navigable = parent === null ? new TopLevelTraversable(state) : new Navigable(state, parent);
  return navigable.activeWindowProxy.platform;
}
