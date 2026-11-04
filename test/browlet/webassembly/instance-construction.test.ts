import { describe, expect, it } from 'vitest';

import { WasmInstanceImpl } from '../../../src/browlet/webassembly/index';
import { Browlet } from '../../../src/browlet/browlet';
import { getPlatformRecord, PlatformRecordSource } from '../../../src/web-idl/values/platform';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

// WebAssembly JavaScript API §5.2: synchronous Instance construction. The exports accessor is reviewed separately.
describe('WebAssembly Instance construction', () => {
  // SPEC_CLASH(wasm-instance-constructor-order): Chromium reads the prototype first; Firefox/WebKit follow Web IDL here.
  it('validates the Module and imports arguments before reading newTarget.prototype', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const module = new WebAssembly.Module(new Uint8Array(source));
      const results = [];
      for (const args of [[], [null], [{}, {}], [module, null], [module, 7]]) {
        let prototypeReads = 0;
        const target = new Proxy(function Target() {}, {
          get(target, key, receiver) {
            if (key === 'prototype') prototypeReads++;
            return Reflect.get(target, key, receiver) as unknown;
          },
        });
        let typeError = false;
        try { Reflect.construct(WebAssembly.Instance, args, target); }
        catch (error) { typeError = error instanceof TypeError; }
        results.push({ typeError, prototypeReads });
      }
      return results;
    }, emptyModule)).toEqual(Array.from({ length: 5 }, () => ({ typeError: true, prototypeReads: 0 })));
  });

  it('accepts optional imports and ignores arguments beyond the declared constructor', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const module = new WebAssembly.Module(new Uint8Array(source));
      const untouched = new Proxy({}, { get() { throw new Error('Extra argument was read'); } });
      const accepted = [undefined, {}, Object.create(null), () => {}].every((imports) =>
        Reflect.construct(WebAssembly.Instance, [module, imports, untouched]) instanceof WebAssembly.Instance);
      const rejected = [null, false, 1, 1n, '', Symbol()].every((imports) => {
        try { Reflect.construct(WebAssembly.Instance, [module, imports]); }
        catch (error) { return error instanceof TypeError; }
        return false;
      });
      let requiresNew = false;
      try { Reflect.apply(WebAssembly.Instance, undefined, [module]); }
      catch (error) { requiresNew = error instanceof TypeError; }
      return { accepted, rejected, requiresNew, length: WebAssembly.Instance.length, name: WebAssembly.Instance.name };
    }, emptyModule)).toEqual({ accepted: true, rejected: true, requiresNew: true, length: 1, name: 'Instance' });
  });

  it('recognizes a foreign Module with no prototype and rejects lookalikes without inspecting imports', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const module = new foreign.WebAssembly.Module(new Uint8Array(source));
      Object.setPrototypeOf(module, null);
      const instance = new WebAssembly.Instance(module);
      const imports = new Proxy({}, { get() { throw new Error('Invalid Module read the imports'); } });
      const invalid: unknown[] = [Object.create(WebAssembly.Module.prototype), new Proxy(module, {})];
      const rejected = invalid.every((value) => {
        try { Reflect.construct(foreign.WebAssembly.Instance, [value, imports]); }
        catch (error) { return error instanceof foreign.TypeError; }
        return false;
      });
      return { native: instance instanceof WebAssembly.Instance, rejected };
    }, emptyModule)).toEqual({ native: true, rejected: true });
  });

  it('selects the prototype before reading imports and runs start before returning', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const trace: string[] = [];
      const prototype = {};
      const target = new Proxy(function Target() {}, {
        get(target, key, receiver) {
          if (key === 'prototype') { trace.push('prototype'); return prototype; }
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
      const module = new WebAssembly.Module(new Uint8Array(source));
      const instance = Reflect.construct(WebAssembly.Instance, [module, {
        get env() {
          trace.push('env');
          return { get start() { trace.push('start import'); return () => { trace.push('start'); }; } };
        },
      }], target) as object;
      trace.push('returned');
      return { trace, prototype: Object.getPrototypeOf(instance) === prototype };
    }, startModule)).toEqual({ trace: ['prototype', 'env', 'start import', 'start', 'returned'], prototype: true });
  });

  it('reads repeated imports in declaration order and retains each captured value', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
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
      const instance = new WebAssembly.Instance(module, imports);
      trace.push('returned');
      value = 100;
      return { trace, values: [(instance.exports.first as () => number)(), (instance.exports.second as () => number)()] };
    }, repeatedImports)).toEqual({ trace: ['env', 'read', 'env', 'read', 'returned'], values: [1, 2] });
  });

  it('uses the builtin and string-import choices retained by the Module', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const options = { builtins: ['js-string'], importedStringConstants: 'strings' };
      const module = Reflect.construct(WebAssembly.Module, [new Uint8Array(source), options]);
      options.builtins.length = 0;
      options.importedStringConstants = 'changed';
      const imports = new Proxy({}, { get() { throw new Error('Builtin must bypass the supplied imports'); } });
      const { exports } = new WebAssembly.Instance(module, imports);
      const hello: unknown = (exports.hello as WebAssembly.Global).value;
      return { hello, length: (exports.length as (value: string) => number)('hello') };
    }, builtinModule)).toEqual({ hello: 'hello', length: 5 });
  });

  it.each(['import', 'start'])('preserves the original exception from %s code', async (phase) => {
    const browser = fixture();
    expect(await browser.evaluate(({ source, phase }) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const marker = new Error('author failure');
      const module = new WebAssembly.Module(new Uint8Array(source));
      try {
        new foreign.WebAssembly.Instance(module, {
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

  it('uses the invoked realm for linking and runtime errors', async () => {
    const browser = fixture();
    expect(await browser.evaluate(({ imported, trapping }) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const module = new WebAssembly.Module(new Uint8Array(imported));
      const results = [];
      for (const imports of [undefined, {}, { env: 1 }]) {
        try { Reflect.construct(foreign.WebAssembly.Instance, [module, imports]); results.push(false); }
        catch (error) { results.push(error instanceof foreign.TypeError); }
      }
      try { new foreign.WebAssembly.Instance(module, { env: { start: 1 } }); results.push(false); }
      catch (error) { results.push(error instanceof foreign.WebAssembly.LinkError); }
      try { new foreign.WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(trapping))); results.push(false); }
      catch (error) { results.push(error instanceof foreign.WebAssembly.RuntimeError); }
      return results;
    }, { imported: startModule, trapping: trapModule })).toEqual([true, true, true, true, true]);
  });

  it('preserves subclassing and a saved constructor after public replacement', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const Instance = WebAssembly.Instance;
      class Derived extends Instance { marker = 42; }
      const module = new WebAssembly.Module(new Uint8Array(source));
      Reflect.set(WebAssembly, 'Instance', function Replaced() { throw new Error('Replaced constructor'); });
      const instance = new Derived(module);
      return {
        own: instance instanceof Derived, native: instance instanceof Instance,
        constructor: instance.constructor === Derived, marker: instance.marker,
        usable: Object.keys(instance.exports),
      };
    }, emptyModule)).toEqual({ own: true, native: true, constructor: true, marker: 42, usable: [] });
  });

  it('records construction ownership before a foreign prototype can disguise it', async () => {
    const browser = fixture();
    const foreignRealm = getRelevantRealm(Reflect.get(browser.window, 'foreign') as object);
    await browser.evaluate((source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const module = new WebAssembly.Module(new Uint8Array(source));
      const instance = Reflect.construct(foreign.WebAssembly.Instance, [module], WebAssembly.Instance);
      Reflect.set(globalThis, 'nativeInstance', Object.freeze(instance));
    }, emptyModule);
    const instance = Reflect.get(browser.window, 'nativeInstance') as object;
    const record = getPlatformRecord(instance, PlatformRecordSource.Platform);
    expect(record).toBeDefined();
    expect(record).toBe(getPlatformRecord(record!.implInst, PlatformRecordSource.Implementation));
    expect(getPlatformRecord(instance, PlatformRecordSource.Implementation)).toBeUndefined();
    expect(record!.implInst).toBeInstanceOf(WasmInstanceImpl);
    expect(record!.implInst).not.toBe(instance);
    expect(record!.platformObject).toBe(instance);
    expect(record!.realm).toBe(foreignRealm);
    expect(record!.project()).toBe(instance);
    expect(Reflect.ownKeys(instance)).toEqual([]);
  });
});

