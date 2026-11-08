import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import {
  JSModuleScript, JSONModuleScript, TextModuleScript, CSSModuleScript,
} from '../../../src/browlet/scripting/script';
import { fetchDescendantsAndLink } from '../../../src/browlet/scripting/script-fetching';
import { ScriptFetchOptions } from '../../../src/browlet/scripting/script-fetch-options';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';

describe('HTML module records and engine execution', () => {
  it('parses source without executing it and retains realm-owned syntax failures', () => {
    const { env, baseURL, options } = fixture();
    const script = new JSModuleScript('globalThis.executed = true; export const value = 1;', env, baseURL, options);
    expect(script.compiled!.script).toBe(script);
    expect(script.compiled!.requestedModules).toEqual([]);
    expect(Reflect.has(env.global, 'executed')).toBe(false);
    const hasInstance = vi.fn(() => { throw new Error('author hasInstance'); });
    Object.defineProperty(env.realm.SyntaxError, Symbol.hasInstance, { value: hasInstance });
    const failed = new JSModuleScript('export const =', env, baseURL, options);
    expect(failed.compiled).toBeNull();
    expect(Object.getPrototypeOf(failed.parseError)).toBe(env.realm.SyntaxError.prototype);
    expect(failed.errorToRethrow).toBeNull();
    expect(hasInstance).not.toHaveBeenCalled();
  });

  it('loads and evaluates a dependency-free inline module through HTML', async () => {
    const { env, baseURL, options } = fixture();
    const finished = Promise.withResolvers<void>();
    await runInHostTask(() => {
      env.fetchInlineModuleScriptGraph('export default { answer: 42 };', baseURL, options, (script) => {
        expect(script).not.toBeNull();
        const completion = script!.run(true);
        expect(completion).toBeInstanceOf(env.InternalPromise);
        completion.observe(() => {
          const value = Reflect.get(env.realm.getModuleNamespace(script!.compiled!.code), 'default') as { answer: number; };
          expect(value.answer).toBe(42);
          expect(Object.getPrototypeOf(value)).toBe(env.realm.objectPrototype);
          finished.resolve();
        }, finished.reject);
      });
      env.responsibleEventLoop.performMicrotaskCheckpoint();
    });
    await finished.promise;
    expect(env.responsibleEventLoop.executionContextStack).toEqual([]);
  });

  it.each([
    'import value from "./data.json"',
    'export { default as value } from "./data.json"',
    'export * from "./data.json"',
  ])('retains unknown attribute names for loading, not parsing: %s', (declaration) => {
    const { env, baseURL, options } = fixture();
    const script = new JSModuleScript(
      `${declaration} with { type: "json", integrity: "kept" };`, env, baseURL, options,
    );
    expect(script.parseError).toBeNull();
    expect(script.errorToRethrow).toBeNull();
    expect(script.compiled!.requestedModules).toHaveLength(1);
    const request = script.compiled!.requestedModules[0]!;
    expect(request.specifier).toBe('./data.json');
    expect(request.attributes).toHaveLength(2);
    expect(request.attributes).toEqual(expect.arrayContaining([
      { key: 'type', value: 'json' }, { key: 'integrity', value: 'kept' },
    ]));
    // Type selection does not stand in for the separate supported-name check.
    expect(request.getModuleType()).toBe('json');
  });

  it('imports JSON, text, and a projected stylesheet from supplied records', async () => {
    await runInHostTask(() => {
      const { browser, env, baseURL, options } = fixture();
      const root = new JSModuleScript([
        'import data from "data" with { type: "json" };',
        'import text from "text" with { type: "text" };',
        'import sheet from "sheet" with { type: "css" };',
        'export { data, text, sheet };',
        'export const validSheet = sheet instanceof CSSStyleSheet;',
      ].join('\n'), env, baseURL, options);
      const json = new JSONModuleScript('{"answer":42}', env);
      const text = new TextModuleScript('kept\n', env);
      const css = new CSSModuleScript('div { color: red; }', baseURL, env);
      const dependencies = [json, text, css];
      root.compiled!.requestedModules.forEach((request, index) => {
        root.compiled!.loadedModules.set(request, dependencies[index]!.compiled!);
      });
      root.compiled!.link();
      let completed = false;
      root.run(true).observe(() => { completed = true; }, (error) => { throw error; });
      env.responsibleEventLoop.performMicrotaskCheckpoint();
      expect(completed).toBe(true);
      const namespace = env.realm.getModuleNamespace(root.compiled!.code) as {
        data: { answer: number; }; text: string; sheet: CSSStyleSheet; validSheet: boolean;
      };
      expect(namespace.data).toBe(json.compiled!.defaultExport);
      expect(namespace.text).toBe('kept\n');
      expect(namespace.sheet).toBe(css.compiled!.defaultExport);
      expect(namespace.validSheet).toBe(true);
      expect(unwrap(namespace.sheet)).not.toBe(namespace.sheet);
      expect(namespace.sheet.cssRules[0]!.cssText).toBe('div { color: red; }');
      expect(browser.document.adoptedStyleSheets).toHaveLength(0);
    });
  });

  it('rejects unresolved static imports before fetching and cannot link an incomplete graph', async () => {
    await runInHostTask(() => {
      const { env, baseURL, options } = fixture();
      const script = new JSModuleScript('import "missing";', env, baseURL, options);
      const complete = vi.fn();
      const fetch = vi.spyOn(env, 'fetchSingleImportedModuleScript');
      fetchDescendantsAndLink(script, env, 'script', complete);
      env.responsibleEventLoop.performMicrotaskCheckpoint();
      expect(complete).toHaveBeenCalledExactlyOnceWith(script);
      expect(script.errorToRethrow).toBeInstanceOf(env.realm.TypeError);
      expect(fetch).not.toHaveBeenCalled();
      expect(() => script.compiled!.link()).toThrow('Module dependency loading is not implemented');
    });
  });

  it.each(['fulfill', 'reject'] as const)('delivers top-level await %s through the owning environment', async (outcome) => {
    await runInHostTask(() => {
      const { env, baseURL, options } = fixture();
      const gate = env.realm.NativePromise.withResolvers<void>();
      Reflect.set(env.global, 'gate', gate.promise);
      const script = new JSModuleScript('await gate; export default 42;', env, baseURL, options);
      script.compiled!.link();
      const completed = vi.fn();
      const rejected = vi.fn();
      const result = script.run(true);
      expect(result).toBeInstanceOf(env.InternalPromise);
      result.observe(completed, rejected);
      env.responsibleEventLoop.performMicrotaskCheckpoint();
      expect(completed).not.toHaveBeenCalled();
      expect(rejected).not.toHaveBeenCalled();
      expect(env.responsibleEventLoop.executionContextStack).toEqual([]);
      const reason = new env.realm.Error('await failed');
      if (outcome === 'fulfill') gate.resolve();
      else gate.reject(reason);
      env.responsibleEventLoop.performMicrotaskCheckpoint();
      if (outcome === 'fulfill') {
        expect(completed).toHaveBeenCalledExactlyOnceWith(undefined);
        expect(Reflect.get(env.realm.getModuleNamespace(script.compiled!.code), 'default')).toBe(42);
      } else {
        expect(rejected).toHaveBeenCalledExactlyOnceWith(reason);
      }
      expect(env.responsibleEventLoop.executionContextStack).toEqual([]);
    });
  });
});

function fixture() {
  const browser = new Browlet({ route: () => '', reporting: false });
  const env = getRelevantRealm(browser.window).env;
  return { browser, env, baseURL: env.parseURL('https://modules.test/root.js')!, options: new ScriptFetchOptions() };
}
