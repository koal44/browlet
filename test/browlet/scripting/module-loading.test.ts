import { afterEach, describe, expect, it, vi } from 'vitest';

import { utf8Encode } from '../../../src/encoding/index';
import { FetchHeaders, FetchResponse, type FetchRequest } from '../../../src/fetch/index';
import { serializeURL } from '../../../src/url/index';
import { Browlet } from '../../../src/browlet/browlet';
import { ImportMap } from '../../../src/browlet/scripting/import-map';
import { JSModuleScript, type ModuleScript } from '../../../src/browlet/scripting/script';
import { ModuleRequest } from '../../../src/browlet/scripting/module-request';
import type { ModuleDependencyLoader } from '../../../src/browlet/scripting/module-loading-state';
import { ScriptFetchOptions } from '../../../src/browlet/scripting/script-fetch-options';
import { fetchDescendantsAndLink, type PerformScriptFetch } from '../../../src/browlet/scripting/script-fetching';
import { getRelevantRealm } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';
import { mockHTTPTransport } from '../../fetch/transport-fixture';

afterEach(() => vi.restoreAllMocks());

describe('HTML static module loading', () => {
  it('fetches, links, and evaluates a transitive graph through the script fetchers', async () => {
    await runInHostTask(() => {
      const f = fixture({
        '/child.js': { source: 'export { answer } from "./leaf.js";' },
        '/leaf.js': { source: 'globalThis.leafRuns = (globalThis.leafRuns ?? 0) + 1; export const answer = 42;' },
      });
      const root = f.script('export { answer } from "./child.js";');
      const complete = vi.fn();
      fetchDescendantsAndLink(root, f.env, 'script', complete, f.performFetch);
      f.checkpoint();
      expect(complete).toHaveBeenCalledExactlyOnceWith(root);
      expect(root.errorToRethrow).toBeNull();
      expect(f.requests.map((request) => serializeURL(request.currentURL)))
        .toEqual(['https://modules.test/child.js', 'https://modules.test/leaf.js']);
      expect(Reflect.has(f.env.global, 'leafRuns')).toBe(false);
      expect(Reflect.get(evaluate(root), 'answer')).toBe(42);
      expect(Reflect.get(f.env.global, 'leafRuns')).toBe(1);
      expect(f.env.responsibleEventLoop.executionContextStack).toEqual([]);
    });
  });

  it('closes a cycle and shares a diamond dependency without fetching or evaluating it twice', async () => {
    await runInHostTask(() => {
      const f = fixture({
        '/a.js': { source: 'import { base } from "./root.js"; import { shared } from "./shared.js"; export function fromA() { return base() + shared; }' },
        '/b.js': { source: 'import { shared } from "./shared.js"; export function fromB() { return shared; }' },
        '/shared.js': { source: 'globalThis.sharedRuns = (globalThis.sharedRuns ?? 0) + 1; export const shared = 1;' },
      });
      const root = f.script('import { fromA } from "./a.js"; import { fromB } from "./b.js"; export function base() { return 40; } export const answer = fromA() + fromB();');
      // An external root is published in the module map before descendant loading.
      f.env.moduleMap.set(f.baseURL, 'javascript-or-wasm', root);
      const complete = vi.fn();
      fetchDescendantsAndLink(root, f.env, 'script', complete, f.performFetch);
      f.checkpoint();
      expect(complete).toHaveBeenCalledExactlyOnceWith(root);
      expect(root.errorToRethrow).toBeNull();
      expect(f.requests.map((request) => serializeURL(request.currentURL)))
        .toEqual(['https://modules.test/a.js', 'https://modules.test/shared.js', 'https://modules.test/b.js']);
      expect(Reflect.get(evaluate(root), 'answer')).toBe(42);
      expect(Reflect.get(f.env.global, 'sharedRuns')).toBe(1);
    });
  });

  it('waits for shared in-flight dependencies across concurrent graphs', async () => {
    await runInHostTask(() => {
      const f = fixture({ '/shared.js': { source: 'globalThis.sharedRuns = (globalThis.sharedRuns ?? 0) + 1; export default 42;' } }, true);
      const roots = [f.script('export { default } from "./shared.js";'), f.script('export { default } from "./shared.js";')];
      const complete = vi.fn();
      for (const root of roots) fetchDescendantsAndLink(root, f.env, 'script', complete, f.performFetch);
      f.checkpoint();
      expect(f.performFetch).toHaveBeenCalledTimes(1);
      expect(complete).not.toHaveBeenCalled();
      f.respond('/shared.js');
      f.checkpoint();
      expect(complete.mock.calls).toEqual(roots.map((root) => [root]));
      const records = roots.map((root) => root.compiled!.getLoadedModule(root.compiled!.requestedModules[0]!));
      expect(records[0]).toBe(records[1]);
      for (const root of roots) expect(Reflect.get(evaluate(root), 'default')).toBe(42);
      expect(Reflect.get(f.env.global, 'sharedRuns')).toBe(1);
    });
  });

  it.each([
    ['unknown attribute', 'import "./bad.js" with { unexpected: "value" };', 'SyntaxError'],
    ['unresolved specifier', 'import "unmapped";', 'TypeError'],
    ['unsupported type', 'import "./bad.js" with { type: "not-a-module-type" };', 'TypeError'],
  ] as const)('preflights a later %s before fetching the first dependency', async (_name, declaration, errorName) => {
    await runInHostTask(() => {
      const f = fixture({ '/ok.js': { source: 'export {};' } });
      const root = f.script(`import "./ok.js"; ${declaration}`);
      expect(root.parseError).toBeNull();
      const complete = vi.fn();
      fetchDescendantsAndLink(root, f.env, 'script', complete, f.performFetch);
      f.checkpoint();
      expect(complete).toHaveBeenCalledExactlyOnceWith(root);
      expect(Object.getPrototypeOf(root.errorToRethrow)).toBe(f.env.realm[errorName].prototype);
      expect(f.performFetch).not.toHaveBeenCalled();
      expect(root.compiled!.requestedModulesLoaded).toBe(false);
    });
  });

  it('rejects an unsupported first attribute in the graph loader before invoking the HTML hook', async () => {
    await runInHostTask(() => {
      const f = fixture({});
      const root = f.script('import "./data.json" with { type: "json", extra: "value" };');
      const loadDependency = vi.fn<ModuleDependencyLoader['load']>();
      const rejected = vi.fn();
      root.compiled!.loadRequestedModules({ load: loadDependency }).observe(() => { throw new Error('Invalid attributes must reject'); }, rejected);
      f.checkpoint();
      expect(rejected).toHaveBeenCalledExactlyOnceWith(expect.any(f.env.realm.SyntaxError));
      // ECMA's early attribute rejection does not enter HTML's loading operation.
      expect(loadDependency).not.toHaveBeenCalled();
      expect(f.performFetch).not.toHaveBeenCalled();
    });
  });

  it('retains a child parse error and caches its script without executing anything', async () => {
    await runInHostTask(() => {
      const f = fixture({ '/bad.js': { source: 'export const = ;' } });
      const root = f.script('import "./bad.js"; globalThis.executed = true;');
      const complete = vi.fn();
      fetchDescendantsAndLink(root, f.env, 'script', complete, f.performFetch);
      f.checkpoint();
      expect(complete).toHaveBeenCalledExactlyOnceWith(root);
      const cached = f.env.moduleMap.get(f.env.parseURL('https://modules.test/bad.js')!, 'javascript-or-wasm') as ModuleScript;
      expect(root.errorToRethrow).toBe(cached.parseError);
      expect(Object.getPrototypeOf(root.errorToRethrow)).toBe(f.env.realm.SyntaxError.prototype);
      expect(root.compiled!.loadedModules.size).toBe(0);
      expect(Reflect.has(f.env.global, 'executed')).toBe(false);
    });
  });

  it('reports a link error after loading without evaluating the graph', async () => {
    await runInHostTask(() => {
      const f = fixture({ '/child.js': { source: 'export const available = 1;' } });
      const root = f.script('import { missing } from "./child.js"; globalThis.executed = true;');
      const complete = vi.fn();
      fetchDescendantsAndLink(root, f.env, 'script', complete, f.performFetch);
      f.checkpoint();
      expect(complete).toHaveBeenCalledExactlyOnceWith(root);
      expect(Object.getPrototypeOf(root.errorToRethrow)).toBe(f.env.realm.SyntaxError.prototype);
      expect(root.compiled!.requestedModulesLoaded).toBe(true);
      expect(Reflect.has(f.env.global, 'executed')).toBe(false);
    });
  });

  it('retains late successful associations after a fetch failure and can retry the failed graph', async () => {
    await runInHostTask(() => {
      const files: Record<string, Resource> = {
        '/bad.js': { source: '', status: 404 },
        '/late.js': { source: 'export { answer } from "./leaf.js";' },
        '/leaf.js': { source: 'export const answer = 42;' },
      };
      const f = fixture(files, true);
      const root = f.script('import "./bad.js"; export { answer } from "./late.js";');
      const complete = vi.fn();
      fetchDescendantsAndLink(root, f.env, 'script', complete, f.performFetch);
      f.respond('/bad.js');
      f.checkpoint();
      expect(complete).toHaveBeenCalledExactlyOnceWith(null);
      expect(root.errorToRethrow).toBeNull();
      expect(f.env.moduleMap.get(f.env.parseURL('https://modules.test/bad.js')!, 'javascript-or-wasm')).toBeUndefined();
      f.respond('/late.js');
      f.checkpoint();
      expect(root.compiled!.loadedModules.size).toBe(1);
      expect(root.compiled!.requestedModulesLoaded).toBe(false);
      expect(f.requests).toHaveLength(2); // The settled graph does not start late.js's child.
      expect(complete).toHaveBeenCalledTimes(1);

      files['/bad.js'] = { source: 'export {};' };
      const retried = vi.fn();
      fetchDescendantsAndLink(root, f.env, 'script', retried, f.performFetch);
      expect(f.requests.map((request) => serializeURL(request.currentURL)))
        .toEqual(['https://modules.test/bad.js', 'https://modules.test/late.js', 'https://modules.test/bad.js', 'https://modules.test/leaf.js']);
      f.respond('/leaf.js');
      f.checkpoint();
      expect(retried).not.toHaveBeenCalled();
      f.respond('/bad.js');
      f.checkpoint();
      expect(retried).toHaveBeenCalledExactlyOnceWith(root);
      expect(Reflect.get(evaluate(root), 'answer')).toBe(42);
    });
  });

  it('records a late parse error before observing an earlier fetch rejection', async () => {
    await runInHostTask(() => {
      const f = fixture({
        '/missing.js': { source: '', status: 404 },
        '/invalid.js': { source: 'export const = ;' },
      }, true);
      const root = f.script('import "./missing.js"; import "./invalid.js";');
      const complete = vi.fn();
      fetchDescendantsAndLink(root, f.env, 'script', complete, f.performFetch);
      f.respond('/missing.js');
      // The traversal has rejected, but HTML has not observed that rejection.
      f.respond('/invalid.js');
      expect(complete).not.toHaveBeenCalled();
      f.checkpoint();
      const invalid = f.env.moduleMap.get(f.env.parseURL('https://modules.test/invalid.js')!, 'javascript-or-wasm') as ModuleScript;
      expect(complete).toHaveBeenCalledExactlyOnceWith(root);
      expect(root.errorToRethrow).toBe(invalid.parseError);
      expect(root.errorToRethrow).toBeInstanceOf(f.env.realm.SyntaxError);
      expect(root.compiled!.requestedModulesLoaded).toBe(false);
    });
  });

  it('uses redirected module bases, scoped import maps, and inherited fetch state with a separate client', async () => {
    await runInHostTask(() => {
      const f = fixture({
        '/redirect.js': { source: 'export { answer } from "scoped";', finalURL: 'https://modules.test/final/child.js' },
        '/final/leaf.js': { source: 'export const answer = 42;' },
      });
      f.env.globalImplementation.importMap = ImportMap.parse(JSON.stringify({
        imports: { scoped: './wrong.js' },
        scopes: { './final/': { scoped: './final/leaf.js' } },
        integrity: { './redirect.js': 'sha256-child', './final/leaf.js': 'sha256-leaf' },
      }), f.baseURL, f.env);
      const client = fixture({}).env;
      const options = Object.assign(new ScriptFetchOptions(), {
        cryptographicNonce: 'nonce', integrityMetadata: 'sha256-root', parserMetadata: 'parser-inserted',
        credentialsMode: 'include', referrerPolicy: 'no-referrer', renderBlocking: true, fetchPriority: 'high',
      });
      const root = f.script('export { answer } from "./redirect.js";', options);
      const complete = vi.fn();
      fetchDescendantsAndLink(root, client, 'worker', complete, f.performFetch);
      f.checkpoint();
      expect(complete).toHaveBeenCalledExactlyOnceWith(root);
      expect(root.errorToRethrow).toBeNull();
      expect(f.requests.map((request) => serializeURL(request.currentURL)))
        .toEqual(['https://modules.test/redirect.js', 'https://modules.test/final/leaf.js']);
      expect(f.requests.map((request) => serializeURL(request.referrer!)))
        .toEqual(['https://modules.test/root.js', 'https://modules.test/final/child.js']);
      expect(f.requests.map((request) => request.integrityMetadata)).toEqual(['sha256-child', 'sha256-leaf']);
      for (const request of f.requests) {
        expect(request.client).toBe(client);
        expect(request).toMatchObject({
          destination: 'worker', mode: 'cors', credentialsMode: 'include',
          cryptographicNonceMetadata: 'nonce', parserInserted: true, referrerPolicy: 'no-referrer', renderBlocking: true, priority: 'auto',
        });
      }
      const child = root.compiled!.getLoadedModule(root.compiled!.requestedModules[0]!)!;
      expect(child.realm).toBe(f.env.realm);
      expect(client.moduleMap.entries).toHaveLength(0);
      expect(options.integrityMetadata).toBe('sha256-root');
      expect(options.fetchPriority).toBe('high');
      expect(Reflect.get(evaluate(root), 'answer')).toBe(42);
    });
  });

  it('fetches synthetic JSON, CSS, and text dependencies and exports their realm-owned values', async () => {
    await runInHostTask(() => {
      const f = fixture({
        '/data.json': { source: '{"answer":42}', mime: 'application/json' },
        '/sheet.css': { source: 'div { color: red; }', mime: 'text/css' },
        '/text.txt': { source: 'hello', mime: 'text/plain' },
      });
      const root = f.script('import data from "./data.json" with { type: "json" }; import sheet from "./sheet.css" with { type: "css" }; import text from "./text.txt" with { type: "text" }; export { data, sheet, text }; export const valid = sheet instanceof CSSStyleSheet;');
      const complete = vi.fn();
      fetchDescendantsAndLink(root, f.env, 'script', complete, f.performFetch);
      f.checkpoint();
      expect(complete).toHaveBeenCalledExactlyOnceWith(root);
      expect(root.errorToRethrow).toBeNull();
      expect(f.requests.map((request) => request.destination)).toEqual(['json', 'style', 'text']);
      const namespace = evaluate(root) as { data: { answer: number; }; sheet: CSSStyleSheet; text: string; valid: boolean; };
      expect(namespace.data.answer).toBe(42);
      expect(Object.getPrototypeOf(namespace.data)).toBe(f.env.realm.objectPrototype);
      expect(namespace.valid).toBe(true);
      expect(namespace.sheet.cssRules[0]!.cssText).toBe('div { color: red; }');
      expect(namespace.text).toBe('hello');
    });
  });

  it('reuses an equivalent retained request rather than relying on object identity', async () => {
    await runInHostTask(() => {
      const f = fixture({});
      const root = f.script('export { answer } from "./child.js";');
      const child = f.script('export const answer = 42;');
      root.compiled!.loadedModules.set(new ModuleRequest('./child.js'), child.compiled!);
      const complete = vi.fn();
      fetchDescendantsAndLink(root, f.env, 'script', complete, f.performFetch);
      f.checkpoint();
      expect(complete).toHaveBeenCalledExactlyOnceWith(root);
      expect(f.performFetch).not.toHaveBeenCalled();
      expect(Reflect.get(evaluate(root), 'answer')).toBe(42);
    });
  });

  it('loads an external graph through real Fetch with only the wire transport controlled', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    await browser.navigate('https://modules.test/page');
    const env = getRelevantRealm(browser.window).env;
    const requests: string[] = [];
    mockHTTPTransport(env.userAgent, (request, listener) => {
      const url = serializeURL(request.url);
      requests.push(url);
      listener.onHeaders(200, '', new FetchHeaders([['Content-Type', 'text/javascript']]), true);
      listener.onData(utf8Encode(url.endsWith('/root.js') ? 'export { answer } from "./child.js";' : 'export const answer = 42;'));
      listener.onEnd();
    });
    const root = await new Promise<ModuleScript | null>((complete) => {
      env.fetchExternalModuleScriptGraph(env.parseURL('https://modules.test/root.js')!, new ScriptFetchOptions(), complete);
    });
    expect(requests).toEqual(['https://modules.test/root.js', 'https://modules.test/child.js']);
    expect(root).not.toBeNull();
    expect(root!.errorToRethrow).toBeNull();
    await runInHostTask(() => { expect(Reflect.get(evaluate(root!), 'answer')).toBe(42); });
  });
});

