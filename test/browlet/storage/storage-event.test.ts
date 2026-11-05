import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { Storage as StoragePlatform } from '../../../src/browlet/platform';
import { StorageEventImpl } from '../../../src/browlet/storage/events/index';
import type { StorageImpl } from '../../../src/browlet/storage/index';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';

describe('HTML §12.2.4: StorageEvent', () => {
  it.each(['http://example.test/', 'https://example.test/'])('exposes the event with default data at %s', async (url) => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate(url);
    expect(await browser.evaluate(() => {
      const event = new StorageEvent('storage');
      return {
        type: event.type, key: event.key, oldValue: event.oldValue, newValue: event.newValue,
        url: event.url, storageArea: event.storageArea,
        flags: [event.bubbles, event.cancelable, event.composed, event.isTrusted],
        event: event instanceof Event, storageEvent: event instanceof StorageEvent,
        parent: Object.getPrototypeOf(StorageEvent.prototype) === Event.prototype,
        tag: Object.prototype.toString.call(event),
        lengths: [StorageEvent.length, StorageEvent.prototype.initStorageEvent.length],
        timeStamp: Number.isFinite(event.timeStamp),
      };
    })).toEqual({
      type: 'storage', key: null, oldValue: null, newValue: null, url: '', storageArea: null,
      flags: [false, false, false, false], event: true, storageEvent: true, parent: true,
      tag: '[object StorageEvent]', lengths: [1, 1], timeStamp: true,
    });
  });

  it('converts constructor data, preserves empty strings, and retains the supplied Storage', async () => {
    const { browser } = await createStorage();
    expect(await browser.evaluate(() => {
      const storage = Reflect.get(globalThis, 'storageUnderTest') as StoragePlatform;
      let conversions = 0;
      const init = {
        key: { toString() { conversions++; return '\ud800'; } },
        oldValue: '', newValue: 123, url: 'not a URL\ud800', storageArea: storage,
        bubbles: true, cancelable: true, composed: true,
      };
      const event = Reflect.construct(StorageEvent, ['storage', init]) as StorageEvent;
      init.oldValue = 'changed after construction';
      return {
        key: event.key, oldValue: event.oldValue, newValue: event.newValue, url: event.url,
        sameStorage: event.storageArea === storage,
        flags: [event.bubbles, event.cancelable, event.composed], conversions,
        nullable: [null, undefined].map((value) => {
          const empty = new StorageEvent('storage', { key: value, oldValue: value, newValue: value, storageArea: value });
          return [empty.key, empty.oldValue, empty.newValue, empty.storageArea];
        }),
        nullDictionary: (Reflect.construct(StorageEvent, ['storage', null]) as StorageEvent).key,
        nullURL: (Reflect.construct(StorageEvent, ['storage', { url: null }]) as StorageEvent).url,
      };
    })).toEqual({
      key: '\ud800', oldValue: '', newValue: '123', url: 'not a URL\ufffd', sameStorage: true,
      flags: [true, true, true], conversions: 1,
      nullable: [[null, null, null, null], [null, null, null, null]], nullDictionary: null, nullURL: 'null',
    });
  });

  it('rejects missing arguments, symbols, and objects that only resemble Storage', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const invalidArgs = [
        [], [Symbol()], ['storage', 1], ['storage', { key: Symbol() }], ['storage', { url: Symbol() }],
        ...[{}, 1, new EventTarget(), Object.create(Storage.prototype) as unknown]
          .map((storageArea) => ['storage', { storageArea }]),
      ];
      return invalidArgs.map((args) => {
        try { Reflect.construct(StorageEvent, args); } catch (error) { return error instanceof TypeError; }
        return false;
      });
    })).toEqual(Array(9).fill(true));
  });

  it('keeps the Storage object in its original realm when another realm creates the event', async () => {
    const { browser: owner, storage } = await createStorage();
    const target = new Browlet({ route: () => '' });
    Reflect.set(target.window, 'storageUnderTest', storage);
    Reflect.set(target.window, 'ownerStorage', owner.window.Storage);
    Reflect.set(target.window, 'ownerStorageEvent', owner.window.StorageEvent);
    expect(await target.evaluate(() => {
      const storage = Reflect.get(globalThis, 'storageUnderTest') as StoragePlatform;
      const OwnerStorage = Reflect.get(globalThis, 'ownerStorage') as typeof Storage;
      const OwnerStorageEvent = Reflect.get(globalThis, 'ownerStorageEvent') as typeof StorageEvent;
      const event = new StorageEvent('storage', { storageArea: storage });
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Borrowing the getter is the behavior under test.
      const borrowed = Object.getOwnPropertyDescriptor(OwnerStorageEvent.prototype, 'storageArea')!.get!;
      return [
        event.storageArea === storage, event.storageArea === event.storageArea,
        event.storageArea instanceof OwnerStorage, event.storageArea instanceof Storage,
        borrowed.call(event) === storage,
      ];
    })).toEqual([true, true, true, false, true]);
  });

  it('exposes readonly data attributes and checks receivers on getters and the legacy method', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = new StorageEvent('storage');
      const attributes = ['key', 'oldValue', 'newValue', 'url', 'storageArea'];
      const descriptors = attributes.map((name) => {
        const descriptor = Object.getOwnPropertyDescriptor(StorageEvent.prototype, name)!;
        let invalidReceiver = false;
        try { descriptor.get!.call({}); } catch (error) { invalidReceiver = error instanceof TypeError; }
        return [descriptor.enumerable, descriptor.configurable, descriptor.set === undefined,
          Reflect.set(event, name, 'replacement'), invalidReceiver];
      });
      let invalidReceiver = false;
      let missingArgument = false;
      try { StorageEvent.prototype.initStorageEvent.call({} as StorageEvent, 'storage'); }
      catch (error) { invalidReceiver = error instanceof TypeError; }
      try { Reflect.apply(Reflect.get(event, 'initStorageEvent'), event, []); }
      catch (error) { missingArgument = error instanceof TypeError; }
      return { descriptors, invalidReceiver, missingArgument };
    })).toEqual({ descriptors: Array(5).fill([true, true, true, false, true]), invalidReceiver: true, missingArgument: true });
  });

  it('supports the legacy factory but requires initialization before dispatch', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = document.createEvent('sToRaGeEvEnT') as StorageEvent;
      const defaults = [event.type, event.key, event.oldValue, event.newValue, event.url, event.storageArea, event.isTrusted];
      let rejected = false;
      try { document.dispatchEvent(event); } catch (error) {
        rejected = error instanceof DOMException && error.name === 'InvalidStateError';
      }
      event.initStorageEvent('storage');
      return { instance: event instanceof StorageEvent, defaults, rejected, dispatched: document.dispatchEvent(event) };
    })).toEqual({ instance: true, defaults: ['', null, null, null, '', null, false], rejected: true, dispatched: true });
  });

  it('reinitializes an idle event and resets omitted data without changing its timestamp or composed flag', async () => {
    const { browser } = await createStorage();
    expect(await browser.evaluate(() => {
      const storage = Reflect.get(globalThis, 'storageUnderTest') as StoragePlatform;
      const event = new StorageEvent('before', { bubbles: true, cancelable: true, composed: true });
      const timeStamp = event.timeStamp;
      document.dispatchEvent(event);
      event.preventDefault();
      event.stopImmediatePropagation();
      event.initStorageEvent('after', false, false, '\ud800', '', 'new', 'literal\ud800', storage);
      const initialized = [
        event.type, event.bubbles, event.cancelable, event.key, event.oldValue, event.newValue, event.url,
        event.storageArea === storage, event.target, event.defaultPrevented, event.cancelBubble,
        event.composed, event.timeStamp === timeStamp,
      ];
      event.initStorageEvent('defaults');
      return { initialized, defaults: [event.key, event.oldValue, event.newValue, event.url, event.storageArea] };
    })).toEqual({
      initialized: ['after', false, false, '\ud800', '', 'new', 'literal\ufffd', true, null, false, false, true, true],
      defaults: [null, null, null, '', null],
    });
  });

  it('ignores legacy reinitialization during dispatch after converting its arguments', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = new StorageEvent('before', { key: 'original', newValue: 'value', cancelable: true });
      const converted: string[] = [];
      document.addEventListener('before', () => {
        event.preventDefault();
        const type = { toString() { converted.push('type'); return 'after'; } };
        const key = { toString() { converted.push('key'); return 'replacement'; } };
        Reflect.apply(Reflect.get(event, 'initStorageEvent'), event, [type, true, false, key, 'old', 'new', 'url']);
      });
      document.dispatchEvent(event);
      return [converted, event.type, event.bubbles, event.cancelable, event.key, event.oldValue,
        event.newValue, event.url, event.storageArea, event.defaultPrevented];
    })).toEqual([['type', 'key'], 'before', false, true, 'original', null, 'value', '', null, true]);
  });

  it('projects internally created trusted events and clears trust on later legacy initialization', async () => {
    const { browser, implementation } = await createStorage();
    await browser.evaluate(() => {
      window.addEventListener('storage', (event) => { Reflect.set(globalThis, 'receivedStorageEvent', event); });
    });
    getRelevantRealm(browser.window).env.window.fireEvent('storage', StorageEventImpl, (storageEvent) => {
      storageEvent.key = 'key';
      storageEvent.oldValue = 'old';
      storageEvent.newValue = 'new';
      storageEvent.url = 'https://sender.test/path';
      storageEvent.storageArea = implementation;
    });
    expect(await browser.evaluate(() => {
      const event = Reflect.get(globalThis, 'receivedStorageEvent') as StorageEvent;
      const storage = Reflect.get(globalThis, 'storageUnderTest') as StoragePlatform;
      const received = [event instanceof StorageEvent, event.isTrusted, event.key, event.oldValue,
        event.newValue, event.url, event.storageArea === storage, event.target === window];
      event.initStorageEvent('author');
      return { received, isTrusted: event.isTrusted, target: event.target };
    })).toEqual({
      received: [true, true, 'key', 'old', 'new', 'https://sender.test/path', true, true], isTrusted: false, target: null,
    });
  });
});

/** Obtain the Storage object through its Window getter. */
async function createStorage() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/');
  const storage = browser.window.localStorage;
  const implementation = unwrap<StorageImpl>(storage);
  Reflect.set(browser.window, 'storageUnderTest', storage);
  return { browser, implementation, storage };
}
