import { describe, expect, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { ImportMap } from '../../../src/browlet/scripting/import-map';
import { JSModuleScript } from '../../../src/browlet/scripting/script';
import { ScriptFetchOptions } from '../../../src/browlet/scripting/script-fetch-options';
import { getRelevantRealm } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';
import { createSiblingWindow } from '../../support/windows';
import { itPassesWith } from '../../test-runtime';

// Official addon bases retain the approved missing-forwarding-export failure.
// Stock Node's VM initializer works without that addon-specific export.
const testMeta = itPassesWith('importMeta');

describe('HTML HostGetImportMetaProperties', () => {
  testMeta('initializes stable, mutable metadata with the module URL and a realm-owned resolve function', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const script = f.script('export const meta = import.meta; export const again = import.meta;');
      const namespace = evaluate(script) as { meta: ImportMeta; again: ImportMeta; };
      const { meta } = namespace;
      expect(namespace.again).toBe(meta);
      expect(Object.getPrototypeOf(meta)).toBeNull();
      expect(Reflect.ownKeys(meta)).toEqual(['url', 'resolve']);
      expect(meta.url).toBe('https://modules.test/app/main.js?query#fragment');
      for (const key of ['url', 'resolve']) {
        expect(Object.getOwnPropertyDescriptor(meta, key)).toMatchObject({
          writable: true, enumerable: true, configurable: true,
        });
      }
      expect(Object.getPrototypeOf(meta.resolve)).toBe(f.env.realm.functionPrototype);
      expect(meta.resolve.name).toBe('resolve');
      expect(meta.resolve.length).toBe(1);
      expect(Reflect.has(meta.resolve, 'prototype')).toBe(false);
      expect(meta.resolve('./child.js')).toBe('https://modules.test/app/child.js');
      meta.url = 'https://changed.test/';
      expect(Reflect.apply(meta.resolve, null, ['./child.js', 'https://ignored.test/']))
        .toBe('https://modules.test/app/child.js');
      expect(() => { Reflect.construct(meta.resolve, []); }).toThrow();
      expect(Reflect.deleteProperty(meta, 'url')).toBe(true);
    });
  });

  testMeta('initializes lazily and retains separate metadata for records with identical source URLs', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const source = 'export function readMeta() { return import.meta; }';
      const first = f.script(source);
      const second = f.script(source);
      const initializeFirst = vi.spyOn(first.compiled!, 'getImportMetaProperties');
      const initializeSecond = vi.spyOn(second.compiled!, 'getImportMetaProperties');
      const a = evaluate(first) as { readMeta(): ImportMeta; };
      const b = evaluate(second) as { readMeta(): ImportMeta; };
      expect(initializeFirst).not.toHaveBeenCalled();
      expect(initializeSecond).not.toHaveBeenCalled();
      const meta = a.readMeta();
      expect(meta.url).toBe('https://modules.test/app/main.js?query#fragment');
      expect(a.readMeta()).toBe(meta);
      expect(initializeFirst).toHaveBeenCalledOnce();
      const other = b.readMeta();
      expect(other).not.toBe(meta);
      expect(other.resolve).not.toBe(meta.resolve);
      expect(other.url).toBe(meta.url);
      expect(initializeSecond).toHaveBeenCalledOnce();
    });
  });

  testMeta('resolves against the module scope and its live import map without fetching', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const { meta } = evaluate(f.script('export const meta = import.meta;')) as { meta: ImportMeta; };
      f.env.globalImplementation.mergeImportMap(ImportMap.parse(JSON.stringify({
        imports: { lib: '/top.js', blocked: null, late: '/late.js' },
        scopes: { '/app/': { lib: '/scoped.js', 'pkg/': '/packages/' } },
      }), f.baseURL, f.env));
      expect(meta.resolve('lib')).toBe('https://modules.test/scoped.js');
      expect(meta.resolve('pkg/child.js')).toBe('https://modules.test/packages/child.js');
      expect(meta.resolve('late')).toBe('https://modules.test/late.js');
      expect(meta.resolve('./not-downloaded.js')).toBe('https://modules.test/app/not-downloaded.js');
      for (const specifier of ['blocked', 'missing', 'https://[invalid']) {
        expect(() => meta.resolve(specifier)).toThrow(f.env.realm.TypeError);
      }
      expect(f.route).not.toHaveBeenCalled();
      expect([...f.env.globalImplementation.resolvedModuleSet].map((entry) => entry.specifier))
        .toEqual(['lib', 'pkg/child.js', 'late', 'https://modules.test/app/not-downloaded.js']);

      // Resolution fixes an import-map mapping even though no fetch occurred.
      f.env.globalImplementation.mergeImportMap(ImportMap.parse(
        '{"imports":{"late":"/replacement.js"}}', f.baseURL, f.env,
      ));
      expect(meta.resolve('late')).toBe('https://modules.test/late.js');
    });
  });

  testMeta('performs ToString with the string hint and preserves thrown author values', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const { meta } = evaluate(f.script('export const meta = import.meta;')) as { meta: ImportMeta; };
      f.env.globalImplementation.importMap = ImportMap.parse(JSON.stringify({
        imports: { undefined: '/undefined.js', null: '/null.js', true: '/true.js', 17: '/number.js' },
      }), f.baseURL, f.env);
      Reflect.set(f.env.realm.globalObject, 'String', () => 'replaced');
      expect(meta.resolve()).toBe('https://modules.test/undefined.js');
      expect(meta.resolve(null)).toBe('https://modules.test/null.js');
      expect(meta.resolve(true)).toBe('https://modules.test/true.js');
      expect(meta.resolve(17n)).toBe('https://modules.test/number.js');
      const toPrimitive = vi.fn((hint: string) => {
        expect(hint).toBe('string');
        return './converted.js';
      });
      const value = { [Symbol.toPrimitive]: toPrimitive };
      expect(meta.resolve(value)).toBe('https://modules.test/app/converted.js');
      expect(toPrimitive).toHaveBeenCalledExactlyOnceWith('string');
      expect(toPrimitive.mock.contexts[0]).toBe(value);

      for (const invalid of [
        Symbol(), Object(Symbol()), { [Symbol.toPrimitive]: () => Symbol() },
        { [Symbol.toPrimitive]: () => ({}) }, { toString: () => ({}), valueOf: () => ({}) },
      ]) {
        expect(() => meta.resolve(invalid)).toThrow(f.env.realm.TypeError);
      }
      const sentinel = {};
      let caught: unknown;
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- Author code can throw any value.
      try { meta.resolve({ [Symbol.toPrimitive]() { throw sentinel; } }); }
      catch (error) { caught = error; }
      expect(caught).toBe(sentinel);
    });
  });

  testMeta('keeps the module map and exception realm when resolve is called from another Window', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const other = getRelevantRealm(createSiblingWindow(f.browser));
      f.env.globalImplementation.importMap = ImportMap.parse('{"imports":{"lib":"/owner.js"}}', f.baseURL, f.env);
      other.env.globalImplementation.importMap = ImportMap.parse('{"imports":{"lib":"/caller.js"}}', f.baseURL, other.env);
      const { meta } = evaluate(f.script('export const meta = import.meta;')) as { meta: ImportMeta; };
      Reflect.set(other.globalObject, 'resolveModule', meta.resolve);
      const result = other.evaluate(`
        (() => {
          const url = resolveModule('lib');
          try { resolveModule('missing'); }
          catch (error) { return { url, error }; }
        })()
      `, 'call-import-meta-resolve.js') as { url: string; error: unknown; };
      expect(result.url).toBe('https://modules.test/owner.js');
      expect(Object.getPrototypeOf(result.error)).toBe(f.env.realm.TypeError.prototype);
      expect(other.env.globalImplementation.resolvedModuleSet.size).toBe(0);
    });
  });

  testMeta('associates dependency metadata after top-level await with its own module record', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const gate = f.env.realm.NativePromise.withResolvers<void>();
      Reflect.set(f.env.global, 'gate', gate.promise);
      const child = new JSModuleScript(
        'await gate; export const meta = import.meta;', f.env,
        f.env.parseURL('https://modules.test/dependency/child.js')!, new ScriptFetchOptions(),
      );
      const root = f.script('export { meta as childMeta } from "./child.js"; export const meta = import.meta;');
      root.compiled!.loadedModules.set(root.compiled!.requestedModules[0]!, child.compiled!);
      root.compiled!.link();
      let result: { state: string; error?: unknown; } = { state: 'pending' };
      root.run(true).observe(() => { result = { state: 'fulfilled' }; }, (error) => {
        result = { state: 'rejected', error };
      });
      f.env.responsibleEventLoop.performMicrotaskCheckpoint();
      expect(result).toEqual({ state: 'pending' });
      gate.resolve();
      f.env.responsibleEventLoop.performMicrotaskCheckpoint();
      expect(result).toEqual({ state: 'fulfilled' });
      const { meta, childMeta } = f.env.realm.getModuleNamespace(root.compiled!.code) as {
        meta: ImportMeta; childMeta: ImportMeta;
      };
      expect(childMeta.url).toBe('https://modules.test/dependency/child.js');
      expect(childMeta.resolve('./next.js')).toBe('https://modules.test/dependency/next.js');
      expect(meta.url).toBe('https://modules.test/app/main.js?query#fragment');
      expect(childMeta).not.toBe(meta);
      expect(f.env.responsibleEventLoop.executionContextStack).toEqual([]);
    });
  });
});

function fixture() {
  const route = vi.fn(() => '');
  const browser = new Browlet({ route, reporting: false });
  const env = getRelevantRealm(browser.window).env;
  const baseURL = env.parseURL('https://modules.test/app/main.js?query#fragment')!;
  return {
    browser, env, baseURL, route,
    script: (source: string) => new JSModuleScript(source, env, baseURL, new ScriptFetchOptions()),
  };
}

function evaluate(script: JSModuleScript): object {
  expect(script.parseError).toBeNull();
  script.compiled!.link();
  let result: { state: string; error?: unknown; } = { state: 'pending' };
  script.run(true).observe(() => { result = { state: 'fulfilled' }; }, (error) => {
    result = { state: 'rejected', error };
  });
  script.env.responsibleEventLoop.performMicrotaskCheckpoint();
  expect(result).toEqual({ state: 'fulfilled' });
  return script.env.realm.getModuleNamespace(script.compiled!.code);
}

interface ImportMeta {
  url: string;
  resolve: (specifier?: unknown) => string;
}
