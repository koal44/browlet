import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { CrossOriginObjectBinding } from '../../../../src/browlet/integration/web-idl/bindings/cross-origin';
import { obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { getBindingContext, getRelevantRealm, project, unwrap } from '../../../support/browlet-binding';

describe('Location immutable prototype', () => {
  it('accepts its existing prototype and preserves platform identity', () => {
    const browser = new Browlet({ route: () => '' });
    const location = browser.window.location;
    const prototype = browser.window.Location.prototype;
    expect(Reflect.getPrototypeOf(location)).toBe(prototype);
    expect(Reflect.setPrototypeOf(location, prototype)).toBe(true);
    expect(project(unwrap(location))).toBe(location);
    expect(location.valueOf()).toBe(location);
    expect(location).toBeInstanceOf(browser.window.Location);
    expect(getRelevantRealm(location)).toBe(getRelevantRealm(browser.document));
  });

  it.each([null, {}])('rejects a different prototype %s without changing storage', (prototype) => {
    const browser = new Browlet({ route: () => '' });
    const location = browser.window.location;
    expect(Reflect.setPrototypeOf(location, prototype)).toBe(false);
    expect(Reflect.getPrototypeOf(location)).toBe(browser.window.Location.prototype);
    expect(location.href).toBe('about:blank');
  });

  it('throws the caller-realm TypeError through Object.setPrototypeOf and __proto__', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const results = [];
      for (const operation of [
        () => { Object.setPrototypeOf(location, null); },
        () => Reflect.set(location, '__proto__', null),
      ]) {
        try { operation(); results.push(false); }
        catch (error) { results.push(error instanceof TypeError); }
      }
      return [...results, Object.getPrototypeOf(location) === Location.prototype];
    })).toEqual([true, true, true]);
  });

  it('leaves the Location prototype object itself mutable', () => {
    const browser = new Browlet({ route: () => '' });
    const location = browser.window.location;
    const prototype = browser.window.Location.prototype;
    const ancestor = { inheritedProbe: 7 };
    expect(Reflect.setPrototypeOf(prototype, ancestor)).toBe(true);
    expect(Reflect.getPrototypeOf(location)).toBe(prototype);
    expect(Reflect.get(location, 'inheritedProbe')).toBe(7);
  });

  it('preserves default and explicit receivers for author accessors', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const receiver = {};
      const seen: object[] = [];
      Object.defineProperty(location, 'receiverProbe', {
        get(this: object) { return this; },
        set(this: object, _value: unknown) { seen.push(this); },
        configurable: true,
      });
      return [
        Reflect.get(location, 'receiverProbe') === location,
        Reflect.get(location, 'receiverProbe', receiver) === receiver,
        Reflect.set(location, 'receiverProbe', 1), seen[0] === location,
        Reflect.set(location, 'receiverProbe', 2, receiver), seen[1] === receiver,
      ];
    })).toEqual([true, true, true, true, true, true]);
  });
});

// The caller and ordinary prototype are explicit engine inputs until native reflection can supply them.
describe('Caller-bound Location prototypes', () => {
  it('returns the target ordinary prototype for a same-origin caller', () => {
    const { target, callerDocument, targetDocument, binding } = createPair();
    callerDocument.origin = targetDocument.origin;
    const location = target.window.location;
    const ordinaryPrototype = Reflect.getPrototypeOf(location);
    expect(binding.getLocationPrototypeOf(location, ordinaryPrototype)).toBe(target.window.Location.prototype);
    expect(binding.setLocationPrototypeOf(ordinaryPrototype, location, ordinaryPrototype)).toBe(true);
    expect(binding.setLocationPrototypeOf(null, location, ordinaryPrototype)).toBe(false);
  });

  it('compares a foreign proposal with the visible null prototype without changing storage', () => {
    const { target, binding } = createPair();
    const location = target.window.location;
    const ordinaryPrototype = Reflect.getPrototypeOf(location);
    expect(binding.getLocationPrototypeOf(location, ordinaryPrototype)).toBeNull();
    expect(binding.setLocationPrototypeOf(null, location, ordinaryPrototype)).toBe(true);
    expect(binding.setLocationPrototypeOf(ordinaryPrototype, location, ordinaryPrototype)).toBe(false);
    expect(binding.setLocationPrototypeOf({}, location, ordinaryPrototype)).toBe(false);
    expect(Reflect.getPrototypeOf(location)).toBe(ordinaryPrototype);
  });

  it('rechecks origin-domain changes without replacing the Location or its ordinary prototype', () => {
    const { target, callerDocument, targetDocument, binding } = createPair();
    callerDocument.origin = obtainURLOrigin(parseURL('https://example.test/').url!);
    targetDocument.origin = obtainURLOrigin(parseURL('https://example.test/').url!);
    if (callerDocument.origin.kind !== 'tuple' || targetDocument.origin.kind !== 'tuple') {
      throw new Error('Expected tuple origins');
    }
    const location = target.window.location;
    const ordinaryPrototype = Reflect.getPrototypeOf(location);
    expect(binding.getLocationPrototypeOf(location, ordinaryPrototype)).toBe(ordinaryPrototype);
    targetDocument.origin.domain = { kind: 'domain', value: 'example.test' };
    expect(binding.getLocationPrototypeOf(location, ordinaryPrototype)).toBeNull();
    expect(binding.setLocationPrototypeOf(null, location, ordinaryPrototype)).toBe(true);
    callerDocument.origin.domain = { kind: 'domain', value: 'example.test' };
    expect(binding.getLocationPrototypeOf(location, ordinaryPrototype)).toBe(ordinaryPrototype);
    expect(binding.setLocationPrototypeOf(null, location, ordinaryPrototype)).toBe(false);
    expect(target.window.location).toBe(location);
    expect(Reflect.getPrototypeOf(location)).toBe(ordinaryPrototype);
  });

  it('keeps a retained Location tied to its own realm rather than its live relevant Document', async () => {
    const { target, callerDocument, binding } = createPair();
    await target.navigate('https://example.test/first');
    callerDocument.origin = unwrap<DocumentImpl>(target.document).origin;
    const location = target.window.location;
    const ordinaryPrototype = Reflect.getPrototypeOf(location);
    await target.navigate('https://other.test/second');
    const replacement = target.window.location;
    expect(binding.getLocationPrototypeOf(location, ordinaryPrototype)).toBe(ordinaryPrototype);
    expect(binding.getLocationPrototypeOf(replacement, Reflect.getPrototypeOf(replacement))).toBeNull();
    expect(Reflect.getPrototypeOf(location)).toBe(ordinaryPrototype);
  });
});

function createPair() {
  const caller = new Browlet({ route: () => '' });
  const target = new Browlet({ route: () => '' });
  const callerDocument = unwrap<DocumentImpl>(caller.document);
  const targetDocument = unwrap<DocumentImpl>(target.document);
  return {
    target, callerDocument, targetDocument,
    binding: new CrossOriginObjectBinding(getBindingContext(callerDocument.env.realm)),
  };
}
