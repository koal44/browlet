import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';

// Independent HTML IDL inventory; do not derive expectations from Browlet's annotations.
const attributes = ['href', 'origin', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash', 'ancestorOrigins'];
const methods = ['assign', 'replace', 'reload', 'toString'];
const defaultKeys = [...attributes, ...methods, 'valueOf', Symbol.toPrimitive];

// SPEC_CLASH(location-default-properties): follow browser descriptors, no-op definitions, and deletion protection.
// Rationale and HTML's conflicting algorithms: src/browlet/browsing/window/ROADMAP.md#location-descriptor-decision-review.
describe('Location same-origin own properties', () => {
  it('keeps every initial IDL member and conversion safeguard nonconfigurable', () => {
    const location = new Browlet({ route: () => '' }).window.location;
    expect(new Set(Reflect.ownKeys(location))).toEqual(new Set(defaultKeys));
    for (const key of attributes) {
      expect(Object.getOwnPropertyDescriptor(location, key)).toMatchObject({
        get: expect.any(Function) as unknown,
        set: key === 'origin' || key === 'ancestorOrigins' ? undefined : expect.any(Function) as unknown,
        enumerable: true, configurable: false,
      });
    }
    for (const key of [...methods, 'valueOf', Symbol.toPrimitive]) {
      expect(Object.getOwnPropertyDescriptor(location, key)).toMatchObject({
        value: key === Symbol.toPrimitive ? undefined : expect.any(Function) as unknown,
        writable: false, enumerable: typeof key === 'string' && methods.includes(key), configurable: false,
      });
    }
  });

  it('accepts unchanged definitions, including empty and partial descriptors', () => {
    const location = new Browlet({ route: () => '' }).window.location;
    for (const key of defaultKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(location, key)!;
      expect(Reflect.defineProperty(location, key, {})).toBe(true);
      expect(Reflect.defineProperty(location, key, descriptor)).toBe(true);
      expect(Object.defineProperty(location, key, descriptor)).toBe(location);
      expect(Reflect.defineProperty(location, key, { configurable: false })).toBe(true);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Preserve getter identity in a descriptor without invoking it.
      const partial = 'value' in descriptor ? { value: descriptor.value as unknown } : { get: descriptor.get };
      expect(Reflect.defineProperty(location, key, partial)).toBe(true);
      expect(Object.getOwnPropertyDescriptor(location, key)).toEqual(descriptor);
    }
  });

  it('rejects descriptor changes, replacement, and deletion of all initial properties', () => {
    const location = new Browlet({ route: () => '' }).window.location;
    for (const key of defaultKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(location, key)!;
      const replacements: PropertyDescriptor[] = [
        { configurable: true }, { enumerable: !descriptor.enumerable },
        { value: () => 'forged' }, { get: () => 'forged' }, { set() {} },
      ];
      if ('value' in descriptor) replacements.push({ writable: true });
      for (const replacement of replacements) {
        expect(Reflect.defineProperty(location, key, replacement)).toBe(false);
        expect(Object.getOwnPropertyDescriptor(location, key)).toEqual(descriptor);
      }
      expect(Reflect.deleteProperty(location, key)).toBe(false);
      expect(Object.getOwnPropertyDescriptor(location, key)).toEqual(descriptor);
    }
  });

  it('rejects assignment of frozen methods without defining a property on a different receiver', () => {
    const location = new Browlet({ route: () => '' }).window.location;
    for (const key of [...methods, 'valueOf', Symbol.toPrimitive]) {
      const receiver = {};
      const descriptor = Object.getOwnPropertyDescriptor(location, key);
      expect(Reflect.set(location, key, () => 'forged')).toBe(false);
      expect(Reflect.set(location, key, () => 'forged', receiver)).toBe(false);
      expect(Reflect.ownKeys(receiver)).toEqual([]);
      expect(Object.getOwnPropertyDescriptor(location, key)).toEqual(descriptor);
    }
  });

  it('accepts a no-op but throws the author realm TypeError for an incompatible definition', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- This no-op definition preserves the original function identity.
      const unchanged = Object.defineProperty(location, 'assign', { value: location.assign }) === location;
      try {
        Object.defineProperty(location, 'assign', { value: () => {} });
        return { unchanged, rejected: false };
      } catch (error) {
        return { unchanged, rejected: error instanceof TypeError };
      }
    })).toEqual({ unchanged: true, rejected: true });
  });

  it.each(['valueOf', 'toString', '@@toPrimitive'])(
    'keeps string conversion intact after attempted deletion of %s and prototype poisoning', async (name) => {
      const browser = new Browlet({ route: () => '' });
      expect(await browser.evaluate((name) => {
        const key = name === '@@toPrimitive' ? Symbol.toPrimitive : name;
        Object.defineProperty(Location.prototype, key, { value: () => 'forged', configurable: true });
        return {
          deleted: Reflect.deleteProperty(location, key),
          string: String(location),
          concatenation: (location as unknown as string) + '',
          propertyKey: Object.keys({ [location as unknown as string]: true })[0],
        };
      }, name)).toEqual({ deleted: false, string: 'about:blank', concatenation: 'about:blank', propertyKey: 'about:blank' });
    },
  );

  it('preserves ordinary rules for author-defined string and symbol properties', () => {
    const location = new Browlet({ route: () => '' }).window.location;
    for (const key of ['extra', Symbol('extra')]) {
      expect(Reflect.defineProperty(location, key, {
        value: 1, writable: true, enumerable: true, configurable: true,
      })).toBe(true);
      expect(Reflect.set(location, key, 2)).toBe(true);
      expect(Reflect.get(location, key)).toBe(2);
      expect(Reflect.deleteProperty(location, key)).toBe(true);
      expect(Object.hasOwn(location, key)).toBe(false);

      expect(Reflect.defineProperty(location, key, { value: 3 })).toBe(true);
      expect(Object.getOwnPropertyDescriptor(location, key)).toEqual({
        value: 3, writable: false, enumerable: false, configurable: false,
      });
      expect(Reflect.defineProperty(location, key, { value: 3 })).toBe(true);
      expect(Reflect.defineProperty(location, key, { value: 4 })).toBe(false);
      expect(Reflect.deleteProperty(location, key)).toBe(false);
    }
  });
});
