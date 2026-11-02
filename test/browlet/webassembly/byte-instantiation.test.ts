import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { BrowsingContext, createDocumentState, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

// WebAssembly JavaScript API §5: the byte-input overload, through its namespace binding.
// Module/Instance interfaces and JSTag follow in separate slices.
describe('WebAssembly byte-input instantiation', () => {
  it('returns the invoked realm\'s Promise, result object, Module, and Instance', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const pending = foreign.WebAssembly.instantiate(new Uint8Array(source));
      const ownPromise = Object.getPrototypeOf(pending) === foreign.Promise.prototype;
      const result = await pending;
      return {
        ownPromise,
        ownResult: Object.getPrototypeOf(result) === foreign.Object.prototype,
        ownModule: result.module instanceof foreign.WebAssembly.Module,
        ownInstance: result.instance instanceof foreign.WebAssembly.Instance,
        reusable: new WebAssembly.Instance(result.module) instanceof WebAssembly.Instance,
      };
    }, emptyModule)).toEqual({ ownPromise: true, ownResult: true, ownModule: true, ownInstance: true, reusable: true });
  });

  it('copies bytes before returning but reads imports after compilation', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const trace: string[] = [];
      const bytes = new Uint8Array(source);
      let value = 1;
      let observed = 0;
      const pending = WebAssembly.instantiate(bytes, {
        get env() {
          trace.push('import');
          const captured = value;
          return { start() { observed = captured; } };
        },
      });
      bytes.fill(0);
      value = 2;
      trace.push('returned');
      queueMicrotask(() => { trace.push('microtask'); });
      await pending;
      return { trace, observed };
    }, startModule)).toEqual({ trace: ['returned', 'microtask', 'import'], observed: 2 });
  });

  // SPEC_CLASH(wasm-byte-module-promise): The adapter restores resolution skipped by Node 24's combined operation.
  it('assimilates the compiled Module before reading imports', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const trace: string[] = [];
      Object.defineProperty(WebAssembly.Module.prototype, 'then', {
        get() { trace.push('module then'); return undefined; },
      });
      // The specification calls internal algorithms, not these public properties.
      WebAssembly.compile = () => { throw new Error('replaced compile'); };
      const result = await WebAssembly.instantiate(new Uint8Array(source), {
        get env() { trace.push('import'); return { start() { trace.push('start'); } }; },
      });
      return { trace, instance: result.instance instanceof WebAssembly.Instance };
    }, startModule)).toEqual({ trace: ['module then', 'import', 'start'], instance: true });
  });

  it('rejects invalid bytes without reading imports', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async () => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      let touched = false;
      try {
        await foreign.WebAssembly.instantiate(new Uint8Array([0]), {
          get env(): never { touched = true; throw new Error('unreachable import'); },
        });
      } catch (error) { return { compileError: error instanceof foreign.WebAssembly.CompileError, touched }; }
      return { compileError: false, touched };
    })).toEqual({ compileError: true, touched: false });
  });

  it('rejects a replacement compilation value without compiling it again or reading imports', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      let lookups = 0;
      let imports = 0;
      Object.defineProperty(WebAssembly.Module.prototype, 'then', {
        get() {
          lookups++;
          return (resolve: (value: unknown) => void) => { resolve(new Uint8Array(source)); };
        },
      });
      try {
        await WebAssembly.instantiate(new Uint8Array(source), {
          get env() { imports++; return {}; },
        });
      } catch (error) { return { typeError: error instanceof TypeError, lookups, imports }; }
      return { typeError: false, lookups, imports };
    }, emptyModule)).toEqual({ typeError: true, lookups: 1, imports: 0 });
  });

  it('observes Module and Instance then properties once each', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const trace: string[] = [];
      for (const [name, prototype] of [['module', WebAssembly.Module.prototype], ['instance', WebAssembly.Instance.prototype]] as const) {
        Object.defineProperty(prototype, 'then', { get() { trace.push(name); return undefined; } });
      }
      await WebAssembly.instantiate(new Uint8Array(source));
      return trace;
    }, emptyModule)).toEqual(['module', 'instance']);
  });

  it.each(['import', 'start'])('rejects with the original exception from %s code', async (phase) => {
    const browser = fixture();
    expect(await browser.evaluate(async ({ source, phase }) => {
      const marker = new Error('author failure');
      try {
        await WebAssembly.instantiate(new Uint8Array(source), {
          env: {
            get start() {
              if (phase === 'import') throw marker;
              return () => { throw marker; };
            },
          },
        });
      } catch (error) { return error === marker; }
      return false;
    }, { source: startModule, phase })).toBe(true);
  });

  it('retains builtin and string-import choices on the compiled Module', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const imports = new Proxy({}, { get() { throw new Error('builtin must bypass the supplied imports'); } });
      const result = await Reflect.apply(WebAssembly.instantiate, null, [new Uint8Array(source), imports, {
        builtins: ['js-string'], importedStringConstants: 'strings',
      }]) as WebAssembly.WebAssemblyInstantiatedSource;
      const second = await WebAssembly.instantiate(result.module, imports);
      return [result.instance, second].map(({ exports }) => ({
        hello: (exports.hello as WebAssembly.Global).value as string,
        length: (exports.length as (value: string) => number)('hello'),
      }));
    }, builtinModule)).toEqual([{ hello: 'hello', length: 5 }, { hello: 'hello', length: 5 }]);
  });

  // SPEC_CLASH(wasm-validate-bindings): The remaining cases retain the draft's buffer/options conversion.
  it('accepts a DataView with its selected byte range', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const bytes = new Uint8Array(source.length + 4);
      bytes.fill(0xff);
      bytes.set(source, 2);
      const { instance } = await WebAssembly.instantiate(new DataView(bytes.buffer, 2, source.length));
      return instance instanceof WebAssembly.Instance;
    }, emptyModule)).toBe(true);
  });

  it('accepts a raw shared buffer and rejects its invalid bytes with CompileError', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async () => {
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
      // The shared buffer is accepted; its zero-filled contents are not a module.
      try { await WebAssembly.instantiate(memory.buffer); }
      catch (error) { return error instanceof WebAssembly.CompileError; }
      return false;
    })).toBe(true);
  });

  it('rejects primitive compile options through the invoked realm\'s Promise', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      let pending: Promise<unknown>;
      try { pending = Reflect.apply(foreign.WebAssembly.instantiate, null, [new Uint8Array(source), {}, 1]) as Promise<unknown>; }
      catch { return false; }
      try { await pending; }
      catch (error) { return pending instanceof foreign.Promise && error instanceof foreign.TypeError; }
      return false;
    }, emptyModule)).toBe(true);
  });

  it('converts the options dictionary and builtin sequence before compilation', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const trace: string[] = [];
      await Reflect.apply(WebAssembly.instantiate, null, [new Uint8Array(source), {}, {
        get builtins() {
          trace.push('builtins');
          return {
            *[Symbol.iterator]() {
              trace.push('iterator');
              yield { toString() { trace.push('builtin string'); return 'unknown'; } };
            },
          };
        },
        get importedStringConstants() {
          trace.push('strings');
          return { toString() { trace.push('import string'); return 'constants'; } };
        },
      }]);
      return trace;
    }, emptyModule)).toEqual(['builtins', 'iterator', 'builtin string', 'strings', 'import string']);
  });

  it.each(['js-string', 'unknown'])('rejects duplicate %s builtins before reading imports', async (name) => {
    const browser = fixture();
    expect(await browser.evaluate(async ({ source, name }) => {
      let touched = false;
      try {
        await Reflect.apply(WebAssembly.instantiate, null, [new Uint8Array(source), {
          get env() { touched = true; return { start() {} }; },
        }, { builtins: [name, name] }]);
      } catch (error) { return { compileError: error instanceof WebAssembly.CompileError, touched }; }
      return { compileError: false, touched };
    }, { source: startModule, name })).toEqual({ compileError: true, touched: false });
  });

  it.each(['mutate', 'detach'])('copies bytes after an option getter can %s them', async (action) => {
    const browser = fixture();
    expect(await browser.evaluate(async ({ source, action }) => {
      const bytes = new Uint8Array(source);
      try {
        await Reflect.apply(WebAssembly.instantiate, null, [bytes, {}, {
          get builtins() {
            if (action === 'detach') bytes.buffer.transfer();
            else bytes.fill(0);
            return [];
          },
        }]);
      } catch (error) { return error instanceof WebAssembly.CompileError; }
      return false;
    }, { source: emptyModule, action })).toBe(true);
  });
});

function fixture(): Browlet {
  const browser = new Browlet({ route: () => '', reporting: false });
  const foreign = createSiblingWindow(browser);
  const realm = getRelevantRealm(foreign);
  const document = realm.getAssociatedDocument();
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

// (module (import "strings" "hello" (global externref))
//         (import "wasm:js-string" "length" (func (param externref) (result i32)))
//         (export "hello" (global 0)) (export "length" (func 0)))
const builtinModule = [
  0, 97, 115, 109, 1, 0, 0, 0, 1, 6, 1, 96, 1, 111, 1, 127,
  2, 42, 2, 7, 115, 116, 114, 105, 110, 103, 115, 5, 104, 101, 108, 108, 111, 3, 111, 0,
  14, 119, 97, 115, 109, 58, 106, 115, 45, 115, 116, 114, 105, 110, 103, 6, 108, 101, 110, 103, 116, 104, 0, 0,
  7, 18, 2, 5, 104, 101, 108, 108, 111, 3, 0, 6, 108, 101, 110, 103, 116, 104, 0, 0,
];
