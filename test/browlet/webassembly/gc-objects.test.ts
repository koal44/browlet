import { describe, expect, it } from 'vitest';
import { itPassesWith } from '../../test-runtime';

import { Browlet } from '../../../src/browlet/browlet';
import { createSiblingWindow } from '../../support/windows';

// WebAssembly JavaScript API §5.8: these opaque objects and their identities belong to V8.
describe.each(['makeStruct', 'makeArray'] as const)('WebAssembly GC object: %s', (make) => {
  it('has a null prototype and is not extensible', async () => {
    const browser = await fixture();
    expect(await browser.evaluate((make) => {
      const value = (Reflect.get(globalThis, 'gcExports') as GCExports)[make](7);
      return {
        prototype: Reflect.getPrototypeOf(value), extensible: Reflect.isExtensible(value),
        frozen: Object.isFrozen(value), sealed: Object.isSealed(value),
        kind: typeof value, description: Object.prototype.toString.call(value),
      };
    }, make)).toEqual({
      prototype: null, extensible: false,
      frozen: true, sealed: true, kind: 'object', description: '[object Object]',
    });
  });

  // SPEC_CLASH(wasm-gc-reflection): Node 24's older V8 throws; newer builds return the required false.
  // Eric approved expected failures on Node 24 only; newer engines run the ordinary assertion.
  itPassesWith('v26+')('returns false from reflective prototype changes, even for null', async () => {
    const browser = await fixture();
    expect(await browser.evaluate((make) => {
      const value = (Reflect.get(globalThis, 'gcExports') as GCExports)[make](7);
      return [Reflect.setPrototypeOf(value, {}), Reflect.setPrototypeOf(value, null)];
    }, make)).toEqual([false, false]);
  });

  it('exposes no fields, indices, length, symbols or inherited properties', async () => {
    const browser = await fixture();
    expect(await browser.evaluate((make) => {
      const value = (Reflect.get(globalThis, 'gcExports') as GCExports)[make](7);
      const keys = ['0', 'length', 'constructor', '__proto__', Symbol.iterator, Symbol.toStringTag];
      return {
        keys: Reflect.ownKeys(value), descriptors: Object.getOwnPropertyDescriptors(value),
        absent: keys.every((key) => Reflect.get(value, key) === undefined && !Reflect.has(value, key) &&
          Reflect.getOwnPropertyDescriptor(value, key) === undefined),
        inherited: Reflect.get(Object.create(value) as object, '0') === undefined,
      };
    }, make)).toEqual({ keys: [], descriptors: {}, absent: true, inherited: true });
  });

  // SPEC_CLASH(wasm-gc-reflection): Follow Chromium/WebKit's TypeError; the draft and Firefox return false.
  // This is accepted compatibility behavior, so the regression asserts it normally.
  it('rejects reflective extension prevention with TypeError, matching Chromium', async () => {
    const browser = await fixture();
    expect(await browser.evaluate((make) => {
      const value = (Reflect.get(globalThis, 'gcExports') as GCExports)[make](7);
      try { Reflect.preventExtensions(value); }
      catch (error) { return error instanceof TypeError; }
      return false;
    }, make)).toBe(true);
  });

  // SPEC_CLASH(wasm-gc-reflection): Follow Chromium's TypeError; the draft, Firefox and WebKit return false.
  // This is accepted compatibility behavior, so the regression asserts it normally.
  it('rejects reflective property definition with TypeError, matching Chromium', async () => {
    const browser = await fixture();
    expect(await browser.evaluate((make) => {
      const value = (Reflect.get(globalThis, 'gcExports') as GCExports)[make](7);
      try { Reflect.defineProperty(value, 'field', { value: 1 }); }
      catch (error) { return error instanceof TypeError; }
      return false;
    }, make)).toBe(true);
  });

  it('throws on assignment and deletion, including absent properties', async () => {
    const browser = await fixture();
    expect(await browser.evaluate((make) => {
      const value = (Reflect.get(globalThis, 'gcExports') as GCExports)[make](7);
      return ['0', 'absent', Symbol('field')].every((key) => [
        () => Reflect.set(value, key, 1), () => Reflect.deleteProperty(value, key),
      ].every((operation) => {
        try { operation(); } catch (error) { return error instanceof TypeError; }
        return false;
      }));
    }, make)).toBe(true);
  });

  it('rejects Object mutation operations but remains usable as a collection key', async () => {
    const browser = await fixture();
    expect(await browser.evaluate((make) => {
      const value = (Reflect.get(globalThis, 'gcExports') as GCExports)[make](7);
      const rejected = [
        () => Object.freeze(value), () => Object.seal(value), () => Object.preventExtensions(value),
        () => Object.setPrototypeOf(value, null) as unknown, () => Object.defineProperty(value, 'x', { value: 1 }),
      ].every((operation) => {
        try { operation(); } catch (error) { return error instanceof TypeError; }
        return false;
      });
      return { rejected, retained: new WeakMap([[value, 7]]).get(value), included: new Set([value]).has(value) };
    }, make)).toEqual({ rejected: true, retained: 7, included: true });
  });

  it('uses the invoking realm for reflection errors on foreign objects', async () => {
    const browser = await fixture();
    expect(await browser.evaluate((make) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const value = (Reflect.get(foreign, 'gcExports') as GCExports)[make](7);
      try { Reflect.set(value, 'x', 1); }
      catch (error) { return { local: error instanceof TypeError, foreign: error instanceof foreign.TypeError }; }
      return null;
    }, make)).toEqual({ local: true, foreign: false });
  });
});

