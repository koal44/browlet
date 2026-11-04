/* eslint-disable @typescript-eslint/unbound-method -- These tests borrow native accessors and methods with explicit receivers. */
import { describe, expect, it } from 'vitest';

import { WasmGlobalImpl } from '../../../src/browlet/webassembly/index';
import { Browlet } from '../../../src/browlet/browlet';
import { reference } from '../../../src/web-idl/core/index';
import { getPlatformRecord, PlatformRecordSource } from '../../../src/web-idl/values/platform';
import { getBindingContext, getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

// WebAssembly JavaScript API §5.5. Binding owns constructor conversion and identity;
// native accessors retain the engine's typed storage and object cache.
describe('WebAssembly Global', () => {
  // SPEC_CLASH(wasm-global-construction-order): V8 reads the prototype before dictionary conversion.
  it('converts the descriptor before prototype lookup and the initial value', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const trace: string[] = [];
      const descriptor = {
        get mutable() { trace.push('mutable'); return false; },
        get value() { trace.push('value'); return { toString() { trace.push('value conversion'); return 'i32'; } }; },
      };
      const value = { valueOf() { trace.push('initial conversion'); return 7; } };
      const target = new Proxy(function Target() {}, {
        get(target, key, receiver) {
          if (key === 'prototype') trace.push('prototype');
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
      Reflect.construct(WebAssembly.Global, [descriptor, value], target);
      return trace;
    })).toEqual(['mutable', 'value', 'value conversion', 'prototype', 'initial conversion']);
  });

  // SPEC_CLASH(wasm-global-value-types): V8 also accepts GC reference names outside the draft's ValueType enum.
  it('rejects missing required members and invalid value types before prototype lookup', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const cases = [undefined, null, {}, { value: undefined }, { value: 'bad' }, { value: 'anyref' }];
      return cases.map((descriptor) => {
        let reads = 0;
        const target = new Proxy(function Target() {}, {
          get(target, key, receiver) {
            if (key === 'prototype') reads++;
            return Reflect.get(target, key, receiver) as unknown;
          },
        });
        try { Reflect.construct(WebAssembly.Global, [descriptor], target); }
        catch (error) { return [error instanceof TypeError, reads]; }
        return [false, reads];
      });
    })).toEqual(Array.from({ length: 6 }, () => [true, 0]));
  });

  // SPEC_CLASH(wasm-global-undefined-initializer): Chromium and Firefox reject this; Web IDL and WebKit use the default.
  it('treats an explicit undefined optional function initializer as missing', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      try { return new WebAssembly.Global({ value: 'anyfunc' }, undefined).value; }
      catch (error) { return (error as Error).name; }
    })).toBe(null);
  });

  it('supplies the type-specific defaults and rejects JavaScript construction of vector globals', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const values = ['i32', 'i64', 'f32', 'f64', 'externref', 'anyfunc'].map((value) =>
        (Reflect.construct(WebAssembly.Global, [{ value }]) as WebAssembly.Global).value as unknown);
      let converted = false;
      let rejected = false;
      try {
        Reflect.construct(WebAssembly.Global, [{ value: 'v128' }, { valueOf() { converted = true; return 0; } }]);
      } catch (error) { rejected = error instanceof TypeError; }
      return { values, rejected, converted };
    })).toEqual({ values: [0, 0n, 0, 0, undefined, null], rejected: true, converted: false });
  });

  it('converts numeric initializers and assignments using the declared Wasm type', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const i32 = new WebAssembly.Global({ value: 'i32', mutable: true }, 2 ** 32 + 3);
      const i64 = new WebAssembly.Global({ value: 'i64', mutable: true }, 2n ** 64n + 5n);
      const f32 = new WebAssembly.Global({ value: 'f32', mutable: true }, 1 / 3);
      const f64 = new WebAssembly.Global({ value: 'f64', mutable: true }, -0);
      const initial = [i32.value, String(i64.value), f32.value === Math.fround(1 / 3), Object.is(f64.value, -0)];
      i32.value = -3.75;
      i64.value = -1n;
      f32.value = Infinity;
      f64.value = NaN;
      return { initial, changed: [i32.valueOf(), String(i64.valueOf()), f32.valueOf() === Infinity, Number.isNaN(f64.valueOf())] };
    })).toEqual({ initial: [3, '5', true, true], changed: [-3, '-1', true, true] });
  });

  it('rejects writes to immutable globals before converting the supplied value', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const global = new WebAssembly.Global({ value: 'i32' }, 4);
      let conversions = 0;
      let rejected = false;
      try { Reflect.set(global, 'value', { valueOf() { conversions++; return 9; } }); }
      catch (error) { rejected = error instanceof TypeError; }
      return { rejected, conversions, value: global.value };
    })).toEqual({ rejected: true, conversions: 0, value: 4 });
  });

  it('preserves numeric storage when conversion fails and propagates author exceptions unchanged', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const marker = new Error('conversion');
      const global = new WebAssembly.Global({ value: 'i64', mutable: true }, 4n);
      let same = false;
      try { Reflect.set(global, 'value', { [Symbol.toPrimitive]() { throw marker; } }); }
      catch (error) { same = error === marker; }
      let rejected = false;
      try { Reflect.set(global, 'value', 5); }
      catch (error) { rejected = error instanceof TypeError; }
      return { same, rejected, value: String(global.value) };
    })).toEqual({ same: true, rejected: true, value: '4' });
  });

  it('keeps externref values by identity without converting objects or platform objects', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const values = [undefined, null, -0, NaN, 1n, Symbol('value'), {}, () => 1, document, foreign.document,
        { [Symbol.toPrimitive]() { throw new Error('must not convert'); } }];
      return values.every((value) => {
        const global = new WebAssembly.Global({ value: 'externref', mutable: true }, value);
        const initial: unknown = global.value;
        global.value = null;
        global.value = value;
        return Object.is(initial, value) && Object.is(global.valueOf(), value);
      });
    })).toBe(true);
  });

  it('preserves Wasm function identities and rejects incompatible function values without mutation', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const fn = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(bytes))).exports.value as () => number;
      const global = new WebAssembly.Global({ value: 'anyfunc', mutable: true }, fn);
      const same = global.value === fn && global.valueOf() === fn;
      const rejected = [undefined, 42, {}, () => 1, new Proxy(fn, {})].every((value) => {
        try { Reflect.set(global, 'value', value); }
        catch (error) { return error instanceof TypeError && global.value === fn; }
        return false;
      });
      Reflect.set(global, 'value', null);
      return { same, rejected, cleared: Object.is(global.value, null) };
    }, functionBytes)).toEqual({ same: true, rejected: true, cleared: true });
  });

  it('retains subclassing and uses the invoked constructor realm for native errors', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      class Derived extends foreign.WebAssembly.Global {}
      const global = new Derived({ value: 'externref', mutable: true }, document);
      let rejected = false;
      try { Reflect.construct(foreign.WebAssembly.Global, [{ value: 'i64' }, 1]); }
      catch (error) { rejected = error instanceof foreign.TypeError; }
      const marker = new Error('descriptor');
      let same = false;
      try { new foreign.WebAssembly.Global({ get value(): never { throw marker; } }); }
      catch (error) { same = error === marker; }
      return { subclass: global instanceof Derived, value: global.value === document, rejected, same };
    })).toEqual({ subclass: true, value: true, rejected: true, same: true });
  });

  it('retains captured construction and records its realm before applying a foreign prototype', async () => {
    const browser = fixture();
    const foreignRealm = getRelevantRealm(Reflect.get(browser.window, 'foreign') as object);
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const Global = foreign.WebAssembly.Global;
      Reflect.set(foreign.WebAssembly, 'Global', () => { throw new Error('Replaced constructor'); });
      const global = Reflect.construct(Global, [{ value: 'externref' }, document], WebAssembly.Global);
      Reflect.set(globalThis, 'nativeGlobal', Object.freeze(global));
      return {
        value: global.value === document, prototype: Object.getPrototypeOf(global) === WebAssembly.Global.prototype,
        constructor: Global.prototype.constructor === Global, name: Global.name, length: Global.length,
        namespaceOnly: !('Global' in globalThis),
      };
    })).toEqual({ value: true, prototype: true, constructor: true, name: 'Global', length: 1, namespaceOnly: true });
    const global = Reflect.get(browser.window, 'nativeGlobal') as object;
    const record = getPlatformRecord(global, PlatformRecordSource.Platform);
    expect(record).toBeDefined();
    expect(record!.realm).toBe(foreignRealm);
    expect(record!.implInst).toBeInstanceOf(WasmGlobalImpl);
    expect(record!.implInst).not.toBe(global);
    expect(record!.platformObject).toBe(global);
    expect(Reflect.ownKeys(global)).toEqual([]);
  });

  it.each([false, true])('recognizes a frozen exported vector Global (mutable: %s) without reading its value', async (mutable) => {
    const browser = fixture();
    const context = getBindingContext(getRelevantRealm(browser.window));
    const foreignRealm = getRelevantRealm(Reflect.get(browser.window, 'foreign') as object);
    await browser.evaluate(({ bytes, mutable }) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const source = new Uint8Array(bytes);
      source[12] = Number(mutable);
      const global = new foreign.WebAssembly.Instance(new foreign.WebAssembly.Module(source)).exports.g;
      Object.setPrototypeOf(global, null);
      Reflect.set(globalThis, 'nativeGlobal', Object.freeze(global));
    }, { bytes: vectorBytes, mutable });
    const global = Reflect.get(browser.window, 'nativeGlobal') as object;
    const implementation = getPlatformRecord(global, PlatformRecordSource.Platform)!.implInst;
    expect(implementation).toBeInstanceOf(WasmGlobalImpl);
    expect(context.jsToImpl(global, reference('Global'))).toBe(implementation);
    expect(context.implToJS(implementation, reference('Global'))).toBe(global);
    const record = context.getPlatformRecord(global, PlatformRecordSource.Platform);
    expect(record!.realm).toBe(foreignRealm);
    expect(record!.platformObject).toBe(global);
    expect(Object.getPrototypeOf(global)).toBeNull();
    expect(Reflect.ownKeys(global)).toEqual([]);
  });

  it('rejects raw Node Globals and forged values without running traps', () => {
    const browser = fixture();
    const context = getBindingContext(getRelevantRealm(browser.window));
    const global = Object.freeze(new WebAssembly.Global({ value: 'externref' }, {}));
    expect(() => context.jsToImpl(global, reference('Global'))).toThrow('Global');
    expect(() => context.implToJS(global, reference('Global'))).toThrow();
    expect(context.getPlatformRecord(global, PlatformRecordSource.Platform)).toBeUndefined();
    const fail = (): never => { throw new Error('Author code ran'); };
    const proxy = new Proxy(global, { get: fail, getPrototypeOf: fail });
    const revoked = Proxy.revocable(global, {});
    revoked.revoke();
    for (const value of [Object.create(WebAssembly.Global.prototype), proxy, revoked.proxy]) {
      expect(context.getPlatformRecord(value, PlatformRecordSource.Platform)).toBeUndefined();
      expect(() => context.jsToImpl(value, reference('Global'))).toThrow('Global');
    }
  });

  it('accepts foreign native receivers and rejects forged objects and proxies', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const global = new WebAssembly.Global({ value: 'i32', mutable: true }, 3);
      const accessors = Object.getOwnPropertyDescriptor(foreign.WebAssembly.Global.prototype, 'value')!;
      Object.setPrototypeOf(global, null);
      Reflect.apply(accessors.set!, global, [7]);
      const value: unknown = Reflect.apply(accessors.get!, global, []);
      const rejected = [{}, Object.create(foreign.WebAssembly.Global.prototype), new Proxy(global, {})].every((receiver) => {
        try { Reflect.apply(foreign.WebAssembly.Global.prototype.valueOf, receiver, []); }
        catch (error) { return error instanceof foreign.TypeError; }
        return false;
      });
      return { value, rejected };
    })).toEqual({ value: 7, rejected: true });
  });

  it('keeps imported and re-exported mutable globals live across JavaScript, Wasm, and realms', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const global = new WebAssembly.Global({ value: 'i32', mutable: true }, 3);
      const module = new foreign.WebAssembly.Module(new Uint8Array(bytes));
      const first = new foreign.WebAssembly.Instance(module, { env: { g: global } }).exports;
      const second = new foreign.WebAssembly.Instance(module, { env: { g: global } }).exports;
      global.value = 7;
      const before = (first.read as () => number)();
      (second.write as (value: number) => void)(11);
      return { same: first.g === global && second.g === global, before, after: global.value };
    }, aliasBytes)).toEqual({ same: true, before: 7, after: 11 });
  });

  it('allows exported vector globals to exist while rejecting their JavaScript value access', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => [false, true].every((mutable) => {
      const source = new Uint8Array(bytes);
      source[12] = Number(mutable);
      const global = new WebAssembly.Instance(new WebAssembly.Module(source)).exports.g as WebAssembly.Global;
      const accessors = Object.getOwnPropertyDescriptor(WebAssembly.Global.prototype, 'value')!;
      const operations = [() => Reflect.apply(accessors.get!, global, []) as unknown, () => global.valueOf() as unknown,
        () => Reflect.apply(accessors.set!, global, [0]) as unknown];
      return Object.getPrototypeOf(global) === WebAssembly.Global.prototype && operations.every((operation) => {
        try { operation(); } catch (error) { return error instanceof TypeError; }
        return false;
      });
    }), vectorBytes)).toBe(true);
  });

  it('materializes a previously unexposed function in the first value getter realm', async () => {
    const browser = fixture();
    const context = getBindingContext(getRelevantRealm(browser.window));
    Reflect.set(browser.window, 'inspectGlobal', (global: object) => {
      const implementation = getPlatformRecord(global, PlatformRecordSource.Platform)!.implInst;
      expect(context.jsToImpl(global, reference('Global'))).toBe(implementation);
      expect(context.implToJS(implementation, reference('Global'))).toBe(global);
      context.getPlatformRecord(global, PlatformRecordSource.Platform);
    });
    expect(await browser.evaluate((bytes) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const module = new foreign.WebAssembly.Module(new Uint8Array(bytes));
      const ownGetter = Object.getOwnPropertyDescriptor(WebAssembly.Global.prototype, 'value')!.get!;
      const foreignGetter = Object.getOwnPropertyDescriptor(foreign.WebAssembly.Global.prototype, 'value')!.get!;
      const read = (getter: () => unknown, expectedPrototype: object) => {
        const global = new foreign.WebAssembly.Instance(module).exports.g;
        const inspect = Reflect.get(globalThis, 'inspectGlobal') as (global: unknown) => void;
        inspect(global);
        // Prior recognition must not choose the function's realm before this first author read.
        const fn = Reflect.apply(getter, global, []) as () => number;
        return Object.getPrototypeOf(fn) === expectedPrototype && fn() === 42 &&
          Reflect.apply(ownGetter, global, []) === fn && Reflect.apply(foreignGetter, global, []) === fn;
      };
      return [read(ownGetter, Function.prototype), read(foreignGetter, foreign.Function.prototype)];
    }, functionGlobalBytes)).toEqual([true, true]);
  });
});

