import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { Storage as StoragePlatform } from '../../../src/browlet/platform';
import { StorageImpl } from '../../../src/browlet/storage/index';
import { StorageBottle, type StorageType } from '../../../src/storage/index';
import { getBindingContext, unwrap } from '../../support/browlet-binding';

describe('HTML §12.2.1: Storage reads', () => {
  it.each(['http://example.test/', 'https://example.test/'])('exposes a nonconstructible interface at %s', async (url) => {
    const { browser } = await createStorage('local', url);
    expect(await browser.evaluate(() => {
      const storage = Reflect.get(globalThis, 'storageUnderTest') as StoragePlatform;
      let illegalConstructor = false;
      try { Reflect.construct(Storage, []); } catch (error) { illegalConstructor = error instanceof TypeError; }
      return {
        illegalConstructor, instance: storage instanceof Storage,
        prototype: Object.getPrototypeOf(storage) === Storage.prototype,
        tag: Object.prototype.toString.call(storage),
        methods: [Storage.prototype.key.length, Storage.prototype.getItem.length],
      };
    })).toEqual({ illegalConstructor: true, instance: true, prototype: true, tag: '[object Storage]', methods: [1, 1] });
  });

  it.each(['local', 'session'] as const)('reads the existing %s bottle without copying its data', async (type) => {
    const { browser, map, implementation } = await createStorage(type);
    expect(implementation.type).toBe(type);
    expect(await browser.evaluate(() => {
      const storage = Reflect.get(globalThis, 'storageUnderTest') as StoragePlatform;
      return [storage.length, storage.key(0), storage.getItem('missing')];
    })).toEqual([0, null, null]);

    map.set('', '').set('value', 'unchanged\u0000\ud800');
    expect(await browser.evaluate(() => {
      const storage = Reflect.get(globalThis, 'storageUnderTest') as StoragePlatform;
      return [storage.length, storage.getItem(''), storage.getItem('value'), storage.getItem('missing')];
    })).toEqual([2, '', 'unchanged\u0000\ud800', null]);
  });

  it('uses the map order for keys and treats numeric property names as names, not positions', async () => {
    const { browser, map } = await createStorage();
    map.set('beta', 'B').set('10', 'ten').set('2', 'two').set('alpha', 'A');
    expect(await browser.evaluate(() => {
      const storage = Reflect.get(globalThis, 'storageUnderTest') as StoragePlatform;
      return {
        keys: [0, 1, 2, 3, 4].map((index) => storage.key(index)),
        names: Object.keys(storage), numeric: Reflect.get(storage, '2') as unknown,
        missing: Reflect.get(storage, '0') === undefined,
      };
    })).toEqual({ keys: ['beta', '10', '2', 'alpha', null], names: ['beta', '10', '2', 'alpha'], numeric: 'two', missing: true });
  });

  it('uses Web IDL unsigned-long conversion for key()', async () => {
    const { browser, map } = await createStorage();
    map.set('first', 'A').set('second', 'B');
    expect(await browser.evaluate(() => {
      const storage = Reflect.get(globalThis, 'storageUnderTest') as StoragePlatform;
      return ['1', 1.9, -1, 2 ** 32, NaN, Infinity, undefined, null]
        .map((index) => storage.key(index as number));
    })).toEqual(['second', 'second', null, 'first', 'first', 'first', 'first', 'first']);
  });

  it('converts getItem keys once and preserves DOMString contents', async () => {
    const { browser, map } = await createStorage();
    map.set('undefined', 'U').set('null', 'N').set('token', 'T').set('\ud800', 'surrogate');
    expect(await browser.evaluate(() => {
      const storage = Reflect.get(globalThis, 'storageUnderTest') as StoragePlatform;
      let conversions = 0;
      const values = [undefined, null, { toString() { conversions++; return 'token'; } }, '\ud800']
        .map((key) => storage.getItem(key as string));
      return { values, conversions };
    })).toEqual({ values: ['U', 'N', 'T', 'surrogate'], conversions: 1 });
  });

  it('keeps methods and inherited names visible while getItem still reads colliding keys', async () => {
    const { browser, map } = await createStorage();
    for (const key of ['length', 'key', 'getItem', 'setItem', 'removeItem', 'clear', 'constructor', '__proto__', 'toString']) {
      map.set(key, `stored:${key}`);
    }
    map.set('visible', 'V').set('', 'empty name');
    expect(await browser.evaluate(() => {
      const storage = Reflect.get(globalThis, 'storageUnderTest') as StoragePlatform;
      const names = ['length', 'key', 'getItem', 'setItem', 'removeItem', 'clear', 'constructor', '__proto__', 'toString'];
      return {
        values: names.map((name) => storage.getItem(name)),
        hidden: names.every((name) => !Object.hasOwn(storage, name)),
        methods: ['key', 'getItem', 'setItem', 'removeItem', 'clear', 'toString']
          .every((name) => typeof Reflect.get(storage, name) === 'function'),
        length: storage.length, names: Object.keys(storage),
        descriptor: Object.getOwnPropertyDescriptor(storage, 'visible'),
        absent: !('absent' in storage) && Reflect.get(storage, 'absent') === undefined,
      };
    })).toEqual({
      values: [...map.values()].slice(0, 9), hidden: true, methods: true, length: 11,
      names: ['visible', ''], descriptor: { value: 'V', writable: true, enumerable: true, configurable: true }, absent: true,
    });
  });

  it('observes backing-map updates and replacement without caching keys or values', async () => {
    const { browser, map } = await createStorage();
    const read = () => {
      const storage = Reflect.get(globalThis, 'storageUnderTest') as StoragePlatform;
      return { length: storage.length, names: Object.keys(storage), value: storage.getItem('current') };
    };
    map.set('current', 'first');
    expect(await browser.evaluate(read)).toEqual({ length: 1, names: ['current'], value: 'first' });
    map.set('current', 'updated').set('other', 'value');
    expect(await browser.evaluate(read)).toEqual({ length: 2, names: ['current', 'other'], value: 'updated' });
    map.backingMap = new Map([['replacement', 'new map']]);
    expect(await browser.evaluate(read)).toEqual({ length: 1, names: ['replacement'], value: null });
    map.clear();
    expect(await browser.evaluate(read)).toEqual({ length: 0, names: [], value: null });
  });

  it('preserves distinct Storage identities over shared data and borrows methods across realms', async () => {
    const first = await createStorage();
    const second = await createStorage();
    const binding = getBindingContext(first.implementation.env.realm);
    const other = binding.project(StorageImpl,
      new StorageImpl(StorageBottle.obtainLocalMap(first.implementation.env, 'localStorage')!, 'local', first.implementation.env));
    expect(other).not.toBe(first.storage);
    expect(binding.project(StorageImpl, first.implementation)).toBe(first.storage);
    expect(getBindingContext(second.implementation.env.realm).project(StorageImpl, first.implementation)).toBe(first.storage);
    first.map.set('value', 'first realm');
    second.map.set('value', 'second realm');
    Reflect.set(second.browser.window, 'foreignStorage', first.storage);
    expect(await second.browser.evaluate(() => {
      const storage = Reflect.get(globalThis, 'foreignStorage') as StoragePlatform;
      return Storage.prototype.getItem.call(storage, 'value');
    })).toBe('first realm');
    expect(first.browser.window.Storage.prototype.getItem.call(other, 'value')).toBe('first realm');
  });

  it('rejects missing arguments, Symbols, and incompatible receivers through Binding', async () => {
    const { browser } = await createStorage();
    expect(await browser.evaluate(() => {
      const storage = Reflect.get(globalThis, 'storageUnderTest') as StoragePlatform;
      /* eslint-disable @typescript-eslint/unbound-method -- Deliberately supply missing arguments and incompatible receivers. */
      const length = Object.getOwnPropertyDescriptor(Storage.prototype, 'length')!.get!;
      const calls = [
        () => { Reflect.apply(storage.key, storage, []); },
        () => { Reflect.apply(storage.getItem, storage, []); },
        () => { Reflect.apply(storage.key, storage, [Symbol()]); },
        () => { Reflect.apply(storage.getItem, storage, [Symbol()]); },
        () => { Reflect.apply(storage.getItem, {}, ['key']); },
        () => { Reflect.apply(length, {}, []); },
      ];
      /* eslint-enable @typescript-eslint/unbound-method */
      return calls.map((call) => {
        try { call(); return false; } catch (error) { return error instanceof TypeError; }
      });
    })).toEqual([true, true, true, true, true, true]);
  });
});

/** Read through the public getter and retain its map for fixture data. */
async function createStorage(type: StorageType = 'local', url = 'https://example.test/') {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate(url);
  const storage = type === 'local' ? browser.window.localStorage : browser.window.sessionStorage;
  const implementation = unwrap<StorageImpl>(storage);
  const map = implementation.map;
  Reflect.set(browser.window, 'storageUnderTest', storage);
  return { browser, map, implementation, storage };
}
