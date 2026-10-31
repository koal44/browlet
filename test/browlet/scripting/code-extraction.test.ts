import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { Window as PlatformWindow } from '../../../src/browlet/platform';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';
import { itPassesWith } from '../../test-runtime';

// Previously approved: stock mode and official addon bases cannot expose the
// source-extraction callback. Keep the required behavior as expected failures.
const itExtracts = itPassesWith('codeGeneration');

describe('HostGetCodeForEval', () => {
  itExtracts('extracts retained TrustedScript data without coercion and preserves direct eval scope', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const scope = globalThis as unknown as PlatformWindow;
      const policy = scope.trustedTypes.createPolicy('eval', { createScript: (value) => value });
      const script = policy.createScript('local + 2');
      Object.defineProperties(script, {
        data: { get() { throw new Error('author data'); } },
        toString: { value() { throw new Error('author stringifier'); } },
        [Symbol.toPrimitive]: { value() { throw new Error('author coercion'); } },
      });
      Object.setPrototypeOf(script, null);
      const local = 40;
      // TypeScript restricts eval to strings; ECMAScript accepts every language value.
      return [local, eval(script as unknown as string) as unknown];
    })).toEqual([40, 42]);
  });

  itExtracts('distinguishes empty trusted source from no-code and reports syntax errors in the eval realm', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const scope = globalThis as unknown as PlatformWindow;
      const policy = scope.trustedTypes.createPolicy('eval', { createScript: (value) => value });
      const invalid = policy.createScript('let = ;');
      let syntaxError = false;
      try { eval(invalid as unknown as string); } catch (error) { syntaxError = error instanceof SyntaxError; }
      return [eval(scope.trustedTypes.emptyScript as unknown as string) === undefined, syntaxError];
    })).toEqual([true, true]);
  });

  itExtracts('recognizes a foreign TrustedScript while borrowed eval uses its own realm', async () => {
    const browlet = new Browlet({ route: () => '' });
    const foreign = createSiblingWindow(browlet);
    Reflect.set(browlet.window, 'foreign', foreign);
    Reflect.set(browlet.window, 'marker', 10);
    Reflect.set(foreign, 'marker', 40);
    expect(await browlet.evaluate(() => {
      const scope = globalThis as unknown as PlatformWindow;
      const foreign = Reflect.get(globalThis, 'foreign') as PlatformWindow & typeof globalThis;
      const own = scope.trustedTypes.createPolicy('own', { createScript: (value) => value })
        .createScript('globalThis.marker + 2');
      const other = foreign.trustedTypes.createPolicy('other', { createScript: (value) => value })
        .createScript('globalThis.marker + 2');
      return [eval(other as unknown as string) === 12, foreign.eval(own as unknown as string) === 42];
    })).toEqual([true, true]);
  });

  it('returns non-code inputs unchanged without consulting author properties', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const scope = globalThis as unknown as PlatformWindow;
      const policy = scope.trustedTypes.createPolicy('not-script', {
        createHTML: (value) => value, createScriptURL: (value) => value,
      });
      const trusted = scope.trustedTypes.emptyScript;
      const proxy = new Proxy(trusted, {
        get() { throw new Error('get trap'); },
        getPrototypeOf() { throw new Error('prototype trap'); },
      });
      const revoked = Proxy.revocable(trusted, {});
      revoked.revoke();
      const values: unknown[] = [
        null, undefined, 42, true, Symbol('input'), Object('42'),
        { toString() { throw new Error('stringifier'); } },
        Object.create(scope.TrustedScript.prototype), proxy, revoked.proxy,
        policy.createHTML('42'), policy.createScriptURL('42'),
      ];
      return values.every((value) => eval(value as string) === value && (0, eval)(value as string) === value);
    })).toBe(true);
  });

  it('preserves native eval and Function and ordinary string compilation', async () => {
    const browlet = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browlet.window);
    expect(Reflect.get(browlet.window, 'Function')).toBe(realm.Function);
    expect(await browlet.evaluate(() => {
      const local = 40;
      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- Exercise the native Function compilation path.
      const compiled = Function('return 42') as () => number;
      return [local, eval('local + 2') as unknown, (0, eval)('40 + 2') as unknown, compiled(),
        Function.prototype.toString.call(eval).includes('[native code]')];
    })).toEqual([40, 42, 42, 42, true]);
  });
});
