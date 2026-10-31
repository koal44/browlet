import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { getRelevantRealm } from '../../../support/browlet-binding';

describe('WindowProxy foundations', () => {
  it('exposes no WindowProxy interface object', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => Reflect.has(globalThis, 'WindowProxy'))).toBe(false);
  });

  it('retains its own Window prototype and rejects a different prototype', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => [
      Object.getPrototypeOf(window) === Window.prototype,
      Reflect.setPrototypeOf(window, Window.prototype),
      Reflect.setPrototypeOf(window, null),
      Reflect.setPrototypeOf(window, {}),
      Object.getPrototypeOf(window) === Window.prototype,
    ])).toEqual([true, true, false, false, true]);
  });
});

describe('WindowProxy receivers', () => {
  it('preserves the default and explicit receiver for author accessors', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const key = Symbol('accessor');
      const receiver = {};
      const setterReceivers: unknown[] = [];
      let setterValue: unknown;
      Object.defineProperty(window, key, {
        get(this: object) { return this; },
        set(this: object, value: unknown) { setterReceivers.push(this); setterValue = value; },
        configurable: true,
      });
      const defaultGet = Reflect.get(window, key) === window;
      const explicitGet = Reflect.get(window, key, receiver) === receiver;
      const defaultSet = Reflect.set(window, key, 'default');
      const explicitSet = Reflect.set(window, key, 'explicit', receiver);
      return [
        defaultGet, explicitGet, defaultSet, setterReceivers[0] === window,
        explicitSet, setterReceivers[1] === receiver, setterValue,
      ];
    })).toEqual([true, true, true, true, true, true, 'explicit']);
  });

  it('writes data properties to the supplied receiver and respects its restrictions', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((): unknown[] => {
      const key = Symbol('writable');
      const absent = Symbol('absent');
      Object.defineProperty(window, key, { value: 1, writable: true, configurable: true });
      const receiver = Object.create(window) as object;
      const written = Reflect.set(window, key, 2, receiver);
      const created = Reflect.set(window, absent, 3, receiver);
      const frozen = Object.freeze({});
      return [
        written, created,
        Object.getOwnPropertyDescriptor(receiver, key)?.value,
        Object.getOwnPropertyDescriptor(receiver, absent)?.value,
        Reflect.get(window, key), Object.hasOwn(window, absent),
        Reflect.set(window, key, 4, frozen), Reflect.set(window, key, 5, 0),
        Reflect.get(window, key),
      ];
    })).toEqual([true, true, 2, 3, 1, false, false, false, 1]);
  });

  it('rejects a derived object as the receiver of a Window IDL getter', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const receiver = Object.create(window) as object;
      try { Reflect.get(window, 'document', receiver); }
      catch (error) { return error instanceof TypeError; }
      return false;
    })).toBe(true);
  });

  it('keeps stock-VM global receiver aliases valid across navigation', async () => {
    const browser = new Browlet({ route: () => '' });
    const proxy = browser.window;
    const oldGlobal = getRelevantRealm(proxy).globalProxy;
    expect(Reflect.get(oldGlobal, 'window')).toBe(proxy);

    await browser.navigate('https://example.test/next');
    const newGlobal = getRelevantRealm(proxy).globalProxy;
    expect(Reflect.get(oldGlobal, 'window')).toBe(proxy);
    expect(Reflect.get(newGlobal, 'window')).toBe(proxy);
    expect(browser.window).toBe(proxy);
  });
});

describe('WindowProxy extensibility', () => {
  it('rejects preventing extensions without disturbing property access', () => {
    const browser = new Browlet({ route: () => '' });
    const proxy = browser.window;
    const prototype = Reflect.getPrototypeOf(proxy);

    expect(Reflect.isExtensible(proxy)).toBe(true);
    expect(Reflect.preventExtensions(proxy)).toBe(false);
    expect(Reflect.isExtensible(proxy)).toBe(true);
    expect(Reflect.getPrototypeOf(proxy)).toBe(prototype);
    expect(Reflect.ownKeys(proxy)).toContain('document');
    expect(proxy.document).toBe(browser.document);
    expect(Reflect.defineProperty(proxy, 'extensibilityProbe', {
      value: 1, writable: true, enumerable: true, configurable: true,
    })).toBe(true);
    expect(Reflect.get(proxy, 'extensibilityProbe')).toBe(1);
    expect(Reflect.deleteProperty(proxy, 'extensibilityProbe')).toBe(true);
  });

  it.each(['preventExtensions', 'seal', 'freeze'] as const)(
    'Object.%s throws a caller-realm TypeError and leaves the WindowProxy extensible', async (operation) => {
      const browser = new Browlet({ route: () => '' });
      const result = await browser.evaluate((operation) => {
        let threwTypeError = false;
        try {
          if (operation === 'preventExtensions') Object.preventExtensions(window);
          else if (operation === 'seal') Object.seal(window);
          else Object.freeze(window);
        } catch (error) { threwTypeError = error instanceof TypeError; }
        return [threwTypeError, Object.isExtensible(window), window.document === document];
      }, operation);
      expect(result).toEqual([true, true, true]);
    },
  );

  it('uses the same extensibility rules for a foreign WindowProxy', async () => {
    const caller = new Browlet({ route: () => '' });
    const target = new Browlet({ route: () => '' });
    // Separate initial about:blank Documents have distinct opaque origins and agents.
    Reflect.set(caller.window, 'foreignWindow', target.window);
    expect(await caller.evaluate(() => {
      const foreign = Reflect.get(window, 'foreignWindow') as object;
      return [Reflect.isExtensible(foreign), Reflect.preventExtensions(foreign), Object.isExtensible(foreign)];
    })).toEqual([true, false, true]);
  });

  it('preserves its identity and extensibility when navigation replaces the Window', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    const proxy = browser.window;
    const previousRealm = getRelevantRealm(proxy);
    expect(Reflect.preventExtensions(proxy)).toBe(false);

    await browser.navigate('https://other.test/second');

    expect(browser.window).toBe(proxy);
    expect(getRelevantRealm(proxy)).not.toBe(previousRealm);
    expect(Reflect.isExtensible(proxy)).toBe(true);
    expect(Reflect.preventExtensions(proxy)).toBe(false);
    expect(Reflect.getPrototypeOf(proxy)).toBe(browser.window.Window.prototype);
    expect(proxy.document).toBe(browser.document);
  });
});
