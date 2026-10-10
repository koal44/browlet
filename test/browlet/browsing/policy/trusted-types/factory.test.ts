import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../../src/browlet/browlet';
import type { Window as PlatformWindow, CreateHTMLCallback } from '../../../../../src/browlet/platform';
import { createSiblingWindow } from '../../../../support/windows';

describe('Trusted Types factory', () => {
  it('retains per-global factory, empty value, and default policy identity', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const scope = globalThis as unknown as PlatformWindow;
      const factory = scope.trustedTypes;
      const before = factory.defaultPolicy;
      const policy = factory.createPolicy('default', { createHTML: (value) => value });
      let duplicateError = false;
      try { factory.createPolicy('default'); } catch (error) { duplicateError = error instanceof TypeError; }
      return [
        factory === scope.trustedTypes, before, factory.defaultPolicy === policy, duplicateError,
        factory.emptyHTML === factory.emptyHTML, factory.emptyScript === factory.emptyScript,
        factory.isHTML(factory.emptyHTML), factory.isScript(factory.emptyScript),
        String(factory.emptyHTML), String(factory.emptyScript),
        factory.createPolicy('app') !== factory.createPolicy('app'),
        factory.createPolicy('').name, factory.createPolicy('not a CSP token').name,
        Reflect.set(scope, 'trustedTypes', {}),
      ];
    })).toEqual([true, null, true, true, true, true, true, true, '', '', true, '', 'not a CSP token', false]);
  });

  it('recognizes brands without running author getters, proxy traps, or prototype checks', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const scope = globalThis as unknown as PlatformWindow;
      const factory = scope.trustedTypes;
      const policy = factory.createPolicy('brands', { createHTML: (value) => value });
      const value = policy.createHTML('real');
      const fake = Object.create(scope.TrustedHTML.prototype) as unknown;
      const proxy = new Proxy(value, {
        get() { throw new Error('get trap'); }, getPrototypeOf() { throw new Error('prototype trap'); },
      });
      const revoked = Proxy.revocable(value, {});
      revoked.revoke();
      const hostile = { get [Symbol.toStringTag]() { throw new Error('tag getter'); } };
      Object.setPrototypeOf(value, null);
      return [value, fake, proxy, revoked.proxy, hostile, null, undefined, '<b>raw</b>', 1, Symbol('x')]
        .map((candidate) => [factory.isHTML(candidate), factory.isScript(candidate), factory.isScriptURL(candidate)]);
    })).toEqual([[true, false, false], ...Array.from({ length: 9 }, () => [false, false, false])]);
  });

  it('preserves cross-realm brands, receiver-owned results, and independent factory state', () => {
    const first = new Browlet({ route: () => '' }).window;
    const second = new Browlet({ route: () => '' }).window;
    const policy = first.trustedTypes.createPolicy('default', { createHTML: (value) => value });
    const value = second.TrustedTypePolicy.prototype.createHTML.call(policy, 'foreign method');
    expect(value).toBeInstanceOf(first.TrustedHTML);
    expect(value).not.toBeInstanceOf(second.TrustedHTML);
    expect(second.trustedTypes.isHTML(value)).toBe(true);
    expect(second.TrustedHTML.prototype.toJSON.call(value)).toBe('foreign method');
    expect(second.trustedTypes.defaultPolicy).toBeNull();
    expect(first.trustedTypes.emptyHTML).not.toBe(second.trustedTypes.emptyHTML);
    const created = second.trustedTypes.createPolicy.call(first.trustedTypes, 'borrowed');
    expect(created).toBeInstanceOf(first.TrustedTypePolicy);
    expect(first.trustedTypes.defaultPolicy).toBe(policy);
    expect(second.trustedTypes.createPolicy('default')).toBe(second.trustedTypes.defaultPolicy);
  });

  it('rejects forged receivers with the borrowed method realm TypeError', () => {
    const first = new Browlet({ route: () => '' }).window;
    const second = new Browlet({ route: () => '' }).window;
    const methodRealmTypeError = (second as unknown as typeof globalThis).TypeError;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Deliberately supply a forged receiver.
    expect(() => Reflect.apply(second.trustedTypes.isHTML, {}, [first.trustedTypes.emptyHTML])).toThrow(methodRealmTypeError);
    expect(() => second.TrustedHTML.prototype.toJSON.call(first.trustedTypes.emptyScript)).toThrow(methodRealmTypeError);
  });

  it('invokes a foreign callback in its own realm while creating values in the policy realm', async () => {
    const foreign = new Browlet({ route: () => '' });
    const owner = createSiblingWindow(foreign);
    type CallbackGlobal = typeof globalThis & { policyCallback: CreateHTMLCallback; policyError: Error; };
    await foreign.evaluate(() => {
      const scope = globalThis as CallbackGlobal;
      scope.policyError = new Error('foreign callback');
      scope.policyCallback = (input) => {
        if (input === 'throw') throw scope.policyError;
        return { toString: () => scope.Error === Error ? 'foreign conversion' : 'wrong realm' } as unknown as string;
      };
    });
    const source = foreign.window as unknown as CallbackGlobal;
    const policy = owner.trustedTypes.createPolicy('foreign callback', { createHTML: source.policyCallback });
    const value = policy.createHTML('value');
    expect(value).toBeInstanceOf(owner.TrustedHTML);
    expect(value).not.toBeInstanceOf(foreign.window.TrustedHTML);
    expect(String(value)).toBe('foreign conversion');
    let caught: unknown;
    try { policy.createHTML('throw'); } catch (error) { caught = error; }
    expect(caught).toBe(source.policyError);
  });
});
