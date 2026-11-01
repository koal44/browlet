import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { StorageImpl } from '../../../src/browlet/storage/index';
import { StorageBottle } from '../../../src/storage/index';
import { getBindingContext, getRelevantRealm } from '../../support/browlet-binding';

describe('HTML WindowEventHandlers: onstorage', () => {
  it('starts null, preserves callback identity, and treats primitive assignments as null', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const initial = onstorage;
      const handler = () => {};
      window.onstorage = handler;
      const identical = onstorage === handler;
      const cleared = [null, undefined, false, 0, 'source text', Symbol()]
        .map((value) => {
          window.onstorage = handler;
          Reflect.set(window, 'onstorage', value);
          return onstorage === null;
        });
      return [initial, identical, cleared, 'WindowEventHandlers' in globalThis];
    })).toEqual([null, true, [true, true, true, true, true, true], false]);
  });

  it('preserves listener position on replacement and appends again after deactivation', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const trace: string[] = [];
      addEventListener('storage', () => { trace.push('before'); });
      onstorage = () => { trace.push('old'); };
      addEventListener('storage', () => { trace.push('after'); });
      const replacement = () => { trace.push('replacement'); };
      onstorage = replacement;
      const identical = onstorage === replacement;
      dispatchEvent(new StorageEvent('storage'));
      onstorage = null;
      dispatchEvent(new StorageEvent('storage'));
      onstorage = () => { trace.push('reactivated'); };
      dispatchEvent(new StorageEvent('storage'));
      return [identical, trace];
    })).toEqual([true, ['before', 'replacement', 'after', 'before', 'after', 'before', 'after', 'reactivated']]);
  });

  it('uses the ordinary handler return-value rules for cancelable synthetic events', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      onstorage = () => false;
      const cancelable = new StorageEvent('storage', { cancelable: true });
      const ordinary = new StorageEvent('storage');
      const canceled = dispatchEvent(cancelable);
      const unchanged = dispatchEvent(ordinary);
      onstorage = () => 0;
      const other = new StorageEvent('storage', { cancelable: true });
      return [canceled, cancelable.defaultPrevented, unchanged, ordinary.defaultPrevented,
        dispatchEvent(other), other.defaultPrevented];
    })).toEqual([false, true, true, false, true, false]);
  });

  it('receives queued trusted changes with the recipient Storage object', async () => {
    const browser = await createBrowser();
    const { env } = getRelevantRealm(browser.window);
    const peer = getBindingContext(env.realm).project(StorageImpl,
      new StorageImpl(StorageBottle.obtainLocalMap(env, 'localStorage')!, 'local', env));
    Reflect.set(browser.window, 'peerStorage', peer);

    expect(await browser.evaluate(() => new Promise((resolve) => {
      let returned = false;
      onstorage = function(event) {
        resolve([returned, event instanceof StorageEvent, event.isTrusted,
          event.key, event.oldValue, event.newValue, event.url,
          event.storageArea === Reflect.get(globalThis, 'peerStorage'),
          event.storageArea !== localStorage, this === window]);
        onstorage = null;
      };
      localStorage.setItem('key', 'value');
      returned = true;
    }))).toEqual([true, true, true, 'key', null, 'value', 'https://example.test/', true, true, true]);
  });

  it('keeps handler state on the receiver when borrowing another Window\'s setter', async () => {
    const first = await createBrowser();
    const second = await createBrowser();
    Reflect.set(second.window, 'otherWindow', first.window);
    expect(await second.evaluate(() => {
      const target = Reflect.get(globalThis, 'otherWindow') as Window;
      const trace: string[] = [];
      const handler = (event: StorageEvent) => { trace.push(event.key!); };
      Object.getOwnPropertyDescriptor(window, 'onstorage')!.set!.call(target, handler);
      target.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
      dispatchEvent(new StorageEvent('storage', { key: 'own' }));
      return [target.onstorage === handler, onstorage === null, trace];
    })).toEqual([true, true, ['other']]);
  });

  it('does not activate storage delivery merely by installing a handler', async () => {
    const browser = await createBrowser();
    const { env } = getRelevantRealm(browser.window);
    await browser.evaluate(() => { onstorage = () => {}; });
    expect(env.window.document.localStorageHolder).toBeNull();
    expect(env.window.document.sessionStorageHolder).toBeNull();
    expect(env.userAgent.storageShed.size).toBe(0);
  });
});

async function createBrowser() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/');
  return browser;
}
