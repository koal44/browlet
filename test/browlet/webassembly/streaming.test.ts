import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { BrowsingContext, createDocumentState, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { jsEngineTaskSource, networkingTaskSource } from '../../../src/browlet/scripting/tasks';
import { ResponseImpl } from '../../../src/fetch/response';
import { addon, JSRealm } from '../../../src/js-engine/index';
import { getBindingContext, getRelevantRealm, unwrap } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

afterEach(() => { vi.restoreAllMocks(); });

// Web API §§1–2: consume Browlet Responses, then reuse native compilation.
describe('WebAssembly streaming APIs', () => {
  it.each(['compileStreaming', 'instantiateStreaming'] as const)('accepts a Browlet Response through %s', async (operation) => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate(async ({ source, operation }) => {
      const response = new Response(new Uint8Array(source), { headers: { 'Content-Type': 'application/wasm' } });
      const result = operation === 'compileStreaming' ? await WebAssembly.compileStreaming(response) :
        (await WebAssembly.instantiateStreaming(response)).module;
      return { module: result instanceof WebAssembly.Module, used: response.bodyUsed };
    }, { source: emptyModule, operation })).toEqual({ module: true, used: true });
  });

  it('accepts promised/thenable Responses and consumes all stream chunks before compiling', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      let closed = false;
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(source.slice(0, 4)));
          queueMicrotask(() => { controller.enqueue(new Uint8Array(source.slice(4))); closed = true; controller.close(); });
        },
      });
      const response = new Response(body, { headers: { 'Content-Type': '\t APPLICATION/WASM ' } });
      const pending = WebAssembly.compileStreaming(Promise.resolve(response));
      const other: unknown = await Reflect.apply(WebAssembly.compileStreaming, undefined, [{
        then(resolve: (value: Response) => void) { resolve(new Response(new Uint8Array(source), { headers: { 'Content-Type': 'application/wasm' } })); },
      }]);
      return { module: await pending instanceof WebAssembly.Module, other: other instanceof WebAssembly.Module, closed, used: response.bodyUsed };
    }, emptyModule)).toEqual({ module: true, other: true, closed: true, used: true });
  });

  it('accepts a Response Promise returned by Browlet fetch', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async () => {
      const result = await WebAssembly.instantiateStreaming(fetch('data:application/wasm;base64,AGFzbQEAAAA='));
      return result.module instanceof WebAssembly.Module && result.instance instanceof WebAssembly.Instance;
    })).toBe(true);
  });

  it('returns the invoked realm\'s Promise, Module, Instance, and result dictionary for a foreign Response', async () => {
    const browser = fixture();
    addForeignWindow(browser);
    expect(await browser.evaluate(async (source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const response = new Response(new Uint8Array(source), { headers: { 'Content-Type': 'application/wasm' } });
      const compiled = foreign.WebAssembly.compileStreaming(response.clone());
      const instantiated = foreign.WebAssembly.instantiateStreaming(response);
      const module = await compiled;
      const result = await instantiated;
      return {
        promises: compiled instanceof foreign.Promise && instantiated instanceof foreign.Promise,
        module: module instanceof foreign.WebAssembly.Module && !(module instanceof WebAssembly.Module),
        result: Object.getPrototypeOf(result) === foreign.Object.prototype,
        instance: result.instance instanceof foreign.WebAssembly.Instance,
        retainedModule: result.module instanceof foreign.WebAssembly.Module,
      };
    }, emptyModule)).toEqual({ promises: true, module: true, result: true, instance: true, retainedModule: true });
  });

  it('reads internal response state and captured compilation functions instead of author replacements', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const response = new Response(new Uint8Array(source), { headers: { 'Content-Type': 'application/wasm' } });
      for (const key of ['headers', 'status', 'ok', 'type', 'body', 'arrayBuffer']) {
        Object.defineProperty(response, key, { get() { throw new Error('author response property'); } });
      }
      const compile = WebAssembly.compileStreaming;
      WebAssembly.compile = () => { throw new Error('author compile'); };
      WebAssembly.compileStreaming = () => { throw new Error('author compileStreaming'); };
      return await compile(response) instanceof WebAssembly.Module;
    }, emptyModule)).toBe(true);
  });

  it.each([
    null, 'text/plain', 'application/wasm;', 'application/wasm; charset=utf-8', 'application/wasm, application/wasm', '\u00a0application/wasm',
  ])('rejects Content-Type %s without consuming the body', async (mime) => {
    const browser = fixture();
    expect(await browser.evaluate(async ({ source, mime }) => {
      const response = new Response(new Uint8Array(source), { headers: mime === null ? {} : { 'Content-Type': mime } });
      try { await WebAssembly.compileStreaming(response); return { rejected: false, used: response.bodyUsed }; }
      catch (error) { return { rejected: error instanceof TypeError, used: response.bodyUsed }; }
    }, { source: emptyModule, mime })).toEqual({ rejected: true, used: false });
  });

  it.each([199, 200, 299, 300, 404])('requires an ok response status (%s)', async (status) => {
    const browser = fixture();
    // Response's constructor cannot create 199; model the transport's received record.
    const response = new browser.window.Response(new Uint8Array(emptyModule), { headers: { 'Content-Type': 'application/wasm' } });
    unwrap<ResponseImpl>(response).getResponse().status = status;
    Reflect.set(browser.window, 'sourceResponse', response);
    expect(await browser.evaluate(async () => {
      const response = Reflect.get(globalThis, 'sourceResponse') as Response;
      try { await WebAssembly.compileStreaming(response); return { accepted: true, used: response.bodyUsed }; }
      catch (error) { return { accepted: !(error instanceof TypeError), used: response.bodyUsed }; }
    })).toEqual({ accepted: status >= 200 && status <= 299, used: status >= 200 && status <= 299 });
  });

  it.each(['basic', 'cors', 'opaque', 'opaqueredirect'] as const)('respects the %s filtered response view', async (type) => {
    const browser = fixture();
    const realm = getRelevantRealm(browser.window);
    const response = new browser.window.Response(new Uint8Array(emptyModule), { headers: { 'Content-Type': 'application/wasm' } });
    const record = unwrap<ResponseImpl>(response).getResponse().filter(type);
    const filtered = getBindingContext(realm).project(ResponseImpl, new ResponseImpl(record, 'immutable', realm.env));
    Reflect.set(browser.window, 'sourceResponse', filtered);
    expect(await browser.evaluate(async () => {
      try { await WebAssembly.compileStreaming(Reflect.get(globalThis, 'sourceResponse') as Response); return true; }
      catch (error) { if (!(error instanceof TypeError)) throw error; return false; }
    })).toBe(type === 'basic' || type === 'cors');
  });

  it('rejects invalid sources and options asynchronously in the invoked realm', async () => {
    const browser = fixture();
    addForeignWindow(browser);
    expect(await browser.evaluate(async (source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const response = new Response(new Uint8Array(source), { headers: { 'Content-Type': 'application/wasm' } });
      const results: boolean[] = [];
      for (const args of [[], [null], [{}], [new Proxy(response, {})], [response, 1]]) {
        let result: Promise<unknown>;
        try { result = Reflect.apply(foreign.WebAssembly.compileStreaming, undefined, args) as Promise<unknown>; }
        catch { results.push(false); continue; }
        try { await result; results.push(false); }
        catch (error) { results.push(result instanceof foreign.Promise && error instanceof foreign.TypeError); }
      }
      return { results, used: response.bodyUsed };
    }, emptyModule)).toEqual({ results: [true, true, true, true, true], used: false });
  });

  it('preserves source rejection and body-stream errors exactly', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async () => {
      const marker = new Error('source or body');
      const stream = new ReadableStream({ start(controller) { controller.error(marker); } });
      const response = new Response(stream, { headers: { 'Content-Type': 'application/wasm' } });
      const results: boolean[] = [];
      for (const source of [Promise.reject(marker), response]) {
        try { await WebAssembly.compileStreaming(source); results.push(false); }
        catch (error) { results.push(error === marker); }
      }
      return results;
    })).toEqual([true, true]);
  });

  it('preserves author CompileErrors from sources, bodies, and Module then getters', async () => {
    const browser = fixture();
    // Even Node-owned CompileErrors can be author-supplied values, rather than
    // failures created by Node's streaming compiler in the wrong realm.
    Reflect.set(browser.window, 'hostCompileError', new WebAssembly.CompileError('author failure'));
    expect(await browser.evaluate(async (source) => {
      const marker = Reflect.get(globalThis, 'hostCompileError') as Error;
      const body = new ReadableStream({ start(controller) { controller.error(marker); } });
      const results: boolean[] = [];
      for (const response of [Promise.reject(marker), new Response(body, { headers: { 'Content-Type': 'application/wasm' } })]) {
        try { await WebAssembly.compileStreaming(response); results.push(false); }
        catch (error) { results.push(error === marker); }
      }
      Object.defineProperty(WebAssembly.Module.prototype, 'then', { get() { throw marker; } });
      try {
        await WebAssembly.compileStreaming(new Response(new Uint8Array(source), { headers: { 'Content-Type': 'application/wasm' } }));
        results.push(false);
      } catch (error) { results.push(error === marker); }
      return results;
    }, emptyModule)).toEqual([true, true, true]);
  });

  it.each(['locked', 'disturbed'] as const)('rejects a %s body', async (state) => {
    const browser = fixture();
    expect(await browser.evaluate(async ({ source, state }) => {
      const response = new Response(new Uint8Array(source), { headers: { 'Content-Type': 'application/wasm' } });
      if (state === 'locked') response.body!.getReader();
      else await response.arrayBuffer();
      try { await WebAssembly.compileStreaming(response); return false; }
      catch (error) { return error instanceof TypeError; }
    }, { source: emptyModule, state })).toBe(true);
  });

  it('reports an empty body and invalid bytes as CompileError without reading imports', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async () => {
      const results: boolean[] = [];
      for (const body of [null, new Uint8Array([0])]) {
        const response = new Response(body, { headers: { 'Content-Type': 'application/wasm' } });
        try { await WebAssembly.instantiateStreaming(response, { get env(): never { throw new Error('unreachable imports'); } }); results.push(false); }
        catch (error) { results.push(error instanceof WebAssembly.CompileError); }
      }
      return results;
    })).toEqual([true, true]);
  });

  it.each(['compileStreaming', 'instantiateStreaming'] as const)('creates %s compilation errors in the invoked realm', async (operation) => {
    const browser = fixture();
    addForeignWindow(browser);
    expect(await browser.evaluate(async (operation) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const response = new Response(new Uint8Array([0]), { headers: { 'Content-Type': 'application/wasm' } });
      try { await foreign.WebAssembly[operation](response); return false; }
      catch (error) { return error instanceof foreign.WebAssembly.CompileError && !(error instanceof WebAssembly.CompileError); }
    }, operation)).toBe(true);
  });

  it('converts options before reading the response and rejects duplicate builtins', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const response = new Response(new Uint8Array(source), { headers: { 'Content-Type': 'text/plain' } });
      const trace: string[] = [];
      const result = WebAssembly.compileStreaming(response, {
        get builtins() { trace.push('options'); response.headers.set('Content-Type', 'application/wasm'); return ['js-string', 'js-string']; },
      });
      trace.push('returned');
      try { await result; return { trace, rejected: false, used: response.bodyUsed }; }
      catch (error) { return { trace, rejected: error instanceof WebAssembly.CompileError, used: response.bodyUsed }; }
    }, emptyModule)).toEqual({ trace: ['options', 'returned'], rejected: true, used: true });
  });

  it('reads function imports after compilation and preserves host callbacks and failures', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const response = new Response(new Uint8Array(source), { headers: { 'Content-Type': 'application/wasm' } });
      const trace: string[] = [];
      const marker = new Error('callback');
      let shouldThrow = false;
      const pending = WebAssembly.instantiateStreaming(response, {
        get env() { trace.push('import'); return { read() { if (shouldThrow) throw marker; return 7; } }; },
      });
      trace.push('returned');
      const result = await pending;
      const read = result.instance.exports.read as () => number;
      const value = read();
      shouldThrow = true;
      let original = false;
      try { read(); } catch (error) { original = error === marker; }
      return { value, original, trace };
    }, importedFunctionModule)).toEqual({ value: 7, original: true, trace: ['returned', 'import'] });
  });

  it('passes compile-time string options through response compilation and instantiation', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const response = new Response(new Uint8Array(source), { headers: { 'Content-Type': 'application/wasm' } });
      const { instance } = await WebAssembly.instantiateStreaming(response, {}, { builtins: ['js-string'], importedStringConstants: 'strings' });
      return { text: (instance.exports.hello as WebAssembly.Global).value as unknown, length: (instance.exports.length as (value: string) => number)('hello') };
    }, builtinModule)).toEqual({ text: 'hello', length: 5 });
  });

  it('preserves Module thenable assimilation', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      Object.defineProperty(WebAssembly.Module.prototype, 'then', {
        get() { return (resolve: (value: number) => void) => { resolve(42); }; },
      });
      const response = new Response(new Uint8Array(source), { headers: { 'Content-Type': 'application/wasm' } });
      const copy = response.clone();
      const result: unknown = await WebAssembly.compileStreaming(response);
      let rejected = false;
      try { await WebAssembly.instantiateStreaming(copy, { get env(): never { throw new Error('unreachable imports'); } }); }
      catch (error) { rejected = error instanceof TypeError; }
      return { result, rejected };
    }, emptyModule)).toEqual({ result: 42, rejected: true });
  });

  it('selects networking completion without changing concurrent ordinary compilation', async () => {
    const browser = fixture();
    const loop = getRelevantRealm(browser.window).agent.eventLoop;
    const seen = new WeakSet<object>();
    const sources: unknown[] = [];
    Reflect.set(browser.window, 'recordModule', (module: object) => {
      if (seen.has(module)) return;
      seen.add(module);
      sources.push(loop.currentlyRunningTask?.source);
    });
    expect(await browser.evaluate(async (source) => {
      Object.defineProperty(WebAssembly.Module.prototype, 'then', {
        get() { (Reflect.get(globalThis, 'recordModule') as (module: object) => void)(this as object); },
      });
      const bytes = new Uint8Array(source);
      const response = new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } });
      const results = await Promise.all([WebAssembly.compileStreaming(response), WebAssembly.compile(bytes)]);
      return results.every((module) => module instanceof WebAssembly.Module);
    }, emptyModule)).toBe(true);
    expect(sources).toHaveLength(2);
    // Stock Node's documented fallback has no HTML completion handoff. All addon bases do.
    if (addon.setWasmAsyncCompletionCallback) expect(new Set(sources)).toEqual(new Set([networkingTaskSource, jsEngineTaskSource]));
  });

  it('selects networking even when V8 rejects before compile returns its Promise', async () => {
    const sources: string[] = [];
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Invoke the captured installer with its original receiver.
    const install = JSRealm.prototype.setWasmAsyncCompletionCallback;
    vi.spyOn(JSRealm.prototype, 'setWasmAsyncCompletionCallback').mockImplementation(function(this: JSRealm, callback) {
      install.call(this, callback === undefined ? undefined : (complete, source) => { sources.push(source); callback(complete, source); });
    });
    const browser = fixture();
    expect(await browser.evaluate(async () => {
      try { await WebAssembly.compileStreaming(new Response(new Uint8Array([0]), { headers: { 'Content-Type': 'application/wasm' } })); return false; }
      catch (error) { return error instanceof WebAssembly.CompileError; }
    })).toBe(true);
    expect(sources).toEqual(addon.setWasmAsyncCompletionCallback ? ['network'] : []);
  });
});

