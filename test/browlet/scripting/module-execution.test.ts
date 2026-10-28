import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import {
  JavaScriptModuleScript, JSONModuleScript, TextModuleScript, CSSModuleScript,
} from '../../../src/browlet/scripting/script';
import { ScriptFetchOptions } from '../../../src/browlet/scripting/script-fetch-options';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';

describe('HTML module records and engine execution', () => {
  it('parses source without executing it and retains realm-owned syntax failures', () => {
    const { env, baseURL, options } = fixture();
    const script = new JavaScriptModuleScript('globalThis.executed = true; export const value = 1;', env, baseURL, options);
    expect(script.record!.script).toBe(script);
    expect(script.record!.requestedModules).toEqual([]);
    expect(Reflect.has(env.global, 'executed')).toBe(false);
    const hasInstance = vi.fn(() => { throw new Error('author hasInstance'); });
    Object.defineProperty(env.realm.SyntaxError, Symbol.hasInstance, { value: hasInstance });
    const failed = new JavaScriptModuleScript('export const =', env, baseURL, options);
    expect(failed.record).toBeNull();
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
          const value = Reflect.get(env.realm.getModuleNamespace(script!.record!.code), 'default') as { answer: number; };
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

  it('imports JSON, text, and a projected stylesheet from supplied records', async () => {
    await runInHostTask(() => {
      const { browser, env, baseURL, options } = fixture();
      const root = new JavaScriptModuleScript([
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
      root.record!.requestedModules.forEach((request, index) => {
        root.record!.loadedModules.set(request, dependencies[index]!.record!);
      });
      root.record!.link();
      let completed = false;
      root.run(true).observe(() => { completed = true; }, (error) => { throw error; });
      env.responsibleEventLoop.performMicrotaskCheckpoint();
      expect(completed).toBe(true);
      const namespace = env.realm.getModuleNamespace(root.record!.code) as {
        data: { answer: number; }; text: string; sheet: CSSStyleSheet; validSheet: boolean;
      };
      expect(namespace.data).toBe(json.record!.defaultExport);
      expect(namespace.text).toBe('kept\n');
      expect(namespace.sheet).toBe(css.record!.defaultExport);
      expect(namespace.validSheet).toBe(true);
      expect(unwrap(namespace.sheet)).not.toBe(namespace.sheet);
      expect(namespace.sheet.cssRules[0]!.cssText).toBe('div { color: red; }');
      expect(browser.document.adoptedStyleSheets).toHaveLength(0);
    });
  });

  it('leaves dependency fetching explicit instead of inventing a resolution policy', () => {
    const { env, baseURL, options } = fixture();
    const script = new JavaScriptModuleScript('import "missing";', env, baseURL, options);
    expect(() => script.record!.loadRequestedModules({
      errorToRethrow: null, destination: 'script', performFetch: null, fetchClient: env,
    })).toThrow('Module dependency loading is not implemented');
    expect(() => script.record!.link()).toThrow('Module dependency loading is not implemented');
  });

  it.each(['fulfill', 'reject'] as const)('delivers top-level await %s through the owning environment', async (outcome) => {
    await runInHostTask(() => {
      const { env, baseURL, options } = fixture();
      const gate = env.realm.NativePromise.withResolvers<void>();
      Reflect.set(env.global, 'gate', gate.promise);
      const script = new JavaScriptModuleScript('await gate; export default 42;', env, baseURL, options);
      script.record!.link();
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
        expect(Reflect.get(env.realm.getModuleNamespace(script.record!.code), 'default')).toBe(42);
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
