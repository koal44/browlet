import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { getRelevantRealm } from '../../../support/browlet-binding';

describe('Location extensibility', () => {
  it('rejects preventing extensions while retaining ordinary expando operations', () => {
    const browser = new Browlet({ route: () => '' });
    const location = browser.window.location;
    const prototype = Reflect.getPrototypeOf(location);
    const href = Reflect.getOwnPropertyDescriptor(location, 'href');
    expect(Reflect.isExtensible(location)).toBe(true);
    expect(Reflect.preventExtensions(location)).toBe(false);
    expect(Reflect.isExtensible(location)).toBe(true);
    expect(Reflect.getPrototypeOf(location)).toBe(prototype);
    expect(Reflect.getOwnPropertyDescriptor(location, 'href')).toEqual(href);
    expect(Reflect.defineProperty(location, 'expando', {
      value: 1, writable: true, enumerable: true, configurable: true,
    })).toBe(true);
    expect(Reflect.set(location, 'expando', 2)).toBe(true);
    expect(Reflect.get(location, 'expando')).toBe(2);
    expect(Reflect.deleteProperty(location, 'expando')).toBe(true);
  });

  it.each(['preventExtensions', 'seal', 'freeze'] as const)(
    'Object.%s throws a caller-realm TypeError before changing descriptors', async (operation) => {
      const browser = new Browlet({ route: () => '' });
      expect(await browser.evaluate((operation) => {
        Object.defineProperty(location, 'probe', {
          value: 1, writable: true, configurable: true, enumerable: true,
        });
        let typeError = false;
        try {
          if (operation === 'preventExtensions') Object.preventExtensions(location);
          else if (operation === 'seal') Object.seal(location);
          else Object.freeze(location);
        }
        catch (error) { typeError = error instanceof TypeError; }
        const descriptor = Object.getOwnPropertyDescriptor(location, 'probe')!;
        return [typeError, Object.isExtensible(location), descriptor.writable, descriptor.configurable, location.href];
      }, operation)).toEqual([true, true, true, true, 'about:blank']);
    },
  );

  it('applies the same extensibility rules to a foreign Location', async () => {
    const caller = new Browlet({ route: () => '' });
    const target = new Browlet({ route: () => '' });
    Reflect.set(caller.window, 'foreignLocation', target.window.location);
    expect(await caller.evaluate(() => {
      const foreign = Reflect.get(window, 'foreignLocation') as object;
      let typeError = false;
      try { Object.preventExtensions(foreign); }
      catch (error) { typeError = error instanceof TypeError; }
      return [Reflect.isExtensible(foreign), Reflect.preventExtensions(foreign), Object.isExtensible(foreign), typeError];
    })).toEqual([true, false, true, true]);
  });

  it('preserves the independent identities and extensibility of retained and replacement Locations', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    const previous = browser.window.location;
    const previousRealm = getRelevantRealm(previous);
    expect(Reflect.preventExtensions(previous)).toBe(false);
    await browser.navigate('https://example.test/second');
    const current = browser.window.location;
    expect(current).not.toBe(previous);
    expect(getRelevantRealm(previous)).toBe(previousRealm);
    for (const location of [previous, current]) {
      expect(Reflect.isExtensible(location)).toBe(true);
      expect(Reflect.preventExtensions(location)).toBe(false);
      expect(Reflect.isExtensible(location)).toBe(true);
    }
  });
});