function fixture(): Browlet { return new Browlet({ route: () => '', reporting: false }); }

function addForeignWindow(browser: Browlet): void {
  const foreign = createSiblingWindow(browser);
  const realm = getRelevantRealm(foreign);
  const document = realm.getAssociatedDocument();
  // Native completion belongs to this Document and must wait while it is inactive.
  document.browsingContext = new BrowsingContext(realm.windowProxy);
  new TopLevelTraversable(createDocumentState(document));
  Reflect.set(browser.window, 'foreign', foreign);
}

const emptyModule = [0, 97, 115, 109, 1, 0, 0, 0];

// (module (import "env" "read" (func (result i32))) (export "read" (func 0)))
const importedFunctionModule = [
  ...emptyModule, 1, 5, 1, 0x60, 0, 1, 0x7f, 2, 12, 1, 3, 101, 110, 118, 4, 114, 101, 97, 100, 0, 0,
  7, 8, 1, 4, 114, 101, 97, 100, 0, 0,
];

// Import a compile-time string and js-string.length, then export both.
const builtinModule = [
  ...emptyModule, 1, 6, 1, 0x60, 1, 0x6f, 1, 0x7f,
  2, 42, 2, 7, 115, 116, 114, 105, 110, 103, 115, 5, 104, 101, 108, 108, 111, 3, 0x6f, 0,
  14, 119, 97, 115, 109, 58, 106, 115, 45, 115, 116, 114, 105, 110, 103, 6, 108, 101, 110, 103, 116, 104, 0, 0,
  7, 18, 2, 5, 104, 101, 108, 108, 111, 3, 0, 6, 108, 101, 110, 103, 116, 104, 0, 0,
];
