import * as vm from 'node:vm';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { utf8Encode } from '../../../src/encoding/index';
import { FetchHeaders } from '../../../src/fetch/index';
import { serializeURL } from '../../../src/url/index';
import { idlType } from '../../../src/web-idl/core/index';
import { Browlet } from '../../../src/browlet/browlet';
import type { BrowletEnvironment } from '../../../src/browlet/environment/index';
import { ClassicScript, JavaScriptModuleScript } from '../../../src/browlet/scripting/script';
import { ScriptFetchOptions } from '../../../src/browlet/scripting/script-fetch-options';
import { mockHTTPTransport } from '../../fetch/transport-fixture';
import { getRelevantRealm } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';
import { itPassesWith } from '../../test-runtime';

afterEach(() => vi.restoreAllMocks());

// Official addon bases lack the already recorded dynamic-import forwarding export.
// Stock Node uses its own VM API; custom/compat supplies the addon callback.
const testImport = itPassesWith('dynamicImport');

describe('HTML dynamic import', () => {
  testImport('imports and evaluates a fetched graph from a retained classic script', async () => {
    const { env, requests, fetch } = await fixture({
      '/app/child.js': 'export { answer } from "./leaf.js";',
      '/app/leaf.js': 'export const answer = 42;',
    });
    const observation = await observe(env, () => classic(env, 'import("./child.js")'));
    expect(fetch).toHaveBeenCalled();
    const namespace = fulfilled(await settled(env, observation)) as { answer: number; };
    expect(namespace.answer).toBe(42);
    expect(requests).toEqual(['https://modules.test/app/child.js', 'https://modules.test/app/leaf.js']);
    expect(env.responsibleEventLoop.executionContextStack).toEqual([]);
  });

  testImport('uses the document base for imports in Browlet source-string evaluation', async () => {
    const { browser, requests } = await fixture({ '/child.js': 'export const answer = 42;' });
    // Exercise source-string evaluation directly: Vitest rewrites import() in
    // host function bodies, so serializing such a function would test its helper.
    const value = await browser.evaluate('import("./child.js").then(module => module.answer)');
    expect(value).toBe(42);
    expect(requests).toEqual(['https://modules.test/child.js']);
  });

  testImport('does not associate a lazily compiled inline handler with the script reading its getter', async () => {
    const { env, requests } = await fixture({ '/child.js': 'export const foo = 5;' });
    const observation = await observe(env, () => classic(env, `
      document.body.setAttribute('onstorage', 'return import("./child.js");');
      onstorage();
    `));
    expect(fulfilled(await settled(env, observation))).toMatchObject({ foo: 5 });
    // The reading script lives under /app/. An inline handler uses the current
    // document API base even when its compilation and invocation happen there.
    expect(requests).toEqual(['https://modules.test/child.js']);
    expect(env.realm.loadedModules.size).toBe(1);
  });

  testImport('uses the document import base through the Proxy-scoped element handler factory', async () => {
    const { env, requests } = await fixture({ '/child.js': 'export const foo = 5;' });
    const observation = await observe(env, () => classic(env, `
      const element = document.createElement('div');
      element.setAttribute('onclick', 'return import("./child.js");');
      element.onclick();
    `));
    expect(fulfilled(await settled(env, observation))).toMatchObject({ foo: 5 });
    expect(requests).toEqual(['https://modules.test/child.js']);
    expect(env.realm.loadedModules.size).toBe(1);
  });

  testImport('retains a module referrer across await and calls from another Window', async () => {
    const owner = await fixture({ '/app/child.js': 'export const answer = 42;' });
    const caller = await fixture({});
    const script = new JavaScriptModuleScript(
      'export async function load() { await 0; return import("./child.js"); }',
      owner.env, owner.env.parseURL('https://modules.test/app/root.js')!, new ScriptFetchOptions(),
    );
    script.record!.link();
    await runInHostTask(() => { script.run(true); owner.env.responsibleEventLoop.performMicrotaskCheckpoint(); });
    const namespace = owner.env.realm.getModuleNamespace(script.record!.code);
    Reflect.set(caller.env.global, 'loadFromOwner', Reflect.get(namespace, 'load'));

    const observation = await observe(owner.env, () => classic(caller.env, 'loadFromOwner()'));
    expect(fulfilled(await settled(owner.env, observation))).toMatchObject({ answer: 42 });
    expect(owner.requests).toEqual(['https://modules.test/app/child.js']);
    expect(caller.requests).toEqual([]);
    expect(script.record!.loadedModules.size).toBe(1);
    expect(owner.env.realm.loadedModules.size).toBe(0);
  });

  testImport('keeps repeated evaluations with identical source on their own Window loader', async () => {
    const first = await fixture({ '/child.js': 'export default 5;' });
    const second = await fixture({ '/child.js': 'export default 9;' });
    const source = 'import("./child.js").then(module => module.default)';
    for (let index = 0; index < 3; index++) {
      expect(await first.browser.evaluate(source)).toBe(5);
      expect(await second.browser.evaluate(source)).toBe(9);
    }
    expect(first.requests).toEqual(['https://modules.test/child.js']);
    expect(second.requests).toEqual(['https://modules.test/child.js']);
  });

  testImport('retains the classic-script referrer for Function-created imports', async () => {
    const { env, requests } = await fixture({ '/app/generated.js': 'export const answer = 42;' });
    const observation = await observe(env, () => classic(env, `Function("return import('./generated.js');")()`));
    expect(fulfilled(await settled(env, observation))).toMatchObject({ answer: 42 });
    expect(requests).toEqual(['https://modules.test/app/generated.js']);
    expect(env.realm.loadedModules.size).toBe(0);
  });

  it('leaves a host-created Function with its Node referrer and loader', async () => {
    const { env, fetch } = await fixture({});
    const target = new vm.SyntheticModule(['answer'], function() { this.setExport('answer', 42); });
    await target.link(() => { throw new Error('Synthetic modules have no imports'); });
    await target.evaluate();
    const loadFromNode = vi.fn(() => Promise.resolve(target));
    // Function captures the active Node script even though its constructor and
    // resulting function belong to the Window realm. That metadata is not absent.
    const construct = vm.compileFunction(`return make("return import('host-owned');");`, ['make'], {
      importModuleDynamically: loadFromNode,
    }) as (make: FunctionConstructor) => () => Promise<unknown>;
    const load = construct(env.realm.Function);
    const observation = await observe(env, load);
    expect(fulfilled(await settled(env, observation))).toMatchObject({ answer: 42 });
    expect(loadFromNode).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(env.realm.loadedModules.size).toBe(0);
  });

  // Approved expected failure: the Node-shaped callback identifies the source
  // record, but not the distinct executing realm of a borrowed constructor.
  // Official compat bases additionally lack the dynamic-import forwarding export.
  it.fails('allocates unsupported-attribute errors in the executing realm of a borrowed Function constructor', async () => {
    const source = await fixture({});
    const executing = await fixture({});
    const importing = vi.spyOn(source.env.realm, 'importModuleDynamically');
    Reflect.set(source.env.global, 'OtherFunction', executing.env.realm.Function);
    const observation = await observe(executing.env, () => classic(source.env,
      `OtherFunction("return import('./borrowed.js', { with: { unsupported: 'x' } });")()`,
    ));
    const result = await settled(executing.env, observation, source.env);
    expect(result.type).toBe('rejected');
    if (result.type !== 'rejected') throw new Error('Expected import rejection');
    expect(importing).toHaveBeenCalledOnce();
    expect(Object.getPrototypeOf(result.reason)).toBe(executing.env.realm.TypeError.prototype);
    expect(source.fetch).not.toHaveBeenCalled();
    expect(executing.fetch).not.toHaveBeenCalled();
  });

  testImport('shares concurrent imports and evaluates the cached graph once', async () => {
    const { env, requests } = await fixture({
      '/app/child.js': 'globalThis.evaluations = (globalThis.evaluations || 0) + 1; export const answer = 42;',
    });
    const observation = await observe(env, () => classic(env, 'Promise.all([import("./child.js"), import("./child.js")])'));
    const namespaces = fulfilled(await settled(env, observation)) as object[];
    expect(namespaces[0]).toBe(namespaces[1]);
    expect(Reflect.get(env.global, 'evaluations')).toBe(1);
    expect(requests).toEqual(['https://modules.test/app/child.js']);
  });

  for (const outcome of ['fulfillment', 'rejection'] as const) {
    testImport(`waits for top-level await ${outcome}`, async () => {
      const { env, fetch } = await fixture({ '/app/child.js': 'started(); await gate; export const answer = 42;' });
      const started = Promise.withResolvers<void>();
      const gate = env.realm.NativePromise.withResolvers<void>();
      Reflect.set(env.global, 'started', started.resolve);
      Reflect.set(env.global, 'gate', gate.promise);
      const report = vi.spyOn(env, 'reportException');
      const observation = await observe(env, () => classic(env, 'import("./child.js")'));
      expect(fetch).toHaveBeenCalled();
      await started.promise;
      expect(observation.result.type).toBe('pending');
      const reason = new env.realm.Error('await failed');
      await runInHostTask(() => {
        if (outcome === 'fulfillment') gate.resolve();
        else gate.reject(reason);
        env.responsibleEventLoop.performMicrotaskCheckpoint();
      });
      const result = await settled(env, observation);
      if (outcome === 'fulfillment') expect(fulfilled(result)).toMatchObject({ answer: 42 });
      else expect(result).toEqual({ type: 'rejected', reason });
      expect(report).not.toHaveBeenCalled();
      expect(env.responsibleEventLoop.executionContextStack).toEqual([]);
    });
  }

  testImport('selects a JSON module from import attributes and preserves its realm', async () => {
    const { env } = await fixture({ '/app/data.json': { source: '{"answer":42}', mime: 'application/json' } });
    const observation = await observe(env, () => classic(env, 'import("./data.json", { with: { type: "json" } })'));
    const namespace = fulfilled(await settled(env, observation)) as { default: object; };
    expect(namespace.default).toEqual({ answer: 42 });
    expect(Object.getPrototypeOf(namespace.default)).toBe(env.realm.objectPrototype);
  });

  testImport('lets the engine adopt a namespace then export exactly once', async () => {
    const { env } = await fixture({
      '/app/child.js': 'export function then(resolve) { globalThis.adoptions = (globalThis.adoptions || 0) + 1; resolve({ answer: 42 }); }',
    });
    const observation = await observe(env, () => classic(env, 'import("./child.js")'));
    expect(fulfilled(await settled(env, observation))).toMatchObject({ answer: 42 });
    expect(Reflect.get(env.global, 'adoptions')).toBe(1);
  });

  for (const failure of [
    { name: 'unresolved specifier', source: 'import("unmapped")', error: 'TypeError' },
    { name: 'unsupported attribute', source: 'import("./child.js", { with: { unsupported: "x" } })', error: 'TypeError' },
    { name: 'unsupported type', source: 'import("./child.js", { with: { type: "javascript" } })', error: 'TypeError' },
    { name: 'HTTP failure', source: 'import("./missing.js")', error: 'TypeError' },
    { name: 'MIME failure', source: 'import("./text.js")', error: 'TypeError' },
    { name: 'parse failure', source: 'import("./invalid.js")', error: 'SyntaxError' },
    { name: 'link failure', source: 'import("./link.js")', error: 'SyntaxError' },
    { name: 'descendant parse failure', source: 'import("./descendant.js")', error: 'SyntaxError' },
  ] as const) {
    testImport(`rejects on ${failure.name}`, async () => {
      const { env } = await fixture({
        '/app/child.js': 'export const answer = 42;',
        '/app/text.js': { source: 'plain text', mime: 'text/plain' },
        '/app/invalid.js': 'export const =',
        '/app/link.js': 'import { missing } from "./child.js";',
        '/app/descendant.js': 'import "./invalid.js";',
      });
      const importing = vi.spyOn(env.realm, 'importModuleDynamically');
      const observation = await observe(env, () => classic(env, failure.source));
      const result = await settled(env, observation);
      expect(result.type).toBe('rejected');
      if (result.type !== 'rejected') throw new Error('Expected import rejection');
      expect(importing).toHaveBeenCalledOnce();
      expect(Object.getPrototypeOf(result.reason)).toBe(env.realm[failure.error].prototype);
    });
  }

  testImport('retains evaluation failure identity for later imports without reporting it as a script error', async () => {
    const { env, requests } = await fixture({ '/app/child.js': 'throw globalThis.reason;' });
    const reason = env.realm.createOrdinaryObject(null);
    Reflect.set(env.global, 'reason', reason);
    const report = vi.spyOn(env, 'reportException');
    for (let i = 0; i < 2; i++) {
      const observation = await observe(env, () => classic(env, 'import("./child.js")'));
      expect(await settled(env, observation)).toEqual({ type: 'rejected', reason });
    }
    expect(requests).toEqual(['https://modules.test/app/child.js']);
    expect(report).not.toHaveBeenCalled();
  });

  it('lets native argument evaluation finish before validating supported attribute names', async () => {
    const { env, fetch } = await fixture({});
    const reason = new env.realm.Error('attribute getter');
    Reflect.set(env.global, 'reason', reason);
    const observation = await observe(env, () => classic(env, [
      'import("./child.js", { with: {',
      '  unsupported: "x", get type() { throw reason; }',
      '} })',
    ].join('\n')));
    expect(await settled(env, observation)).toEqual({ type: 'rejected', reason });
    expect(fetch).not.toHaveBeenCalled();
  });

  for (const kind of ['isWorklet', 'isServiceWorker'] as const) {
    testImport(`rejects a dynamic import when ${kind} is true, before fetching`, async () => {
      const { env, fetch } = await fixture({ '/app/child.js': 'export const answer = 42;' });
      // These global implementations are unfinished; exercise their explicit
      // environment contract while retaining real compilation and native import.
      vi.spyOn(env, kind, 'get').mockReturnValue(true);
      const importing = vi.spyOn(env.realm, 'importModuleDynamically');
      const observation = await observe(env, () => classic(env, 'import("./child.js")'));
      const result = await settled(env, observation);
      expect(result.type).toBe('rejected');
      if (result.type !== 'rejected') throw new Error('Expected import rejection');
      expect(importing).toHaveBeenCalledOnce();
      expect(Object.getPrototypeOf(result.reason)).toBe(env.realm.TypeError.prototype);
      expect(fetch).not.toHaveBeenCalled();
    });
  }
});

