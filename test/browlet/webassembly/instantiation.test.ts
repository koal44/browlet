import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { BrowsingContext, createDocumentState, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

// WebAssembly JavaScript API §5: reading imports, creating exports, and
// asynchronously instantiating an existing Module. Byte-input conversion follows.
describe('WebAssembly module instantiation', () => {
  it('accepts another realm\'s Module and returns the invoked realm\'s Promise and Instance', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const module = new WebAssembly.Module(new Uint8Array(source));
      const result = foreign.WebAssembly.instantiate(module);
      const ownPromise = result instanceof foreign.Promise;
      const instance = await result;
      return {
        ownPromise,
        ownInstance: Object.getPrototypeOf(instance) === foreign.WebAssembly.Instance.prototype,
        otherInstance: instance instanceof WebAssembly.Instance,
      };
    }, emptyModule)).toEqual({ ownPromise: true, ownInstance: true, otherInstance: false });
  });

  it('recognizes native Modules without trusting their prototypes or public exports method', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const module = new WebAssembly.Module(new Uint8Array(source));
      Object.setPrototypeOf(module, null);
      WebAssembly.Module.exports = () => { throw new Error('replaced public method'); };
      const instance = await WebAssembly.instantiate(module);
      const rejected: boolean[] = [];
      for (const invalid of [Object.create(WebAssembly.Module.prototype), new Proxy(module, {})]) {
        try { await WebAssembly.instantiate(invalid as WebAssembly.Module); rejected.push(false); }
        catch (error) { rejected.push(error instanceof TypeError); }
      }
      return { instance: instance instanceof WebAssembly.Instance, rejected };
    }, emptyModule)).toEqual({ instance: true, rejected: [true, true] });
  });

  // SPEC_CLASH(wasm-instantiate-arity): V8 ignores the extra argument; the draft's IDL selects only the byte overload.
  it('rejects a Module with three arguments before reading compile options', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const module = new WebAssembly.Module(new Uint8Array(source));
      let touched = false;
      try {
        await Reflect.apply(WebAssembly.instantiate, null, [module, {}, {
          get builtins() { touched = true; return []; },
        }]);
      } catch (error) { return { typeError: error instanceof TypeError, touched }; }
      return { typeError: false, touched };
    }, emptyModule)).toEqual({ typeError: true, touched: false });
  });

  it('reads repeated imports synchronously in declaration order and retains each value', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const trace: string[] = [];
      let value = 0;
      const imports = {
        get env() {
          trace.push('env');
          return {
            get read() {
              trace.push('read');
              const captured = ++value;
              return () => captured;
            },
          };
        },
      };
      const module = new WebAssembly.Module(new Uint8Array(source));
      const result = WebAssembly.instantiate(module, imports);
      const synchronous = [...trace];
      value = 100;
      const { exports } = await result;
      return {
        synchronous, trace,
        values: [(exports.first as () => number)(), (exports.second as () => number)()],
        keys: Object.keys(exports),
        nullPrototype: Object.getPrototypeOf(exports) === null,
        frozen: Object.isFrozen(exports),
      };
    }, repeatedImports)).toEqual({
      synchronous: ['env', 'read', 'env', 'read'], trace: ['env', 'read', 'env', 'read'],
      values: [1, 2], keys: ['first', 'second'], nullPrototype: true, frozen: true,
    });
  });

  it.each(['import', 'start'])('rejects with the original exception from %s code', async (phase) => {
    const browser = fixture();
    expect(await browser.evaluate(async ({ source, phase }) => {
      const marker = new Error('author failure');
      const imports = {
        env: {
          get start() {
            if (phase === 'import') throw marker;
            return () => { throw marker; };
          },
        },
      };
      const module = new WebAssembly.Module(new Uint8Array(source));
      let result: Promise<WebAssembly.Instance>;
      try { result = WebAssembly.instantiate(module, imports); }
      catch { return { returnedPromise: false, sameError: false }; }
      try { await result; }
      catch (error) { return { returnedPromise: result instanceof Promise, sameError: error === marker }; }
      return { returnedPromise: true, sameError: false };
    }, { source: startModule, phase })).toEqual({ returnedPromise: true, sameError: true });
  });

  it('rejects invalid import containers and noncallable function imports in the invoked realm', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const module = new WebAssembly.Module(new Uint8Array(source));
      const results: boolean[] = [];
      for (const imports of [undefined, {}, { env: 1 }, { env: { start: 1 } }]) {
        const result = Reflect.apply(foreign.WebAssembly.instantiate, null, [module, imports]) as Promise<WebAssembly.Instance>;
        try { await result; results.push(false); }
        catch (error) {
          const ErrorType = typeof imports?.env === 'object' ? foreign.WebAssembly.LinkError : foreign.TypeError;
          results.push(result instanceof foreign.Promise && error instanceof ErrorType);
        }
      }
      return results;
    }, startModule)).toEqual([true, true, true, true]);
  });

  // SPEC_CLASH(wasm-module-start-timing): V8/Chromium run start synchronously; the draft, Firefox, and WebKit defer it.
  it.fails('runs a Module start function in a later task, after current microtasks', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const trace: string[] = [];
      const module = new WebAssembly.Module(new Uint8Array(source));
      const result = WebAssembly.instantiate(module, {
        env: { get start() { trace.push('import'); return () => { trace.push('start'); }; } },
      });
      trace.push('returned');
      queueMicrotask(() => { trace.push('microtask'); });
      await result;
      return trace;
    }, startModule)).toEqual(['import', 'returned', 'microtask', 'start']);
  });
});

function fixture(): Browlet {
  const browser = new Browlet({ route: () => '', reporting: false });
  const foreign = createSiblingWindow(browser);
  const realm = getRelevantRealm(foreign);
  const document = realm.getAssociatedDocument();
  // Native completion uses an HTML task, which requires an active Document.
  document.browsingContext = new BrowsingContext(realm.windowProxy);
  new TopLevelTraversable(createDocumentState(document));
  Reflect.set(browser.window, 'foreign', foreign);
  return browser;
}

// (module)
const emptyModule = [0, 97, 115, 109, 1, 0, 0, 0];

// (module (import "env" "start" (func)) (start 0))
const startModule = [
  0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0,
  2, 13, 1, 3, 101, 110, 118, 5, 115, 116, 97, 114, 116, 0, 0, 8, 1, 0,
];

// (module (import "env" "read" (func (result i32)))
//         (import "env" "read" (func (result i32)))
//         (export "first" (func 0)) (export "second" (func 1)))
const repeatedImports = [
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127,
  2, 23, 2, 3, 101, 110, 118, 4, 114, 101, 97, 100, 0, 0,
  3, 101, 110, 118, 4, 114, 101, 97, 100, 0, 0,
  7, 18, 2, 5, 102, 105, 114, 115, 116, 0, 0, 6, 115, 101, 99, 111, 110, 100, 0, 1,
];