function fixture(): Browlet {
  const browser = new Browlet({ route: () => '', reporting: false });
  Reflect.set(browser.window, 'foreign', createSiblingWindow(browser));
  return browser;
}

// (module)
const emptyModule = [0, 97, 115, 109, 1, 0, 0, 0];
// (module (import "env" "start" (func)) (start 0))
const startModule = [
  ...emptyModule, 1, 4, 1, 96, 0, 0,
  2, 13, 1, 3, 101, 110, 118, 5, 115, 116, 97, 114, 116, 0, 0, 8, 1, 0,
];
// (module (func unreachable) (start 0))
const trapModule = [...emptyModule, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 8, 1, 0, 10, 5, 1, 3, 0, 0, 11];
// (module (import "env" "read" (func (result i32))) (import "env" "read" (func (result i32)))
//         (export "first" (func 0)) (export "second" (func 1)))
const repeatedImports = [
  ...emptyModule, 1, 5, 1, 96, 0, 1, 127,
  2, 23, 2, 3, 101, 110, 118, 4, 114, 101, 97, 100, 0, 0,
  3, 101, 110, 118, 4, 114, 101, 97, 100, 0, 0,
  7, 18, 2, 5, 102, 105, 114, 115, 116, 0, 0, 6, 115, 101, 99, 111, 110, 100, 0, 1,
];
// (module (import "strings" "hello" (global externref))
//         (import "wasm:js-string" "length" (func (param externref) (result i32)))
//         (export "hello" (global 0)) (export "length" (func 0)))
const builtinModule = [
  ...emptyModule, 1, 6, 1, 96, 1, 111, 1, 127,
  2, 42, 2, 7, 115, 116, 114, 105, 110, 103, 115, 5, 104, 101, 108, 108, 111, 3, 111, 0,
  14, 119, 97, 115, 109, 58, 106, 115, 45, 115, 116, 114, 105, 110, 103, 6, 108, 101, 110, 103, 116, 104, 0, 0,
  7, 18, 2, 5, 104, 101, 108, 108, 111, 3, 0, 6, 108, 101, 110, 103, 116, 104, 0, 0,
];