type Resource = string | { source: string; mime: string; };

async function fixture(resources: Record<string, Resource>) {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate('https://modules.test/page');
  const env = getRelevantRealm(browser.window).env;
  const fetch = vi.spyOn(env, 'fetchSingleImportedModuleScript');
  const requests: string[] = [];
  mockHTTPTransport(env.userAgent, (request, listener) => {
    const url = serializeURL(request.url);
    requests.push(url);
    const resource = resources[new URL(url).pathname];
    const source = typeof resource === 'string' ? resource : resource?.source;
    const mime = typeof resource === 'string' ? 'text/javascript' : resource?.mime ?? 'text/javascript';
    listener.onHeaders(source === undefined ? 404 : 200, '', new FetchHeaders([['Content-Type', mime]]), true);
    if (source !== undefined) listener.onData(utf8Encode(source));
    listener.onEnd();
  });
  return { browser, env, fetch, requests };
}

function classic(env: BrowletEnvironment, source: string): unknown {
  const script = new ClassicScript(source, env, env.parseURL('https://modules.test/app/root.js')!, new ScriptFetchOptions());
  const completion = script.run(true);
  expect(completion.type).toBe('normal');
  return completion.value;
}

type Result = { type: 'pending'; } | { type: 'fulfilled'; value: unknown; } | { type: 'rejected'; reason: unknown; };