function fixture(files: Record<string, Resource>, deferred = false) {
  const browser = new Browlet({ route: () => '', reporting: false });
  const env = getRelevantRealm(browser.window).env;
  const baseURL = env.parseURL('https://modules.test/root.js')!;
  const requests: FetchRequest[] = [];
  const pending: Map<string, () => void> = new Map();
  const respond = (path: string) => {
    const deliver = pending.get(path)!;
    pending.delete(path);
    deliver();
  };
  const performFetch = vi.fn<PerformScriptFetch>((request, _topLevel, onResponse) => {
    requests.push(request);
    const path = serializeURL(request.currentURL).replace('https://modules.test', '');
    pending.set(path, () => {
      const resource = files[path];
      const response = new FetchResponse();
      response.status = resource?.status ?? (resource ? 200 : 404);
      response.urlList = [resource?.finalURL ? env.parseURL(resource.finalURL)! : request.currentURL];
      response.headerList.append('Content-Type', resource?.mime ?? 'text/javascript');
      onResponse(response, utf8Encode(resource?.source ?? ''));
    });
    if (!deferred) respond(path);
  });
  return {
    browser, env, baseURL, requests, performFetch, respond,
    checkpoint: () => env.responsibleEventLoop.performMicrotaskCheckpoint(),
    script: (source: string, options = new ScriptFetchOptions()) => new JSModuleScript(source, env, baseURL, options),
  };
}

function evaluate(script: ModuleScript): object {
  let result: { state: string; error?: unknown; } = { state: 'pending' };
  script.run(true).observe(() => { result = { state: 'fulfilled' }; }, (error) => {
    result = { state: 'rejected', error };
  });
  script.env.responsibleEventLoop.performMicrotaskCheckpoint();
  expect(result).toEqual({ state: 'fulfilled' });
  return script.env.realm.getModuleNamespace(script.compiled!.code);
}

interface Resource {
  source: string;
  mime?: string;
  status?: number;
  finalURL?: string;
}
