import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addon } from '../../../src/js-engine/index';
import { utf8Encode } from '../../../src/encoding/index';
import { FetchHeaders } from '../../../src/fetch/index';
import { serializeURL } from '../../../src/url/index';
import { Browlet } from '../../../src/browlet/browlet';
import { CSPList } from '../../../src/browlet/browsing/policy/csp/list';
import { ContentSecurityPolicy } from '../../../src/browlet/browsing/policy/csp/policy';
import { ImportMap } from '../../../src/browlet/scripting/import-map';
import { type CompiledWasmModule, type ModuleScript } from '../../../src/browlet/scripting/script';
import { ScriptFetchOptions } from '../../../src/browlet/scripting/script-fetch-options';
import { DynamicImport } from '../../../src/browlet/scripting/import-handler';
import { mockHTTPTransport } from '../../fetch/transport-fixture';
import { getRelevantRealm } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';
import { itPassesWith } from '../../test-runtime';

afterEach(() => vi.restoreAllMocks());

describe('HTML WebAssembly source imports', () => {
  if (!addon.createContextHandle) {
    it('keeps source-object allocation dependent on the Wasm module-record backend', () => {
      const browser = new Browlet({ route: () => '', reporting: false });
      const env = getRelevantRealm(browser.window).env;
      expect(() => env.realm.compileWebAssemblyModule(constant(), 'source.wasm'))
        .toThrow('WebAssembly ESM parsing requires the compatibility addon');
    });
    return;
  }

  it.each([true, false])('shares a module across source/evaluation requests, source first = %s', async (sourceFirst) => {
    const imports = ['import source code from "./answer.wasm";', 'import { answer } from "./answer.wasm";'];
    if (!sourceFirst) imports.reverse();
    const f = await fixture({
      '/root.js': `${imports.join('\n')} export { code, answer };`,
      '/answer.wasm': callImport('./callback.js'),
      '/callback.js': 'globalThis.runs = (globalThis.runs ?? 0) + 1; export function answer() { return 42; }',
    });
    const root = await f.load('/root.js');
    const requests = root!.compiled!.requestedModules;
    const records = requests.map((request) => root!.compiled!.getLoadedModule(request));
    expect(records[0]).toBe(records[1]);
    expect(f.requests).toEqual(['/root.js', '/answer.wasm', '/callback.js']);
    await runInHostTask(() => {
      const namespace = evaluate(root!) as { code: object; answer(): number; };
      expect(namespace.code).toBe(f.env.project((records[0] as CompiledWasmModule).moduleSource));
      expect(namespace.answer()).toBe(42);
      expect(Reflect.get(f.env.global, 'runs')).toBe(1);
    });
  });

  it('loads dependencies later when an already source-imported module is imported for evaluation', async () => {
    const f = await fixture({
      '/source.js': 'import source code from "./answer.wasm"; export { code };',
      '/evaluate.js': 'export { answer } from "./answer.wasm";',
      '/answer.wasm': callImport('./callback.js'),
      '/callback.js': 'export function answer() { return 42; }',
    });
    const source = await f.load('/source.js');
    const record = f.module('/answer.wasm');
    expect(record.requestedModulesLoaded).toBe(false);
    expect(f.requests).toEqual(['/source.js', '/answer.wasm']);
    const evaluated = await f.load('/evaluate.js');
    expect(record.requestedModulesLoaded).toBe(true);
    expect(f.requests).toEqual(['/source.js', '/answer.wasm', '/evaluate.js', '/callback.js']);
    await runInHostTask(() => {
      const namespace = evaluate(evaluated!) as { answer(): number; };
      expect(namespace.answer()).toBe(42);
      expect(Reflect.get(evaluate(source!), 'code')).toBe(f.env.project(record.moduleSource));
    });
  });

  it('can source-import a cached module after its evaluation has failed', async () => {
    const f = await fixture({
      '/bad.js': 'import "./trap.wasm";',
      '/source.js': 'import source code from "./trap.wasm"; export { code };',
      '/trap.wasm': binary({ types: [[[], []]], functions: [{ code: [0x00] }], start: 0 }),
    });
    const bad = await f.load('/bad.js');
    await runInHostTask(() => {
      const rejected = vi.fn();
      bad!.run(true).observe(() => { throw new Error('The start function must trap'); }, rejected);
      f.env.responsibleEventLoop.performMicrotaskCheckpoint();
      const RuntimeError = Reflect.get(f.env.realm.WebAssembly, 'RuntimeError') as ErrorConstructor;
      expect(rejected).toHaveBeenCalledExactlyOnceWith(expect.any(RuntimeError));
    });
    const source = await f.load('/source.js');
    await runInHostTask(() => {
      expect(Reflect.get(evaluate(source!), 'code')).toBe(f.env.project(f.module('/trap.wasm').moduleSource));
    });
    expect(f.requests).toEqual(['/bad.js', '/trap.wasm', '/source.js']);
  });

  it('rejects a JavaScript source import with SyntaxError, without loading its dependencies', async () => {
    const f = await fixture({
      '/root.js': 'import source code from "./child.js";',
      '/child.js': 'import "./unfetched.js"; globalThis.ran = true;',
    });
    const root = await f.load('/root.js');
    expect(root!.parseError).toBeNull();
    expect(root!.errorToRethrow).toBeInstanceOf(f.env.realm.SyntaxError);
    expect(root!.compiled!.loadedModules.size).toBe(1);
    expect(Reflect.has(f.env.global, 'ran')).toBe(false);
    expect(f.requests).toEqual(['/root.js', '/child.js']);
  });

  it.each([
    ['missing resource', undefined, null],
    ['incorrect MIME type', { body: constant(), mime: 'application/octet-stream' }, null],
    ['malformed binary', new Uint8Array([0]), 'CompileError'],
  ] as const)('keeps the existing HTML failure path for a %s', async (_kind, resource, errorName) => {
    const f = await fixture({ '/root.js': 'import source code from "./child.wasm";', '/child.wasm': resource });
    const root = await f.load('/root.js');
    if (errorName === null) expect(root).toBeNull();
    else expect(root!.errorToRethrow).toBeInstanceOf(f.env.realm.WebAssemblyCompileError);
    expect(f.requests).toEqual(['/root.js', '/child.wasm']);
  });

  it('resolves source specifiers through the document import map', async () => {
    const f = await fixture({ '/root.js': 'import source code from "mapped"; export { code };', '/answer.wasm': constant() });
    f.env.globalImplementation.importMap = ImportMap.parse('{"imports":{"mapped":"./answer.wasm"}}', f.env.apiBaseURL, f.env);
    const root = await f.load('/root.js');
    await runInHostTask(() => {
      expect(Reflect.get(evaluate(root!), 'code')).toBe(f.env.project(f.module('/answer.wasm').moduleSource));
    });
    expect(f.requests).toEqual(['/root.js', '/answer.wasm']);
  });

  it('enforces Wasm compilation CSP even though source imports do not instantiate', async () => {
    const f = await fixture({ '/root.js': 'import source code from "./answer.wasm";', '/answer.wasm': constant() });
    const policies = new CSPList(f.env.origin);
    policies.policies.push(ContentSecurityPolicy.parse("script-src 'self'", 'header', 'enforce'));
    f.env.policyContainer.cspList = policies;
    const root = await f.load('/root.js');
    expect(root!.errorToRethrow).toBeInstanceOf(f.env.realm.WebAssemblyCompileError);
    expect(f.requests).toEqual(['/root.js', '/answer.wasm']);
  });

  it('returns a source record from the dynamic continuation without traversing its graph', async () => {
    const f = await fixture({ '/source.js': 'import source code from "./answer.wasm";', '/answer.wasm': callImport('unmapped') });
    await f.load('/source.js');
    const record = f.module('/answer.wasm');
    const delivered = Promise.withResolvers<unknown>();
    await runInHostTask(() => {
      const result = new DynamicImport(null, f.env).importModule('./answer.wasm', {}, 'source');
      void result.then(delivered.resolve, delivered.reject);
      f.env.responsibleEventLoop.performMicrotaskCheckpoint();
    });
    expect(await delivered.promise).toBe(record.code);
    expect(record.code.status).toBe('unlinked');
    expect(record.requestedModulesLoaded).toBe(false);
    expect(f.requests).toEqual(['/source.js', '/answer.wasm']);
  });

  // These use the same already recorded dynamic-import forwarding boundary as
  // dynamic-import.test.ts: official addon bases lack Node's callback export.
  const testImport = itPassesWith('dynamicImport');

  testImport('shares a public source object across static, repeated dynamic, and concurrent imports', async () => {
    const f = await fixture({
      '/root.js': 'import source code from "./answer.wasm"; globalThis.staticSource = code; export function load() { return import.source("./answer.wasm"); }',
      '/answer.wasm': callImport('unmapped'),
    });
    const root = await f.load('/root.js');
    await runInHostTask(() => { Reflect.set(f.env.global, 'moduleLoad', Reflect.get(evaluate(root!), 'load')); });
    const value = await f.browser.evaluate(`(async () => {
      const [first, second] = await Promise.all([import.source('./answer.wasm'), moduleLoad()]);
      const third = await import.source('./answer.wasm');
      return [first === staticSource && first === second && second === third,
        first instanceof WebAssembly.Module,
        new WebAssembly.Instance(first, { unmapped: { answer: () => 42 } }).exports.answer()];
    })()`);
    expect(value).toEqual([true, true, 42]);
    expect(f.requests).toEqual(['/root.js', '/answer.wasm']);
    expect(f.module('/answer.wasm').code.instance).toBeUndefined();
  });

  testImport('dynamic source imports reject JavaScript with the author realm SyntaxError', async () => {
    const f = await fixture({ '/child.js': 'import "unmapped"; globalThis.ran = true;' });
    expect(await f.browser.evaluate(`import.source('./child.js').then(
      () => false, error => error instanceof SyntaxError && !('ran' in globalThis)
    )`)).toBe(true);
    expect(f.requests).toEqual(['/child.js']);
  });

  testImport('adopts a source object only at dynamic resolution, leaving static imports alone', async () => {
    const f = await fixture({ '/root.js': 'import source code from "./answer.wasm"; globalThis.staticSource = code;', '/answer.wasm': constant() });
    await f.browser.evaluate(() => {
      Reflect.set(globalThis, 'thenReads', 0);
      Object.defineProperty(WebAssembly.Module.prototype, 'then', {
        configurable: true,
        get() {
          Reflect.set(globalThis, 'thenReads', Reflect.get(globalThis, 'thenReads') + 1);
          return (resolve: (value: string) => void) => { resolve('adopted'); };
        },
      });
    });
    const root = await f.load('/root.js');
    await runInHostTask(() => { evaluate(root!); });
    expect(Reflect.get(f.env.global, 'thenReads')).toBe(0);
    expect(await f.browser.evaluate('import.source("./answer.wasm")')).toBe('adopted');
    expect(Reflect.get(f.env.global, 'thenReads')).toBe(1);
  });
});