function fixture(): Browlet {
  const browser = new Browlet({ route: () => '', reporting: false });
  Reflect.set(browser.window, 'foreign', createSiblingWindow(browser));
  return browser;
}

// (module (func (export "value") (result i32) (i32.const 42)))
const functionBytes = [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0,
  7, 9, 1, 5, 118, 97, 108, 117, 101, 0, 0, 10, 6, 1, 4, 0, 65, 42, 11];

// (module (import "env" "g" (global (mut i32))) (export "g" (global 0))
//   (func (export "read") (result i32) (global.get 0))
//   (func (export "write") (param i32) (global.set 0 (local.get 0))))
const aliasBytes = [0, 97, 115, 109, 1, 0, 0, 0, 1, 9, 2, 96, 0, 1, 127, 96, 1, 127, 0,
  2, 10, 1, 3, 101, 110, 118, 1, 103, 3, 127, 1, 3, 3, 2, 0, 1,
  7, 20, 3, 1, 103, 3, 0, 4, 114, 101, 97, 100, 0, 0, 5, 119, 114, 105, 116, 101, 0, 1,
  10, 13, 2, 4, 0, 35, 0, 11, 6, 0, 32, 0, 36, 0, 11];

// (module (global (export "g") v128 (v128.const i32x4 0 0 0 0)))
// The vector test changes the mutability byte to cover both global forms.
const vectorBytes = [0, 97, 115, 109, 1, 0, 0, 0, 6, 22, 1, 123, 0, 253, 12,
  ...Array<number>(16).fill(0), 11, 7, 5, 1, 1, 103, 3, 0];

// (module (func (result i32) (i32.const 42)) (global (export "g") funcref (ref.func 0)))
// The function has no separate export; its first JS wrapper is created by reading the global.
const functionGlobalBytes = [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0,
  6, 6, 1, 112, 0, 210, 0, 11, 7, 5, 1, 1, 103, 3, 0, 10, 6, 1, 4, 0, 65, 42, 11];
