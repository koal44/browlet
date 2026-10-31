import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { CSPList } from '../../../src/browlet/browsing/policy/csp/list';
import { ContentSecurityPolicy, type CSPDisposition } from '../../../src/browlet/browsing/policy/csp/policy';
import type { Window as PlatformWindow } from '../../../src/browlet/platform';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';
import { itPassesWith } from '../../test-runtime';
import { createCSPWindow } from '../browsing/policy/csp/fixture';

// Previously approved: stock mode and official addon bases lack the forwarding
// export used for native string compilation. Keep the assertions active there.
const itCompiles = itPassesWith('codeGeneration');

describe('CSP native string compilation', () => {
  itCompiles.each(['direct eval', 'indirect eval', 'Function'])(
    'blocks %s with a page-realm EvalError before running the supplied code', async (kind) => {
      const { browlet } = createPage("script-src 'self'");
      expect(await browlet.evaluate((kind) => {
        Reflect.set(globalThis, 'executed', false);
        try {
          const source = 'globalThis.executed = true';
          if (kind === 'direct eval') eval(source);
          else if (kind === 'indirect eval') (0, eval)(source);
          // eslint-disable-next-line @typescript-eslint/no-implied-eval -- Exercise native Function compilation.
          else (Function(source) as () => void)();
          return [false, Reflect.get(globalThis, 'executed') as boolean];
        } catch (error) {
          return [error instanceof EvalError, Reflect.get(globalThis, 'executed') as boolean];
        }
      }, kind)).toEqual([true, false]);
    },
  );

  it.each(["script-src 'unsafe-eval'", "default-src 'UnSaFe-EvAl'"])(
    'allows ordinary native compilation and direct eval scope with %s', async (policy) => {
      const { browlet } = createPage(policy);
      expect(await browlet.evaluate(() => {
        const local = 40;
        // eslint-disable-next-line @typescript-eslint/no-implied-eval -- Exercise native Function compilation.
        const compiled = Function('value', 'return value + 2') as (value: number) => number;
        return [local, eval('local + 2') as unknown, (0, eval)('40 + 2') as unknown, compiled(40)];
      })).toEqual([40, 42, 42, 42]);
    },
  );

  itCompiles.each(['string', 'direct TrustedScript', 'indirect TrustedScript'])(
    'reports monitored compilation once while allowing %s to run', (kind) => {
      const { window, document, scope, runTask } = createCSPWindow();
      const directEval = window.eval('(input) => eval(input)') as (input: unknown) => unknown;
      document.policyContainer.cspList!.policies.push(ContentSecurityPolicy.parse(
        "script-src 'none' 'report-sample'; report-to scripts", 'header', 'report',
      ));
      const platform = window as unknown as PlatformWindow;
      const input = kind === 'string' ? '40 + 2' :
        platform.trustedTypes.createPolicy('source', { createScript: (value) => value }).createScript('40 + 2');
      expect(kind === 'indirect TrustedScript' ? window.eval(input as string) : directEval(input)).toBe(42);
      expect(runTask()).toBe(true);
      expect(scope.reports[0]!.data).toMatchObject({
        blockedURL: 'eval', effectiveDirective: 'script-src', disposition: 'report', sample: '40 + 2',
      });
      expect(runTask()).toBe(false);
    },
  );

  itCompiles.each(['generator', 'async', 'async generator'])(
    'also gates the %s function constructor', async (kind) => {
      const { browlet } = createPage("default-src 'none'");
      expect(await browlet.evaluate((kind) => {
        const exemplar = kind === 'generator' ? function* () {} :
          kind === 'async' ? async function() {} : async function* () {};
        const constructor = Reflect.get(Object.getPrototypeOf(exemplar), 'constructor') as FunctionConstructor;
        try {
          Reflect.construct(constructor, ['return 42']);
          return false;
        } catch (error) {
          return error instanceof EvalError;
        }
      }, kind)).toBe(true);
    },
  );

  itCompiles('rechecks cached source against the live policy without disabling previously compiled functions', async () => {
    const { browlet, env, realm } = createPage("script-src 'unsafe-eval'");
    await browlet.evaluate(() => {
      Reflect.set(globalThis, 'compilation', {
        evaluate: () => eval('40 + 2') as unknown,
        // eslint-disable-next-line @typescript-eslint/no-implied-eval -- Exercise repeated native Function compilation.
        compile: () => Function('return 42') as () => number,
      });
    });
    // Retain the live functions through the Window; evaluate copies its result.
    const functions = Reflect.get(browlet.window, 'compilation') as {
      evaluate: () => unknown; compile: () => () => number;
    };
    const compiled = functions.compile();
    expect(functions.evaluate()).toBe(42);
    expect(compiled()).toBe(42);

    const policies = new CSPList(env.origin);
    policies.policies.push(ContentSecurityPolicy.parse("script-src 'none'", 'header', 'enforce'));
    env.policyContainer.cspList = policies;
    expect(functions.evaluate).toThrow(realm.EvalError);
    expect(functions.compile).toThrow(realm.EvalError);
    expect(compiled()).toBe(42);

    policies.policies.length = 0;
    expect(functions.evaluate()).toBe(42);
    expect(functions.compile()()).toBe(42);
  });

  itCompiles.each([true, false])('uses borrowed eval and Function realms rather than the caller (target blocks: %s)', async (targetBlocks) => {
    const { browlet } = createPage(targetBlocks ? "script-src 'unsafe-eval'" : "script-src 'none'");
    const foreign = createSiblingWindow(browlet);
    const targetEnv = getRelevantRealm(foreign).env;
    const policies = new CSPList(targetEnv.origin);
    policies.policies.push(ContentSecurityPolicy.parse(
      targetBlocks ? "script-src 'none'" : "script-src 'unsafe-eval'", 'header', 'enforce',
    ));
    targetEnv.policyContainer.cspList = policies;
    Reflect.set(browlet.window, 'foreign', foreign);
    expect(await browlet.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const results: (number | boolean)[] = [];
      try { results.push(eval('40 + 2') as number); }
      catch (error) { results.push(error instanceof EvalError); }
      try { results.push(foreign.eval('40 + 2') as number); }
      catch (error) { results.push(error instanceof foreign.EvalError && !(error instanceof EvalError)); }
      try { results.push((foreign.Function('return 42') as () => number)()); }
      catch (error) { results.push(error instanceof foreign.EvalError && !(error instanceof EvalError)); }
      return results;
    })).toEqual(targetBlocks ? [42, true, true] : [true, 42, 42]);
  });

  it('leaves non-code eval arguments unchanged under a blocking policy', async () => {
    const { browlet } = createPage("script-src 'none'");
    expect(await browlet.evaluate(() => {
      const values: unknown[] = [
        undefined, null, 0, true, Symbol('input'), Object('40 + 2'),
        new Proxy({}, { get() { throw new Error('Unexpected coercion'); } }),
      ];
      return values.every((value) => eval(value as string) === value && (0, eval)(value as string) === value);
    })).toBe(true);
  });

  itCompiles('does not let extracted TrustedScript bypass a source-list restriction, including empty source', async () => {
    const { browlet } = createPage("script-src 'none'");
    expect(await browlet.evaluate(() => {
      const scope = globalThis as unknown as PlatformWindow;
      const policy = scope.trustedTypes.createPolicy('source', { createScript: (value) => value });
      return [policy.createScript('40 + 2'), scope.trustedTypes.emptyScript].map((value) => {
        try {
          eval(value as unknown as string);
          return false;
        } catch (error) {
          return error instanceof EvalError;
        }
      });
    })).toEqual([true, true]);
  });
});

function createPage(serialized = '', disposition: CSPDisposition = 'enforce') {
  const browlet = new Browlet({ route: () => '' });
  const realm = getRelevantRealm(browlet.window);
  const env = realm.env;
  const policies = new CSPList(env.origin);
  policies.policies.push(ContentSecurityPolicy.parse(serialized, 'header', disposition));
  env.policyContainer.cspList = policies;
  return { browlet, realm, env, policies };
}
