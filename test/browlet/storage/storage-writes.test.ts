import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { Storage as StoragePlatform, StorageEvent as StorageEventPlatform } from '../../../src/browlet/platform';
import { StorageImpl } from '../../../src/browlet/storage/index';
import { StorageBottle, StorageBucket, StorageEndpoint } from '../../../src/storage/index';
import { getBindingContext, unwrap } from '../../support/browlet-binding';

describe('HTML §12.2.1: Storage writes', () => {
  it.each(['localStorage', 'sessionStorage'] as const)('writes %s through methods and named assignment', async (name) => {
    const { browser, map } = await createStorage(name);
    expect(await browser.evaluate((name) => {
      const storage = window[name];
      const conversions: string[] = [];
      const result = storage.setItem(
        { toString() { conversions.push('key'); return 'first'; } } as unknown as string,
        { toString() { conversions.push('value'); return '\u0000\ud800'; } } as unknown as string,
      );
      Reflect.set(storage, 'second', 42);
      storage.setItem('first', 'replacement');
      storage.setItem('', '');
      storage.setItem('undefined', undefined as unknown as string);
      storage.setItem('null', null as unknown as string);
      return {
        result, conversions, names: Object.keys(storage),
        keys: Array.from({ length: storage.length }, (_, index) => storage.key(index)),
        values: ['first', 'second', '', 'undefined', 'null'].map((key) => storage.getItem(key)),
      };
    }, name)).toEqual({
      result: undefined, conversions: ['key', 'value'],
      names: ['first', 'second', '', 'undefined', 'null'], keys: ['first', 'second', '', 'undefined', 'null'],
      values: ['replacement', '42', '', 'undefined', 'null'],
    });
    expect([...map.values()]).toEqual(['replacement', '42', '', 'undefined', 'null']);
  });

  it('does not mutate on failed argument conversion or an incompatible receiver', async () => {
    const { browser } = await createStorage();
    expect(await browser.evaluate(() => {
      localStorage.setItem('keep', 'value');
      /* eslint-disable @typescript-eslint/unbound-method -- Exercise invalid calls through Binding. */
      const calls = [
        () => { Reflect.apply(Storage.prototype.setItem, localStorage, ['keep']); },
        () => { Reflect.apply(Storage.prototype.setItem, localStorage, [Symbol(), 'value']); },
        () => { Reflect.apply(Storage.prototype.setItem, localStorage, ['keep', Symbol()]); },
        () => { Reflect.apply(Storage.prototype.setItem, {}, ['key', 'value']); },
        () => { Reflect.set(localStorage, 'keep', Symbol()); },
      ];
      /* eslint-enable @typescript-eslint/unbound-method */
      const failures = calls.map((call) => {
        try { call(); return false; } catch (error) { return error instanceof TypeError; }
      });
      return [failures, localStorage.length, localStorage.getItem('keep')];
    })).toEqual([[true, true, true, true, true], 1, 'value']);
  });

  it.each(['localStorage', 'sessionStorage'] as const)('checks %s bottle quota in UTF-16 bytes before changing data', async (name) => {
    const { browser, map } = await createStorage(name);
    map.bottle.quota = 8;
    expect(await browser.evaluate((name) => {
      const storage = window[name];
      storage.setItem('a', '\u{1f989}'); // Six bytes including the key.
      storage.setItem('\ud800', ''); // A lone surrogate still occupies two bytes.
      const QuotaError = Reflect.get(globalThis, 'QuotaExceededError') as typeof DOMException;
      const calls = [
        () => { storage.setItem('a', 'longer'); },
        () => { Reflect.set(storage, 'new', ''); },
      ];
      const failures = calls.map((call) => {
        try { call(); return false; } catch (error) {
          return error instanceof QuotaError && error instanceof DOMException && error.name === 'QuotaExceededError';
        }
      });
      return [failures, storage.length, storage.key(0), storage.key(1), storage.getItem('a'), storage.getItem('new')];
    }, name)).toEqual([[true, true], 2, 'a', '\ud800', '\u{1f989}', null]);
    expect(map.bottle.usage).toBe(8);

    expect(await browser.evaluate((name) => {
      const storage = window[name];
      storage.setItem('a', 'x'); // Replacement frees two bytes without moving the key.
      storage.setItem('b', '');
      const order = Array.from({ length: storage.length }, (_, index) => storage.key(index));
      storage.removeItem('\ud800');
      storage.setItem('c', '');
      storage.clear();
      storage.setItem('full', '');
      return [order, Object.keys(storage), storage.getItem('full')];
    }, name)).toEqual([['a', '\ud800', 'b'], ['full'], '']);
    expect(map.bottle.usage).toBe(8);
  });

  it('shares the shelf budget across buckets and endpoint-provided usage estimates', async () => {
    const { browser, map } = await createStorage('localStorage', 11);
    map.bottle.quota = null;
    const otherBucket = StorageBucket.create('local');
    otherBucket.getBottle('localStorage')!.map.set('x', '');
    map.shelf.bucketMap.set('other', otherBucket);
    const bytes = new StorageBottle(new ByteEndpoint());
    bytes.map.set('data', new Uint8Array(3));
    map.shelf.bucketMap.get('default')!.bottleMap.set('test-bytes', bytes);

    expect(await browser.evaluate(() => {
      localStorage.setItem('a', 'bb');
      let rejected = false;
      try { localStorage.setItem('a', 'bbb'); } catch (error) {
        rejected = error instanceof DOMException && error.name === 'QuotaExceededError';
      }
      return [rejected, localStorage.getItem('a')];
    })).toEqual([true, 'bb']);
    expect(map.shelf.usage).toBe(11);
    otherBucket.clear();
    await browser.evaluate(() => { localStorage.setItem('a', 'bbb'); });
    expect(map.shelf.usage).toBe(11);
    expect(bytes.map.get('data')!.byteLength).toBe(3);
  });

  it('allows unchanged and non-growing values after quotas are lowered below current usage', async () => {
    const { browser, map, env } = await createStorage();
    await browser.evaluate(() => { localStorage.setItem('a', '1234'); });
    map.bottle.quota = 1;
    env.userAgent.storageQuotaBytes = 1;
    expect(await browser.evaluate(() => {
      localStorage.setItem('a', '1234');
      localStorage.setItem('a', 'abcd');
      localStorage.setItem('a', '12');
      let rejected = false;
      try { localStorage.setItem('a', '123'); } catch (error) {
        rejected = error instanceof DOMException && error.name === 'QuotaExceededError';
      }
      return [rejected, localStorage.getItem('a')];
    })).toEqual([true, '12']);
    expect(map.bottle.usage).toBe(6);
  });

  it('keeps local and session shelf budgets independent and preserves acquired access', async () => {
    const { browser, env } = await createStorage('localStorage', 4);
    await browser.evaluate(() => {
      localStorage.setItem('a', 'b');
      sessionStorage.setItem('c', 'd');
    });
    // The specified getters return cached holders before consulting acquisition policy again.
    env.userAgent.storageEnabled = false;
    expect(await browser.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('e', 'f');
      return [localStorage.getItem('e'), sessionStorage.getItem('c')];
    })).toEqual(['f', 'd']);
  });

  it('applies the retained receiver\'s shelf after navigation and when borrowing another realm\'s setter', async () => {
    const { browser, map } = await createStorage('localStorage', 8);
    const retained = browser.window.localStorage;
    await browser.evaluate(() => { localStorage.setItem('a', '123'); });
    await browser.navigate('https://other.test/');
    Reflect.set(browser.window, 'retained', retained);
    expect(await browser.evaluate(() => {
      const retained = Reflect.get(globalThis, 'retained') as StoragePlatform;
      localStorage.setItem('b', '456');
      let rejected = false;
      try { Storage.prototype.setItem.call(retained, 'c', ''); } catch (error) {
        // A borrowed member must retain its receiver's data and quota, irrespective of this realm.
        rejected = (error as DOMException).name === 'QuotaExceededError';
      }
      Storage.prototype.setItem.call(retained, 'a', 'x');
      Storage.prototype.setItem.call(retained, 'c', 'y');
      return [rejected, retained.getItem('a'), retained.getItem('c'), localStorage.getItem('b'), localStorage.length];
    })).toEqual([true, 'x', 'y', '456', 1]);
    expect([...map]).toEqual([['a', 'x'], ['c', 'y']]);
    expect(map.shelf.usage).toBe(8);
  });

  it('queues insert/update events with snapshots, but none for equal values or rejected writes', async () => {
    const { browser, map, env } = await createStorage('localStorage', 8);
    const recipient = getBindingContext(env.realm).project(StorageImpl,
      new StorageImpl(StorageBottle.obtainLocalMap(env, 'localStorage')!, 'local', env));
    const events: StorageEventPlatform[] = [];
    browser.window.addEventListener('storage', (event) => { events.push(event as StorageEventPlatform); });

    expect(await browser.evaluate(() => {
      localStorage.setItem('a', '1');
      localStorage.setItem('a', '2');
      localStorage.setItem('a', '2');
      let rejected = false;
      try { localStorage.setItem('a', '1234'); } catch (error) {
        rejected = error instanceof DOMException && error.name === 'QuotaExceededError';
      }
      return [rejected, localStorage.getItem('a')];
    })).toEqual([true, '2']);
    await expect.poll(() => events.length).toBe(2);
    expect(events.map((event) => [event.key, event.oldValue, event.newValue, event.url])).toEqual([
      ['a', null, '1', 'https://example.test/'], ['a', '1', '2', 'https://example.test/'],
    ]);
    for (const event of events) {
      expect(event.storageArea).toBe(recipient);
      expect(event.isTrusted).toBe(true);
    }
    expect(map.get('a')).toBe('2');
  });
});

async function createStorage(name: 'localStorage' | 'sessionStorage' = 'localStorage', storageQuotaBytes = 64 * 2 ** 20) {
  const browser = new Browlet({ route: () => '', storageQuotaBytes });
  await browser.navigate('https://example.test/');
  const { map, env } = unwrap<StorageImpl>(browser.window[name]);
  return { browser, map, env };
}

/** Supply a measured non-Web-Storage endpoint without implementing its unrelated API. */
class ByteEndpoint extends StorageEndpoint<string, Uint8Array> {
  constructor() {
    super('test-bytes', new Set(['local']), null);
  }

  override estimateUsage(map: Map<string, Uint8Array>): number {
    return [...map.values()].reduce((sum, value) => sum + value.byteLength, 0);
  }
}
