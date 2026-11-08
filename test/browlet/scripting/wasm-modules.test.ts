import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InternalError } from '../../../src/infra/index';
import { addon } from '../../../src/js-engine/index';
import { CSPList } from '../../../src/browlet/browsing/policy/csp/list';
import { ContentSecurityPolicy } from '../../../src/browlet/browsing/policy/csp/policy';
import { utf8Encode } from '../../../src/encoding/index';
import { FetchHeaders } from '../../../src/fetch/index';
import { serializeURL } from '../../../src/url/index';
import { WasmMemoryImpl } from '../../../src/browlet/webassembly/index';
import { getPlatformRecord, PlatformRecordSource } from '../../../src/web-idl/values/index';
import { Browlet } from '../../../src/browlet/browlet';
import {
  JSModuleScript, WasmModuleScript, CompiledScriptOrModule, CompiledWasmModule, type ModuleScript,
} from '../../../src/browlet/scripting/script';
import { ScriptFetchOptions } from '../../../src/browlet/scripting/script-fetch-options';
import { getRelevantRealm } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';
import { mockHTTPTransport } from '../../fetch/transport-fixture';

afterEach(() => vi.restoreAllMocks());

// ESM §10 parsing and its HTML record connection. Stock Node's missing VM class
// is a capability boundary, not a fallback to a different module representation.
describe('HTML WebAssembly module records', () => {
  if (!addon.createContextHandle) {
    it('keeps stock Node ESM parsing explicitly unsupported', () => {
      const f = fixture();
      expect(() => f.wasm(constant())).toThrow(InternalError);
      expect(() => f.wasm(constant())).toThrow('WebAssembly ESM parsing requires the compatibility addon');
    });
    return;
  }

  it('records a compilation-realm CSP failure before creating the Wasm module graph', () => {
    const f = fixture();
    const policies = new CSPList(f.env.origin);
    f.env.policyContainer.cspList = policies;
    policies.policies.push(ContentSecurityPolicy.parse("script-src 'none'", 'header', 'enforce'));
    const blocked = f.wasm(constant());
    expect(blocked.compiled).toBeNull();
    expect(blocked.parseError).toBeInstanceOf(f.env.realm.WebAssemblyCompileError);
    policies.policies[0] = ContentSecurityPolicy.parse("script-src 'wasm-unsafe-eval'", 'header', 'enforce');
    expect(f.wasm(constant()).parseError).toBeNull();
  });

  it('retains copied source bytes, realm, URL, HTML association, and unlinked state', () => {
    const f = fixture();
    const bytes = constant();
    const padded = new Uint8Array(bytes.length + 4).fill(255);
    padded.set(bytes, 2);
    const script = f.wasm(padded.subarray(2, bytes.length + 2));
    padded.fill(0);
    expect(script.parseError).toBeNull();
    const record = script.compiled!;
    expect(record).toBeInstanceOf(CompiledWasmModule);
    expect(record.script).toBe(script);
    expect(record.realm).toBe(f.env.realm);
    expect(CompiledScriptOrModule.fromEngineCode(record.code)).toBe(record);
    expect(record.code.identifier).toBe('https://modules.test/root.wasm');
    expect(record.code.status).toBe('unlinked');
    expect(record.code.instance).toBeUndefined();
    expect(record.requestedModulesLoaded).toBe(false);
    expect(record.loadedModules.size).toBe(0);
    expect(Object.getPrototypeOf(record.code.source)).toBe(f.env.realm.WebAssemblyModule.prototype);
    const instance = Reflect.construct(f.env.realm.WebAssemblyInstance, [record.code.source]) as WebAssembly.Instance;
    expect((instance.exports.answer as () => number)()).toBe(42);
  });

  it('retains each external request once, in first-occurrence order, without the private helper', () => {
    const f = fixture();
    const script = f.wasm(binary({
      imports: [
        ['./second.js', 'a', 'function', [0]], ['./first.js', 'b', 'function', [0]],
        ['./second.js', 'c', 'function', [0]], ['browlet:wasm-instantiate', 'd', 'function', [0]],
      ],
    }));
    expect(script.parseError).toBeNull();
    expect(script.compiled!.requestedModules).toEqual([
      { specifier: './second.js', attributes: [], phase: 'evaluation' },
      { specifier: './first.js', attributes: [], phase: 'evaluation' },
      { specifier: 'browlet:wasm-instantiate', attributes: [], phase: 'evaluation' },
    ]);
  });

  it('applies the fixed ESM string builtin and string-constant options without external requests', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const script = f.wasm(binary({
        types: [[[0x6f], [0x7f]]], imports: [
          ['wasm:js-string', 'test', 'function', [0]],
          ['wasm:js/string-constants', 'hello', 'global', [0x6f, 0]],
        ], exports: [['test', 'function', 0], ['text', 'global', 0]],
      }));
      expect(script.parseError).toBeNull();
      expect(script.compiled!.requestedModules).toEqual([]);
      script.compiled!.link();
      const namespace = evaluate(script) as { test(value: unknown): number; text: string; };
      expect(namespace.test('hello')).toBe(1);
      expect(namespace.test(1)).toBe(0);
      expect(namespace.text).toBe('hello');
    });
  });

  it('preserves realm-owned CompileError for malformed bytes and invalid builtin signatures', () => {
    const f = fixture();
    for (const bytes of [new Uint8Array([0]), callImport('wasm:js-string', 'test')]) {
      const script = f.wasm(bytes);
      expect(script.compiled).toBeNull();
      expect(script.parseError).toBeInstanceOf(f.env.realm.WebAssemblyCompileError);
      expect(script.errorToRethrow).toBeNull();
    }
  });

  it.each([
    ['reserved module', () => callImport('wasm-js:private')],
    ['reserved import', () => callImport('./js', 'wasm:private')],
    ['reserved JS import', () => callImport('./js', 'wasm-js:private')],
    ['reserved export', () => constant('wasm:private')],
    ['reserved JS export', () => constant('wasm-js:private')],
  ])('records LinkError for a %s before loading dependencies', (_name, bytes) => {
    const f = fixture();
    const script = f.wasm(bytes());
    expect(script.compiled).toBeNull();
    expect(script.parseError).toBeInstanceOf(Reflect.get(f.env.realm.WebAssembly, 'LinkError') as ErrorConstructor);
    expect(script.errorToRethrow).toBeNull();
  });

  it('uses an empty module when scripting is disabled, leaving the original bytes alone', () => {
    const f = fixture();
    f.env.userAgent.scriptingEnabled = false;
    const bytes = new Uint8Array([1, 2, 3]);
    const script = f.wasm(bytes);
    expect(script.parseError).toBeNull();
    expect(script.compiled!.requestedModules).toEqual([]);
    expect(WebAssembly.Module.exports(script.compiled!.code.source as unknown as WebAssembly.Module)).toEqual([]);
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('neither parsing nor linking runs start; evaluation prepares and cleans up the imported callback once', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const js = f.js('export function start() { globalThis.starts = (globalThis.starts ?? 0) + 1; }');
      const script = f.wasm(binary({ types: [[[], []]], imports: [['./js', 'start', 'function', [0]]], start: 0 }));
      const prepare = vi.spyOn(f.env.realm.callbacks, 'prepareToRunCallback');
      const cleanup = vi.spyOn(f.env.realm.callbacks, 'cleanUpAfterRunningCallback');
      script.compiled!.loadedModules.set(script.compiled!.requestedModules[0]!, js.compiled!);
      script.compiled!.link();
      expect(script.compiled!.code.instance).toBeUndefined();
      expect(Reflect.has(f.env.global, 'starts')).toBe(false);
      expect(prepare).not.toHaveBeenCalled();
      const namespace = evaluate(script);
      expect(Reflect.get(f.env.global, 'starts')).toBe(1);
      expect(prepare).toHaveBeenCalledExactlyOnceWith(f.env);
      expect(cleanup).toHaveBeenCalledExactlyOnceWith(f.env);
      expect(f.env.realm.getWebAssemblyNamespaceInstance(namespace)).toBe(script.compiled!.code.instance);
      evaluate(script);
      expect(Reflect.get(f.env.global, 'starts')).toBe(1);
      expect(f.env.responsibleEventLoop.executionContextStack).toEqual([]);
      expect(f.env.responsibleEventLoop.backupIncumbentEnvironmentStack).toEqual([]);
    });
  });

  it.each([false, true])('keeps imported result coercion inside callback cleanup, throwing = %s', async (throws) => {
    await runInHostTask(() => {
      const f = fixture();
      const events: string[] = [];
      const marker = {};
      Reflect.set(f.env.global, 'events', events);
      Reflect.set(f.env.global, 'marker', marker);
      Reflect.set(f.env.global, 'shouldThrow', throws);
      const js = f.js('export function answer() { events.push("call"); return { valueOf() { events.push("convert"); if (shouldThrow) throw marker; return 42; } }; }');
      const script = f.wasm(callImport());
      script.compiled!.loadedModules.set(script.compiled!.requestedModules[0]!, js.compiled!);
      script.compiled!.link();
      const namespace = evaluate(script) as { answer(): number; };
      const callbacks = f.env.realm.callbacks;
      const prepare = callbacks.prepareToRunCallback.bind(callbacks);
      const cleanup = callbacks.cleanUpAfterRunningCallback.bind(callbacks);
      vi.spyOn(callbacks, 'prepareToRunCallback').mockImplementation((env) => { events.push('prepare'); prepare(env); });
      vi.spyOn(callbacks, 'cleanUpAfterRunningCallback').mockImplementation((env) => { events.push('cleanup'); cleanup(env); });
      if (throws) {
        let reason: unknown;
        try { namespace.answer(); } catch (error) { reason = error; }
        expect(reason).toBe(marker);
      } else {
        expect(namespace.answer()).toBe(42);
      }
      expect(events).toEqual(['prepare', 'call', 'convert', 'cleanup']);
      expect(f.env.responsibleEventLoop.executionContextStack).toEqual([]);
      expect(f.env.responsibleEventLoop.backupIncumbentEnvironmentStack).toEqual([]);
    });
  });

  it('establishes its own module context after an awaited dependency, without executing during parsing', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const js = f.js('await new Promise(resolve => globalThis.release = resolve); export function start() { globalThis.started = true; }');
      const script = f.wasm(binary({ types: [[[], []]], imports: [['./js', 'start', 'function', [0]]], start: 0 }));
      script.compiled!.loadedModules.set(script.compiled!.requestedModules[0]!, js.compiled!);
      script.compiled!.link();
      let settled = false;
      let reason: unknown;
      script.run(true).observe(() => { settled = true; }, (error) => { reason = error; });
      f.env.responsibleEventLoop.performMicrotaskCheckpoint();
      expect(settled).toBe(false);
      expect(script.compiled!.code.instance).toBeUndefined();
      const release = Reflect.get(f.env.global, 'release') as () => void;
      release();
      f.env.responsibleEventLoop.performMicrotaskCheckpoint();
      expect(reason).toBeUndefined();
      expect(settled).toBe(true);
      expect(Reflect.get(f.env.global, 'started')).toBe(true);
      expect(f.env.responsibleEventLoop.executionContextStack).toEqual([]);
      expect(f.env.responsibleEventLoop.backupIncumbentEnvironmentStack).toEqual([]);
    });
  });

  // ESM §§10.1–10.4: observe V8's export resolution and module environment
  // through HTML records, rather than rebuilding those engine algorithms here.
  it('exposes every declared name in one immutable namespace, with bindings in TDZ before evaluation', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const names = ['z', 'default', '__proto__', '', 'not an identifier'];
      const wasm = f.wasm(binary({
        functions: [{ code: [0x41, 42] }], exports: names.map((name) => [name, 'function', 0]),
      }));
      link(wasm);
      const namespace = f.env.realm.getModuleNamespace(wasm.compiled!.code);
      expect(Object.getPrototypeOf(namespace)).toBeNull();
      expect(Object.isExtensible(namespace)).toBe(false);
      expect(Object.getOwnPropertyNames(namespace)).toEqual([...names].sort());
      for (const name of names) {
        expect(() => { f.env.realm.reflectGet(namespace, name); }).toThrow(f.env.realm.ReferenceError);
      }
      expect(evaluate(wasm)).toBe(namespace);
      const instance = wasm.compiled!.code.instance as unknown as WebAssembly.Instance;
      for (const name of names) {
        expect(Reflect.get(namespace, name)).toBe(instance.exports[name]);
        expect(Reflect.set(namespace, name, null)).toBe(false);
        expect(Reflect.deleteProperty(namespace, name)).toBe(false);
      }
      expect((Reflect.get(namespace, 'default') as () => number)()).toBe(42);
    });
  });

  it('resolves a diamond re-export to the same Wasm binding and excludes default from export star', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const wasm = f.wasm(binary({
        functions: [{ code: [0x41, 42] }], exports: [['answer', 'function', 0], ['default', 'function', 0]],
      }));
      const left = f.js('export * from "./wasm";');
      const right = f.js('export { answer } from "./wasm";');
      const root = f.js('export * from "./left"; export * from "./right"; export { default as chosen } from "./wasm";');
      link(root, [[root, [left, right, wasm]], [left, [wasm]], [right, [wasm]]]);
      const namespace = evaluate(root) as { answer: () => number; chosen: () => number; };
      expect(Object.keys(namespace)).toEqual(['answer', 'chosen']);
      expect(namespace.answer).toBe(namespace.chosen);
      expect(namespace.answer()).toBe(42);
    });
  });

  it.each(['missing', 'ambiguous'])('rejects an export during linking without running any module: %s', (kind) => {
    const f = fixture();
    const first = f.wasm(constant());
    const second = f.wasm(constant());
    const barrel = f.js('export * from "./first"; export * from "./second"; globalThis.ran = true;');
    const root = f.js(`import { ${kind === 'missing' ? 'absent' : 'answer'} } from "./barrel";`);
    expect(() => link(root, [[root, [barrel]], [barrel, [first, second]]])).toThrow(f.env.realm.SyntaxError);
    expect(first.compiled!.code.instance).toBeUndefined();
    expect(second.compiled!.code.instance).toBeUndefined();
    expect(Reflect.has(f.env.global, 'ran')).toBe(false);
  });

  it('does not re-export imported names that the Wasm module did not export', () => {
    const f = fixture();
    const dependency = f.js('export function hidden() { return 42; }');
    const wasm = f.wasm(binary({ imports: [['./js', 'hidden', 'function', [0]]] }));
    const root = f.js('import { hidden } from "./wasm";');
    expect(() => link(root, [[root, [wasm]], [wasm, [dependency]]])).toThrow(f.env.realm.SyntaxError);
    expect(wasm.compiled!.code.instance).toBeUndefined();
  });

  // ESM §10.5: preserve native linking/instantiation while applying the HTML
  // callback adapter at the known Wasm execution entry.
  it.each([true, false])('respects a JavaScript binding in a mixed cycle, hoisted = %s', async (hoisted) => {
    await runInHostTask(() => {
      const f = fixture();
      const js = f.js('import { answer as wasmAnswer } from "./wasm"; ' + (hoisted
        ? 'export function answer() { return 42; } export const result = wasmAnswer();'
        : 'export const answer = () => 42;'));
      const wasm = f.wasm(callImport());
      link(js, [[js, [wasm]], [wasm, [js]]]);
      if (hoisted) {
        expect(Reflect.get(evaluate(js), 'result')).toBe(42);
      } else {
        expect(rejection(js)).toBeInstanceOf(f.env.realm.ReferenceError);
        expect(wasm.compiled!.code.instance).toBeUndefined();
      }
      expect(f.env.responsibleEventLoop.executionContextStack).toEqual([]);
    });
  });

  it('projects ESM memory exports once across a JavaScript re-export and Wasm import', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const producer = f.wasm(binary({ memories: [[0, 1]], exports: [['memory', 'memory', 0]] }));
      const js = f.js('export { memory } from "./producer";');
      const consumer = f.wasm(binary({ imports: [['./js', 'memory', 'memory', [0, 1]]], exports: [['memory', 'memory', 0]] }));
      link(consumer, [[consumer, [js]], [js, [producer]], [producer, []]]);
      const namespace = evaluate(consumer);
      const memory: unknown = Reflect.get(namespace, 'memory');
      const record = getPlatformRecord(memory, PlatformRecordSource.Platform)!;
      expect(record.implInst).toBeInstanceOf(WasmMemoryImpl);
      expect(record.realm).toBe(f.env.realm);
      expect(record.implInst).not.toBe(memory);
      expect(Reflect.get(f.env.realm.getModuleNamespace(producer.compiled!.code), 'memory')).toBe(memory);
      expect(Reflect.get(consumer.compiled!.instance.exports, 'memory')).toBe(memory);
      expect(Reflect.get(producer.compiled!.instance.exports, 'memory')).toBe(memory);
      const api = Reflect.get(f.browser.window, 'WebAssembly') as { namespaceInstance(namespace: object): object; };
      expect(getPlatformRecord(api.namespaceInstance(namespace), PlatformRecordSource.Platform)!.implInst).toBe(consumer.compiled!.instance);
    });
  });

  it('retains direct Wasm global and memory identity through HTML records', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const original = f.wasm(mutableGlobal());
      const consumer = f.wasm(importGlobal());
      link(consumer, [[consumer, [original]]]);
      const namespace = evaluate(consumer) as { read(): number; };
      const source = f.env.realm.getModuleNamespace(original.compiled!.code) as { bump(): void; };
      expect(namespace.read()).toBe(1);
      source.bump();
      expect(namespace.read()).toBe(2);
      const originalInstance = original.compiled!.code.instance as unknown as WebAssembly.Instance;
      const consumerInstance = consumer.compiled!.code.instance as unknown as WebAssembly.Instance;
      expect(consumerInstance.exports.value).toBe(originalInstance.exports.value);

      const memory = f.wasm(binary({ memories: [[0, 1]], exports: [['memory', 'memory', 0]] }));
      const usesMemory = f.wasm(binary({
        imports: [['./memory', 'memory', 'memory', [0, 1]]], exports: [['memory', 'memory', 0]],
      }));
      link(usesMemory, [[usesMemory, [memory]]]);
      expect(Reflect.get(evaluate(usesMemory), 'memory'))
        .toBe(Reflect.get(f.env.realm.getModuleNamespace(memory.compiled!.code), 'memory'));
    });
  });

  // The private binding lookup is deliberately absent on unreviewed engines.
  // Keep the required result there as the existing, approved re-export gap.
  const native = createRequire(__filename)('../../../node-compat/test/support/native-vm.cjs') as {
    haveSameModuleBinding?: unknown;
  };
  const reexportTest = typeof native.haveSameModuleBinding === 'function' ? it : it.fails;
  reexportTest('preserves a Global through JavaScript re-exports and HTML Wasm instantiation', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const original = f.wasm(mutableGlobal());
      const renamed = f.js('export {value as renamed, bump} from "./original";');
      const barrel = f.js('export {renamed as value, bump} from "./renamed";');
      const consumer = f.wasm(importGlobal('./barrel'));
      link(consumer, [[consumer, [barrel]], [barrel, [renamed]], [renamed, [original]]]);
      const namespace = evaluate(consumer) as { read(): number; };
      const source = f.env.realm.getModuleNamespace(barrel.compiled!.code) as { bump(): void; };
      expect(namespace.read()).toBe(1);
      source.bump();
      expect(namespace.read()).toBe(2);
      expect(Reflect.get(consumer.compiled!.instance.exports, 'value'))
        .toBe(Reflect.get(original.compiled!.instance.exports, 'value'));
    });
  });

  it('rejects an uninstantiated Wasm dependency in a cycle with LinkError', async () => {
    await runInHostTask(() => {
      const f = fixture();
      const first = f.wasm(callImport('./second'));
      const second = f.wasm(callImport('./first'));
      link(first, [[first, [second]], [second, [first]]]);
      expect(rejection(first)).toBeInstanceOf(Reflect.get(f.env.realm.WebAssembly, 'LinkError') as ErrorConstructor);
      expect(first.compiled!.code.instance).toBeUndefined();
      expect(second.compiled!.code.instance).toBeUndefined();
    });
  });

  // The ESM draft reverses the subtype operands; its own JS API equivalence
  // note and Core matching require the supplied memory to satisfy the import.
  it.each([[2, 1, true], [1, 2, false]] as const)('checks supplied minimum %i against required minimum %i (accepted: %s)', async (minimum, required, accepted) => {
    await runInHostTask(() => {
      const f = fixture();
      const memory = f.wasm(binary({ memories: [[0, minimum]], exports: [['memory', 'memory', 0]] }));
      const consumer = f.wasm(binary({ imports: [['./memory', 'memory', 'memory', [0, required]]] }));
      link(consumer, [[consumer, [memory]]]);
      if (accepted) {
        evaluate(consumer);
        expect(consumer.compiled!.code.instance).toBeDefined();
      } else {
        expect(rejection(consumer)).toBeInstanceOf(Reflect.get(f.env.realm.WebAssembly, 'LinkError') as ErrorConstructor);
        expect(consumer.compiled!.code.instance).toBeUndefined();
      }
      expect(memory.compiled!.code.instance).toBeDefined();
      expect(f.env.responsibleEventLoop.executionContextStack).toEqual([]);
    });
  });

  it.each(['throw', 'trap'])('retains a start %s as the evaluation error and never retries start', async (kind) => {
    await runInHostTask(() => {
      const f = fixture();
      const marker = {};
      Reflect.set(f.env.global, 'marker', marker);
      const js = f.js(`export function start() { globalThis.starts = (globalThis.starts ?? 0) + 1; ${kind === 'throw' ? 'throw marker;' : ''} }`);
      const wasm = f.wasm(binary({
        types: [[[], []]], imports: [['./js', 'start', 'function', [0]]],
        functions: [{ code: [0x10, 0, 0x00] }], start: 1,
      }));
      link(wasm, [[wasm, [js]]]);
      const error = rejection(wasm);
      if (kind === 'throw') expect(error).toBe(marker);
      else expect(error).toBeInstanceOf(Reflect.get(f.env.realm.WebAssembly, 'RuntimeError') as ErrorConstructor);
      expect(wasm.compiled!.code.error).toBe(error);
      expect(rejection(wasm)).toBe(error);
      expect(Reflect.get(f.env.global, 'starts')).toBe(1);
      expect(wasm.compiled!.code.instance).toBeUndefined();
      expect(f.env.responsibleEventLoop.executionContextStack).toEqual([]);
      expect(f.env.responsibleEventLoop.backupIncumbentEnvironmentStack).toEqual([]);
    });
  });

  it('fetches a mixed JS/Wasm/JS graph through the existing HTML loader', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    await browser.navigate('https://modules.test/page');
    const env = getRelevantRealm(browser.window).env;
    const requests: string[] = [];
    mockHTTPTransport(env.userAgent, (request, listener) => {
      const url = serializeURL(request.url);
      requests.push(url);
      const wasm = url.endsWith('.wasm');
      listener.onHeaders(200, '', new FetchHeaders([['Content-Type', wasm ? 'application/wasm' : 'text/javascript']]), true);
      listener.onData(wasm ? callImport('./callback.js') : utf8Encode(url.endsWith('/root.js')
        ? 'export { answer } from "./answer.wasm";' : 'export function answer() { return 42; }'));
      listener.onEnd();
    });
    const root = await new Promise<ModuleScript | null>((complete) => {
      env.fetchExternalModuleScriptGraph(env.parseURL('https://modules.test/root.js')!, new ScriptFetchOptions(), complete);
    });
    expect(requests).toEqual([
      'https://modules.test/root.js', 'https://modules.test/answer.wasm', 'https://modules.test/callback.js',
    ]);
    expect(root!.errorToRethrow).toBeNull();
    await runInHostTask(() => {
      const namespace = evaluate(root!) as { answer(): number; };
      expect(namespace.answer()).toBe(42);
    });
  });

  it('source-imports a public Module without fetching or evaluating its dependencies', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    await browser.navigate('https://modules.test/page');
    const env = getRelevantRealm(browser.window).env;
    const requests: string[] = [];
    mockHTTPTransport(env.userAgent, (request, listener) => {
      const url = serializeURL(request.url);
      requests.push(url);
      const wasm = url.endsWith('.wasm');
      listener.onHeaders(200, '', new FetchHeaders([['Content-Type', wasm ? 'application/wasm' : 'text/javascript']]), true);
      listener.onData(wasm ? callImport('./unloaded.js') : utf8Encode(`
        import source first from './answer.wasm';
        import source second from './answer.wasm';
        export { first, second };
        export const recognized = first instanceof WebAssembly.Module;
        export const answer = new WebAssembly.Instance(first, { './unloaded.js': { answer: () => 42 } }).exports.answer();
      `));
      listener.onEnd();
    });
    const root = await new Promise<ModuleScript | null>((complete) => {
      env.fetchExternalModuleScriptGraph(env.parseURL('https://modules.test/root.js')!, new ScriptFetchOptions(), complete);
    });
    expect(root!.errorToRethrow).toBeNull();
    expect(requests).toEqual(['https://modules.test/root.js', 'https://modules.test/answer.wasm']);
    const record = root!.compiled!.getLoadedModule(root!.compiled!.requestedModules[0]!) as CompiledWasmModule;
    expect(record.code.status).toBe('unlinked');
    expect(record.requestedModulesLoaded).toBe(false);
    expect(record.loadedModules.size).toBe(0);
    await runInHostTask(() => {
      const namespace = evaluate(root!) as { first: object; second: object; recognized: boolean; answer: number; };
      expect(namespace.first).toBe(namespace.second);
      expect(namespace.first).not.toBe(record.code.source);
      expect(namespace.recognized).toBe(true);
      expect(namespace.answer).toBe(42);
      expect(record.code.instance).toBeUndefined();
    });
  });
});

