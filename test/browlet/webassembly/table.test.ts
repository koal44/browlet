/* eslint-disable @typescript-eslint/unbound-method -- These tests borrow native methods with explicit receivers. */
import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { isWebAssemblyTable } from '../../../src/js-engine/index';
import { getPlatformRecord, PlatformRecordSource } from '../../../src/web-idl/values/platform';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

// WebAssembly JavaScript API §5.4: construction, reference identity, and table access/growth.
describe('WebAssembly Table', () => {
  it('converts descriptor members before prototype lookup and numeric sizes', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const trace: string[] = [];
      const descriptor = {
        get address() { trace.push('address'); return 'i32'; },
        get element() { trace.push('element'); return { toString() { trace.push('element conversion'); return 'externref'; } }; },
        get initial() { trace.push('initial'); return { valueOf() { trace.push('initial conversion'); return 0; } }; },
        get maximum() { trace.push('maximum'); return { valueOf() { trace.push('maximum conversion'); return 2; } }; },
      };
      const target = new Proxy(function Target() {}, {
        get(target, key, receiver) {
          if (key === 'prototype') trace.push('prototype');
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
      Reflect.construct(WebAssembly.Table, [descriptor], target);
      return trace;
    })).toEqual(['address', 'element', 'element conversion', 'initial', 'maximum', 'prototype', 'initial conversion', 'maximum conversion']);
  });

  it('rejects missing required members and invalid enums before prototype lookup', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const cases = [undefined, null, {}, { element: 'externref' }, { initial: 0 },
        { element: 'bad', initial: 0 }, { element: 'externref', initial: 0, address: 'bad' }];
      return cases.map((descriptor) => {
        let reads = 0;
        const target = new Proxy(function Target() {}, {
          get(target, key, receiver) {
            if (key === 'prototype') reads++;
            return Reflect.get(target, key, receiver) as unknown;
          },
        });
        try { Reflect.construct(WebAssembly.Table, [descriptor], target); }
        catch (error) { return [error instanceof TypeError, reads]; }
        return [false, reads];
      });
    })).toEqual(Array.from({ length: 7 }, () => [true, 0]));
  });

  it('preserves author exceptions and uses the constructor realm for allocation errors', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const marker = new Error('author descriptor');
      let same = false;
      try { new foreign.WebAssembly.Table({ element: 'externref', get initial(): never { throw marker; } }); }
      catch (error) { same = error === marker; }
      const cases = [[{ element: 'externref', initial: -1 }, foreign.TypeError],
        [{ element: 'externref', initial: 2, maximum: 1 }, foreign.RangeError]] as const;
      return {
        same, errors: cases.map(([descriptor, ErrorType]) => {
          try { new foreign.WebAssembly.Table(descriptor); }
          catch (error) { return error instanceof ErrorType; }
          return false;
        }),
      };
    })).toEqual({ same: true, errors: [true, true] });
  });

  it('retains subclassing, captured construction, and exact ownership with a foreign prototype', async () => {
    const browser = fixture();
    const foreignRealm = getRelevantRealm(Reflect.get(browser.window, 'foreign') as object);
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const Table = foreign.WebAssembly.Table;
      class Derived extends Table {}
      Reflect.set(foreign.WebAssembly, 'Table', function Replaced() { throw new Error('replacement'); });
      const derived = new Derived({ element: 'externref', initial: 1 }, document);
      const table = Reflect.construct(Table, [{ element: 'externref', initial: 0 }], WebAssembly.Table);
      Reflect.set(globalThis, 'nativeTable', Object.freeze(table));
      return derived instanceof Derived && derived.get(0) === document;
    })).toBe(true);
    const table = Reflect.get(browser.window, 'nativeTable') as object;
    const record = getPlatformRecord(table, PlatformRecordSource.Platform);
    expect(record).toBeDefined();
    expect(record!.realm).toBe(foreignRealm);
    expect(record!.implInst).toBe(table);
    expect(record!.platformObject).toBe(table);
    expect(Reflect.ownKeys(table)).toEqual([]);
  });

  it('validates a function-table initializer even when the initial size is zero', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const Table = foreign.WebAssembly.Table;
      Object.defineProperty(Table.prototype, 'length', { get() { throw new Error('replaced length'); } });
      Table.prototype.grow = () => { throw new Error('replaced grow'); };
      const descriptors = [{ element: 'anyfunc', initial: 0, maximum: 0 },
        { element: 'anyfunc', address: 'i64', initial: 0n, maximum: 0n }];
      return descriptors.flatMap((descriptor) => [42, {}, () => 1, new Proxy(() => 1, {})].map((value) => {
        try { Reflect.construct(Table, [descriptor, value]); }
        catch (error) { return error instanceof foreign.TypeError; }
        return false;
      }));
    })).toEqual(Array.from({ length: 8 }, () => true));
  });

  it('keeps externref values by identity across construction, get, set, and growth', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const values = [undefined, null, -0, NaN, 1n, Symbol('value'), {}, () => 1, document];
      return values.every((value) => {
        const table = new WebAssembly.Table({ element: 'externref', initial: 1, maximum: 2 }, value);
        const initial: unknown = table.get(0);
        const previous = table.grow(1, value);
        table.set(0, value);
        return Object.is(initial, value) && Object.is(table.get(0), value) && Object.is(table.get(1), value) && previous === 1;
      });
    })).toBe(true);
  });

  it('recognizes native tables without reading author properties or changing entries', async () => {
    const browser = fixture();
    await browser.evaluate(() => {
      const table = new WebAssembly.Table({ element: 'externref', initial: 1 }, document);
      Object.defineProperty(table, 'length', { get() { throw new Error('author length'); } });
      Object.setPrototypeOf(table, null);
      Reflect.set(globalThis, 'nativeTable', Object.freeze(table));
    });
    const table = Reflect.get(browser.window, 'nativeTable') as object;
    expect(isWebAssemblyTable(table)).toBe(true);
    expect(isWebAssemblyTable(new WebAssembly.Table({ element: 'externref', initial: 0 }))).toBe(true);
    for (const value of [null, undefined, 42, {}, Object.create(table), new Proxy(table, {})]) {
      expect(isWebAssemblyTable(value)).toBe(false);
    }
    expect(await browser.evaluate(() => {
      const table = Reflect.get(globalThis, 'nativeTable') as object;
      return Reflect.apply(WebAssembly.Table.prototype.get, table, [0]) === document;
    })).toBe(true);
  });

  it('uses default values and preserves existing entries when growth fails', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const functions = new WebAssembly.Table({ element: 'anyfunc', initial: 1, maximum: 2 });
      const refs = new WebAssembly.Table({ element: 'externref', initial: 1, maximum: 2 }, document);
      const sizes = [functions.grow(0), functions.grow(1), refs.grow(1)];
      refs.set(0);
      let failed = false;
      try { functions.grow(1); } catch (error) { failed = error instanceof RangeError; }
      return { sizes, defaults: [functions.get(0), functions.get(1), refs.get(0), refs.get(1)], failed, length: functions.length };
    })).toEqual({ sizes: [1, 1, 1], defaults: [null, null, undefined, undefined], failed: true, length: 2 });
  });

  it('accepts native Wasm functions and preserves their cached identity across realms and aliases', async () => {
    const browser = fixture();
    expect(await browser.evaluate(({ source, aliases }) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const fn = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source))).exports.value;
      const table = new WebAssembly.Table({ element: 'anyfunc', initial: 1, maximum: 3 }, fn);
      table.grow(1, fn);
      const empty = new WebAssembly.Table({ element: 'anyfunc', initial: 0, maximum: 0 }, fn);
      const alias = new foreign.WebAssembly.Instance(new foreign.WebAssembly.Module(new Uint8Array(aliases)), { env: { table } });
      const other = alias.exports.table as WebAssembly.Table;
      const read = other.get(0) as () => number;
      return { same: other === table && read === fn && table.get(1) === fn, value: read(), empty: empty.length };
    }, { source: functionBytes, aliases: aliasBytes })).toEqual({ same: true, value: 42, empty: 0 });
  });

  it('uses BigInt lengths, indices, and growth for i64 tables', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      // lib.dom still types table indices as numbers; the native i64 API uses BigInt.
      const table = Reflect.construct(WebAssembly.Table, [{ address: 'i64', element: 'externref', initial: 1n, maximum: 2n }]) as WebAssembly.Table;
      Reflect.apply(table.set, table, [0n, document]);
      const old: unknown = Reflect.apply(table.grow, table, [1n, document]);
      let wrongKind = false;
      try { table.get(0); } catch (error) { wrongKind = error instanceof TypeError; }
      return {
        old: String(old), length: String(table.length), kind: typeof table.length,
        value: Reflect.apply(table.get, table, [1n]) === document, wrongKind,
      };
    })).toEqual({ old: '1', length: '2', kind: 'bigint', value: true, wrongKind: true });
  });

  it('retains native receiver checks, foreign methods, and out-of-range errors', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const table = new WebAssembly.Table({ element: 'externref', initial: 1 }, document);
      const get = foreign.WebAssembly.Table.prototype.get;
      Object.setPrototypeOf(table, null);
      const value = Reflect.apply(get, table, [0]) === document;
      const rejected = [{}, Object.create(foreign.WebAssembly.Table.prototype), new Proxy(table, {})].every((receiver) => {
        try { Reflect.apply(get, receiver, [0]); } catch (error) { return error instanceof foreign.TypeError; }
        return false;
      });
      let range = false;
      try { Reflect.apply(get, table, [1]); } catch (error) { range = error instanceof foreign.RangeError; }
      return { value, rejected, range };
    })).toEqual({ value: true, rejected: true, range: true });
  });

  it('reflects Wasm table.grow in the same JavaScript table and preserves entries on failure', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const table = new WebAssembly.Table({ element: 'externref', initial: 1, maximum: 3 });
      const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(bytes)), { env: { table } });
      const grow = instance.exports.grow as (value: unknown, delta: number) => number;
      const previous = grow(document, 2);
      const failed = grow(null, 1);
      return { previous, failed, length: table.length, values: table.get(1) === document && table.get(2) === document };
    }, growBytes)).toEqual({ previous: 1, failed: -1, length: 3, values: true });
  });

  // SPEC_CLASH(wasm-table-undefined-value): All three browsers treat explicit undefined as a supplied value, unlike Web IDL.
  it.each(['grow', 'set'] as const)('rejects explicit undefined for a function-table %s value, matching browsers', async (operation) => {
    const browser = fixture();
    expect(await browser.evaluate((operation) => {
      const table = new WebAssembly.Table({ element: 'anyfunc', initial: 1 });
      try {
        table[operation](operation === 'grow' ? 1 : 0, undefined);
        return table.get(operation === 'grow' ? 1 : 0) as unknown;
      } catch (error) { return (error as Error).name; }
    }, operation)).toBe('TypeError');
  });

  // SPEC_CLASH(wasm-table-set-error-order): All three browsers check bounds before reference conversion; the draft reverses them.
  it('reports an out-of-range set index before an invalid value, matching browsers', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const table = new WebAssembly.Table({ element: 'anyfunc', initial: 0 });
      try { table.set(0, 42); } catch (error) { return (error as Error).name; }
      return 'no error';
    })).toBe('RangeError');
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

// (module (import "env" "table" (table 1 3 funcref)) (export "table" (table 0)))
const aliasBytes = [0, 97, 115, 109, 1, 0, 0, 0, 2, 16, 1, 3, 101, 110, 118, 5, 116, 97, 98, 108, 101,
  1, 112, 1, 1, 3, 7, 9, 1, 5, 116, 97, 98, 108, 101, 1, 0];

// (module (import "env" "table" (table 1 3 externref))
//   (func (export "grow") (param externref i32) (result i32) (table.grow 0 (local.get 0) (local.get 1))))
const growBytes = [0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 111, 127, 1, 127,
  2, 16, 1, 3, 101, 110, 118, 5, 116, 97, 98, 108, 101, 1, 111, 1, 1, 3,
  3, 2, 1, 0, 7, 8, 1, 4, 103, 114, 111, 119, 0, 0, 10, 11, 1, 9, 0, 32, 0, 32, 1, 252, 15, 0, 11];