async function observe(env: BrowletEnvironment, run: () => unknown) {
  const observation: { result: Result; } = { result: { type: 'pending' } };
  await runInHostTask(() => {
    const promise = run() as Promise<unknown>;
    expect(Object.getPrototypeOf(promise)).toBe(env.realm.NativePromise.prototype);
    env.InternalPromise.fromNative(promise, (value) => value, idlType.any).observe(
      (value) => { observation.result = { type: 'fulfilled', value }; },
      (reason) => { observation.result = { type: 'rejected', reason }; },
    );
    env.responsibleEventLoop.performMicrotaskCheckpoint();
  });
  return observation;
}

async function settled(env: BrowletEnvironment, observation: { result: Result; }, ...otherEnvs: BrowletEnvironment[]): Promise<Result> {
  // Let Fetch tasks and engine jobs run. Stock VM queues can only be drained
  // synchronously outside Node's own Promise jobs, hence the host-task boundary.
  await vi.waitFor(async () => {
    await runInHostTask(() => {
      for (const otherEnv of otherEnvs) otherEnv.responsibleEventLoop.performMicrotaskCheckpoint();
      env.responsibleEventLoop.performMicrotaskCheckpoint();
    });
    expect(observation.result.type).not.toBe('pending');
  }, { interval: 10, timeout: 1000 });
  return observation.result;
}

function fulfilled(result: Result): unknown {
  if (result.type === 'rejected') throw result.reason;
  expect(result.type).toBe('fulfilled');
  if (result.type !== 'fulfilled') throw new Error('Expected import fulfillment');
  return result.value;
}