describe('WebAssembly GC reference conversion and caches', () => {
  it('retains identity through calls, globals, tables and other same-Agent realms', async () => {
    const browser = await fixture();
    expect(await browser.evaluate(() => {
      const gc = Reflect.get(globalThis, 'gcExports') as GCExports;
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const other = Reflect.get(foreign, 'gcExports') as GCExports;
      const struct = gc.makeStruct(7), array = gc.makeArray(9);
      other.heldStruct.value = struct;
      other.heldArray.value = array;
      other.held.set(0, struct);
      other.held.set(1, array);
      return {
        same: [gc.idStruct(struct), other.idStruct(struct), other.heldStruct.value, other.held.get(0)].every((value) => value === struct) &&
          [gc.idArray(array), other.idArray(array), other.heldArray.value, other.held.get(1)].every((value) => value === array),
        distinct: gc.makeStruct(7) !== struct && gc.makeArray(9) !== array,
        nulls: gc.idStruct(null) === null && other.idArray(null) === null,
        values: [other.readStruct(struct), other.readArray(array)],
      };
    })).toEqual({ same: true, distinct: true, nulls: true, values: [7, 9] });
  });

  it('keeps fields opaque while Wasm mutation remains observable through another instance', async () => {
    const browser = await fixture();
    expect(await browser.evaluate(() => {
      const gc = Reflect.get(globalThis, 'gcExports') as GCExports;
      const other = Reflect.get(Reflect.get(globalThis, 'foreign') as object, 'gcExports') as GCExports;
      const struct = gc.makeStruct(7);
      other.writeStruct(struct, 19);
      return { value: gc.readStruct(struct), field: Reflect.get(struct, '0') as unknown, keys: Reflect.ownKeys(struct) };
    })).toEqual({ value: 19, field: undefined, keys: [] });
  });

  it('rejects forged, proxied and wrong-kind references without author coercion', async () => {
    const browser = await fixture();
    expect(await browser.evaluate(() => {
      const gc = Reflect.get(globalThis, 'gcExports') as GCExports;
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const other = Reflect.get(foreign, 'gcExports') as GCExports;
      let conversions = 0;
      const impostor = { [Symbol.toPrimitive]() { conversions++; return 0; } };
      const bad = [undefined, 1, impostor, Object.create(null) as object, gc.makeArray(7), new Proxy(gc.makeStruct(7), {})];
      const rejected = bad.every((value) => {
        try { Reflect.apply(other.idStruct, undefined, [value]); }
        catch (error) { return error instanceof foreign.TypeError; }
        return false;
      });
      return { rejected, conversions };
    })).toEqual({ rejected: true, conversions: 0 });
  });

  it('round-trips GC references through an adapted JavaScript import', async () => {
    const browser = await fixture();
    expect(await browser.evaluate(() => {
      const gc = Reflect.get(globalThis, 'gcExports') as GCExports;
      const struct = gc.makeStruct(7), array = gc.makeArray(9);
      const values = gc.callHost(struct, array);
      return { struct: values[0] === struct, array: values[1] === array, reads: [gc.readStruct(values[0]!), gc.readArray(values[1]!)] };
    })).toEqual({ struct: true, array: true, reads: [7, 9] });
  });

  it('maps i31 references to signed Numbers and validates values without coercion', async () => {
    const browser = await fixture();
    expect(await browser.evaluate(() => {
      const gc = Reflect.get(globalThis, 'gcExports') as GCExports;
      let conversions = 0;
      const rejected = [2 ** 30, -(2 ** 30) - 1, 1.5, NaN, Infinity, 1n, '1',
        { valueOf() { conversions++; return 1; } }].every((value) => {
        try { Reflect.apply(gc.idI31, undefined, [value]); }
        catch (error) { return error instanceof TypeError; }
        return false;
      });
      return {
        wrapped: [gc.makeI31(2 ** 30), gc.makeI31(2 ** 31 - 1), gc.makeI31(2 ** 31)],
        values: [gc.idI31(-(2 ** 30)), gc.idI31(2 ** 30 - 1), gc.idI31(null)], rejected, conversions,
      };
    })).toEqual({ wrapped: [-(2 ** 30), -1, 0], values: [-(2 ** 30), 2 ** 30 - 1, null], rejected: true, conversions: 0 });
  });
});

