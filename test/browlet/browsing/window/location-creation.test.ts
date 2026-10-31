import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { getRelevantRealm } from '../../../support/browlet-binding';

describe('Location creation', () => {
  it('installs the relevant realm intrinsic valueOf and an undefined Symbol.toPrimitive', () => {
    const browser = new Browlet({ route: () => '' });
    const location = browser.window.location;
    const realm = getRelevantRealm(location);
    expect(Object.getOwnPropertyDescriptor(location, 'valueOf')).toMatchObject({
      value: Reflect.get(realm.objectPrototype, 'valueOf') as unknown,
      writable: false, enumerable: false, configurable: false,
    });
    expect(Object.getOwnPropertyDescriptor(location, Symbol.toPrimitive)).toMatchObject({
      value: undefined, writable: false, enumerable: false, configurable: false,
    });
    expect(location.valueOf()).toBe(location);
    expect(Object.keys(location)).not.toContain('valueOf');
  });

  it('resists replacement of both conversion properties', () => {
    const browser = new Browlet({ route: () => '' });
    const location = browser.window.location;
    for (const key of ['valueOf', Symbol.toPrimitive]) {
      const descriptor = Object.getOwnPropertyDescriptor(location, key);
      expect(Reflect.set(location, key, () => 'forged')).toBe(false);
      expect(Reflect.defineProperty(location, key, { value: () => 'forged' })).toBe(false);
      expect(Object.getOwnPropertyDescriptor(location, key)).toEqual(descriptor);
    }
  });

  it('does not inherit author replacements installed before the first Location access', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Retained for identity and restoration, not invocation.
      const valueOf = Object.prototype.valueOf;
      Object.defineProperties(Object.prototype, {
        valueOf: { value: () => 'forged valueOf', configurable: true },
        [Symbol.toPrimitive]: { value: () => 'forged primitive', configurable: true },
      });
      Object.defineProperties(Location.prototype, {
        toString: { value: () => 'forged toString', configurable: true },
        valueOf: { value: () => 'forged Location valueOf', configurable: true },
      });
      const result = {
        valueOfIdentity: location.valueOf === valueOf,
        string: String(location),
        concatenation: (location as unknown as string) + '',
        key: Object.keys({ [location as unknown as string]: 1 })[0],
        primitive: Object.getOwnPropertyDescriptor(location, Symbol.toPrimitive)?.value as unknown,
      };
      Reflect.deleteProperty(Object.prototype, Symbol.toPrimitive);
      Object.defineProperty(Object.prototype, 'valueOf', { value: valueOf });
      return result;
    })).toEqual({
      valueOfIdentity: true, string: 'about:blank', concatenation: 'about:blank', key: 'about:blank', primitive: undefined,
    });
  });

  it('keeps the Web IDL stringifier own, enumerable, and unforgeable', () => {
    const browser = new Browlet({ route: () => '' });
    const location = browser.window.location;
    expect(Object.getOwnPropertyDescriptor(location, 'toString')).toMatchObject({
      value: expect.any(Function) as unknown, writable: false, enumerable: true, configurable: false,
    });
    expect(Reflect.defineProperty(location, 'toString', { value: () => 'forged' })).toBe(false);
    expect(String(location)).toBe('about:blank');
  });

  it('retains one Location per Window and realm-specific valueOf identities across navigation', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    const first = browser.window.location;
    const firstRealm = getRelevantRealm(first);
    expect(browser.window.location).toBe(first);
    await browser.navigate('https://example.test/next');
    const second = browser.window.location;
    const secondRealm = getRelevantRealm(second);
    expect(second).not.toBe(first);
    expect(browser.window.location).toBe(second);
    expect(getRelevantRealm(first)).toBe(firstRealm);
    expect(secondRealm).not.toBe(firstRealm);
    expect(Object.getOwnPropertyDescriptor(first, 'valueOf')?.value).toBe(Reflect.get(firstRealm.objectPrototype, 'valueOf'));
    expect(Object.getOwnPropertyDescriptor(second, 'valueOf')?.value).toBe(Reflect.get(secondRealm.objectPrototype, 'valueOf'));
    expect(Reflect.get(second, 'valueOf')).not.toBe(Reflect.get(first, 'valueOf'));
  });
});