type Resource = string | Uint8Array | { body: string | Uint8Array; mime: string; };

async function fixture(resources: Record<string, Resource | undefined>) {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate('https://modules.test/page');
  const env = getRelevantRealm(browser.window).env;
  const requests: string[] = [];
  mockHTTPTransport(env.userAgent, (request, listener) => {
    const path = new URL(serializeURL(request.url)).pathname;
    requests.push(path);
    const resource = resources[path];
    const body = typeof resource === 'string' || resource instanceof Uint8Array ? resource : resource?.body;
    const mime = typeof resource === 'string' ? 'text/javascript' : resource instanceof Uint8Array ? 'application/wasm' : resource?.mime ?? 'text/plain';
    listener.onHeaders(body === undefined ? 404 : 200, '', new FetchHeaders([['Content-Type', mime]]), true);
    if (body !== undefined) listener.onData(typeof body === 'string' ? utf8Encode(body) : body);
    listener.onEnd();
  });
  return {
    browser, env, requests,
    load: (path: string) => new Promise<ModuleScript | null>((complete) => {
      env.fetchExternalModuleScriptGraph(env.parseURL(`https://modules.test${path}`)!, new ScriptFetchOptions(), complete);
    }),
    module: (path: string) => {
      const script = env.moduleMap.get(env.parseURL(`https://modules.test${path}`)!, 'javascript-or-wasm') as ModuleScript;
      return script.compiled as CompiledWasmModule;
    },
  };
}

function evaluate(script: ModuleScript): object {
  expect(script.errorToRethrow).toBeNull();
  const resolved = vi.fn();
  const rejected = vi.fn();
  script.run(true).observe(resolved, rejected);
  script.env.responsibleEventLoop.performMicrotaskCheckpoint();
  expect(rejected).not.toHaveBeenCalled();
  expect(resolved).toHaveBeenCalledOnce();
  return script.env.realm.getModuleNamespace(script.compiled!.code);
}

const { binary, constant, callImport } = createRequire(__filename)('../../../node-compat/test/support/wasm-fixtures.cjs') as {
  binary(this: void, options: { types: [number[], number[]][]; functions: { code: number[]; }[]; start: number; }): Uint8Array;
  constant(this: void): Uint8Array;
  callImport(this: void, module: string): Uint8Array;
};