function fixture() {
  const browser = new Browlet({ route: () => '', reporting: false });
  const env = getRelevantRealm(browser.window).env;
  const options = new ScriptFetchOptions();
  return {
    browser, env,
    wasm: (bytes: Uint8Array) => new WasmModuleScript(bytes, env, env.parseURL('https://modules.test/root.wasm')!, options),
    js: (source: string) => new JSModuleScript(source, env, env.parseURL('https://modules.test/callback.js')!, options),
  };
}

function evaluate(script: ModuleScript): object {
  let result: { state: string; error?: unknown; } = { state: 'pending' };
  script.run(true).observe(() => { result = { state: 'fulfilled' }; }, (error) => { result = { state: 'rejected', error }; });
  script.env.responsibleEventLoop.performMicrotaskCheckpoint();
  expect(result).toEqual({ state: 'fulfilled' });
  return script.env.realm.getModuleNamespace(script.compiled!.code);
}

function link(root: ModuleScript, graph: [ModuleScript, ModuleScript[]][] = []): void {
  for (const [script, dependencies] of graph) {
    expect(script.parseError).toBeNull();
    expect(script.compiled!.requestedModules).toHaveLength(dependencies.length);
    dependencies.forEach((dependency, index) => {
      script.compiled!.loadedModules.set(script.compiled!.requestedModules[index]!, dependency.compiled!);
    });
  }
  root.compiled!.link();
}

function rejection(script: ModuleScript): unknown {
  let result: { state: string; error?: unknown; } = { state: 'pending' };
  script.run(true).observe(() => { result = { state: 'fulfilled' }; }, (error) => { result = { state: 'rejected', error }; });
  script.env.responsibleEventLoop.performMicrotaskCheckpoint();
  expect(result.state).toBe('rejected');
  return result.error;
}

// Reuse the backend's small binary fixtures; this helper does not load the addon.
const { binary, constant, callImport, mutableGlobal, importGlobal } = createRequire(__filename)('../../../node-compat/test/support/wasm-fixtures.cjs') as {
  binary(this: void, options: {
    types?: [number[], number[]][];
    imports?: [string, string, 'function' | 'global' | 'memory', number[]][];
    exports?: [string, 'function' | 'global' | 'memory', number][];
    functions?: { type?: number; code: number[]; }[];
    memories?: number[][];
    start?: number;
  }): Uint8Array;
  constant(this: void, name?: string): Uint8Array;
  callImport(this: void, module?: string, name?: string): Uint8Array;
  mutableGlobal(this: void): Uint8Array;
  importGlobal(this: void, module?: string): Uint8Array;
};