async function fixture(): Promise<Browlet> {
  const browser = new Browlet({ route: () => '', reporting: false });
  Reflect.set(browser.window, 'foreign', createSiblingWindow(browser));
  await browser.evaluate((source) => {
    for (const target of [globalThis, Reflect.get(globalThis, 'foreign') as typeof globalThis]) {
      const module = new target.WebAssembly.Module(new Uint8Array(source));
      const instance = new target.WebAssembly.Instance(module, { env: { callback: (...values: unknown[]) => values } });
      Reflect.set(target, 'gcExports', instance.exports);
    }
  }, gcModule());
  return browser;
}

interface GCExports {
  makeStruct(value: number): object;
  makeArray(value: number): object;
  readStruct(value: object): number;
  readArray(value: object): number;
  writeStruct(value: object, field: number): void;
  idStruct(this: void, value: object | null): object | null;
  idArray(value: object | null): object | null;
  makeI31(value: number): number;
  idI31(this: void, value: number | null): number | null;
  callHost(struct: object | null, array: object | null): [object | null, object | null];
  heldStruct: WebAssembly.Global;
  heldArray: WebAssembly.Global;
  held: WebAssembly.Table;
}

// Only fixture encoding: (type (struct (field (mut i32)))) and (type (array (mut i32))).
// Typed calls, exported globals/table and a two-result import expose their reference identities.
function gcModule(): number[] {
  const i32 = [0x7f], struct = [0x64, 0], array = [0x64, 1], nullableStruct = [0x63, 0], nullableArray = [0x63, 1];
  const functions = [
    { name: 'makeStruct', parameters: [i32], results: [struct], body: [0x20, 0, 0xfb, 0, 0] },
    { name: 'makeArray', parameters: [i32], results: [array], body: [0x20, 0, 0x41, 2, 0xfb, 6, 1] },
    { name: 'readStruct', parameters: [struct], results: [i32], body: [0x20, 0, 0xfb, 2, 0, 0] },
    { name: 'readArray', parameters: [array], results: [i32], body: [0x20, 0, 0x41, 0, 0xfb, 11, 1] },
    { name: 'writeStruct', parameters: [struct, i32], results: [], body: [0x20, 0, 0x20, 1, 0xfb, 5, 0, 0] },
    { name: 'idStruct', parameters: [nullableStruct], results: [nullableStruct], body: [0x20, 0] },
    { name: 'idArray', parameters: [nullableArray], results: [nullableArray], body: [0x20, 0] },
    { name: 'makeI31', parameters: [i32], results: [[0x64, 0x6c]], body: [0x20, 0, 0xfb, 28] },
    { name: 'idI31', parameters: [[0x6c]], results: [[0x6c]], body: [0x20, 0] },
    { name: 'callHost', parameters: [nullableStruct, nullableArray], results: [nullableStruct, nullableArray], body: [0x20, 0, 0x20, 1, 0x10, 0] },
  ];
  return [0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, vector([[0x5f, 1, 0x7f, 1], [0x5e, 0x7f, 1],
      ...functions.map((fn) => [0x60, ...vector(fn.parameters), ...vector(fn.results)])])),
    ...section(2, vector([[...name('env'), ...name('callback'), 0, functions.length + 1]])),
    ...section(3, vector(functions.map((_, index) => [index + 2]))),
    ...section(4, [1, 0x6e, 1, 2, 2]), // (table (export "held") 2 2 anyref)
    ...section(6, vector([[...nullableStruct, 1, 0xd0, 0, 0x0b], [...nullableArray, 1, 0xd0, 1, 0x0b]])),
    ...section(7, vector([...functions.map((fn, index) => [...name(fn.name), 0, index + 1]),
      [...name('heldStruct'), 3, 0], [...name('heldArray'), 3, 1], [...name('held'), 1, 0]])),
    ...section(10, vector(functions.map((fn) => { const body = [0, ...fn.body, 0x0b]; return [...uint(body.length), ...body]; }))),
  ];
}

function section(id: number, contents: number[]): number[] { return [id, ...uint(contents.length), ...contents]; }
function vector(entries: number[][]): number[] { return [...uint(entries.length), ...entries.flat()]; }
function name(value: string): number[] { const bytes = [...Buffer.from(value)]; return [...uint(bytes.length), ...bytes]; }
function uint(value: number): number[] {
  const result: number[] = [];
  do { const byte = value & 127; value >>>= 7; result.push(byte | (value ? 128 : 0)); } while (value);
  return result;
}
