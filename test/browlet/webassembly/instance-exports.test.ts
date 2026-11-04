/* eslint-disable @typescript-eslint/unbound-method -- These tests borrow getters and supply explicit receivers. */
import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { createSiblingWindow } from '../../support/windows';

// WebAssembly JavaScript API §5.2 and "create an exports object". The engine retains this getter and its object.
describe('WebAssembly Instance exports', () => {
  it('exposes a readonly, realm-owned, nonconstructible getter', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const descriptor = Object.getOwnPropertyDescriptor(WebAssembly.Instance.prototype, 'exports')!;
      const foreignGetter = Object.getOwnPropertyDescriptor(foreign.WebAssembly.Instance.prototype, 'exports')!.get!;
      const getter = descriptor.get!;
      let rejectsConstruction = false;
      try { Reflect.construct(getter, []); }
      catch (error) { rejectsConstruction = error instanceof TypeError; }
      return {
        descriptor: [descriptor.enumerable, descriptor.configurable, descriptor.set === undefined],
        name: getter.name, length: getter.length, rejectsConstruction,
        ownRealm: Object.getPrototypeOf(getter) === Function.prototype,
        foreignRealm: Object.getPrototypeOf(foreignGetter) === foreign.Function.prototype,
      };
    })).toEqual({
      descriptor: [true, true, true], name: 'get exports', length: 0,
      rejectsConstruction: true, ownRealm: true, foreignRealm: true,
    });
  });

  it('rejects lookalikes and proxies in the getter realm without inspecting their properties', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source)));
      let reads = 0;
      const fake = new Proxy(instance, { get() { reads++; throw new Error('Receiver property read'); } });
      const invalid: unknown[] = [null, undefined, 42, {}, WebAssembly.Instance.prototype, Object.create(instance), fake];
      const realms = [globalThis, foreign];
      const rejected = realms.every((realm) => {
        const getter = Object.getOwnPropertyDescriptor(realm.WebAssembly.Instance.prototype, 'exports')!.get!;
        return invalid.every((receiver) => {
          try { Reflect.apply(getter, receiver, []); }
          catch (error) { return error instanceof realm.TypeError; }
          return false;
        });
      });
      return { rejected, reads };
    }, emptyModule)).toEqual({ rejected: true, reads: 0 });
  });

  it('returns the receiver\'s retained object across realms, prototype changes, and property shadowing', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const getter = Object.getOwnPropertyDescriptor(WebAssembly.Instance.prototype, 'exports')!.get!;
      const instance = new foreign.WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source)));
      const exports = instance.exports;
      const ownFunction = Object.getPrototypeOf(exports.first) === foreign.Function.prototype;
      Object.defineProperty(instance, 'exports', { get() { throw new Error('Shadowed property'); } });
      Object.setPrototypeOf(instance, null);
      Object.freeze(instance);
      Object.defineProperty(WebAssembly.Instance.prototype, 'exports', { get() { throw new Error('Replaced getter'); } });
      return { ownFunction, same: Reflect.apply(getter, instance, []) === exports };
    }, namedExports)).toEqual({ ownFunction: true, same: true });
  });

  it('retains one distinct exports object per instance through all three creation paths', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const bytes = new Uint8Array(source);
      const module = new WebAssembly.Module(bytes);
      const instances = [new WebAssembly.Instance(module), await WebAssembly.instantiate(module),
        (await WebAssembly.instantiate(bytes)).instance];
      return {
        distinct: new Set(instances.map((instance) => instance.exports)).size,
        retained: instances.every((instance) => instance.exports === instance.exports),
        empty: instances.every((instance) => Reflect.ownKeys(instance.exports).length === 0),
        nullPrototype: instances.every((instance) => Object.getPrototypeOf(instance.exports) === null),
        frozen: instances.every((instance) => Object.isFrozen(instance.exports)),
      };
    }, emptyModule)).toEqual({ distinct: 3, retained: true, empty: true, nullPrototype: true, frozen: true });
  });

  it('uses frozen data properties, ordinary key ordering, and literal names for export aliases', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source)));
      const exports = instance.exports;
      const descriptors = Object.values(Object.getOwnPropertyDescriptors(exports));
      return {
        keys: Reflect.ownKeys(exports), nullPrototype: Object.getPrototypeOf(exports) === null,
        frozen: Object.isFrozen(exports),
        dataProperties: descriptors.every((descriptor) =>
          descriptor.enumerable && !descriptor.configurable && !descriptor.writable && 'value' in descriptor),
        aliases: descriptors.every((descriptor) => descriptor.value === exports.first),
        value: (exports.first as () => number)(),
        changes: [Reflect.set(exports, 'first', null), Reflect.deleteProperty(exports, 'first'),
          Reflect.defineProperty(exports, 'added', { value: 1 }), Reflect.setPrototypeOf(exports, {})],
      };
    }, namedExports)).toEqual({
      keys: ['2', '10', 'first', '__proto__', 'constructor', '', 'é', 'a\0b'],
      nullPrototype: true, frozen: true, dataProperties: true, aliases: true, value: 42,
      changes: [false, false, false, false],
    });
  });

  it('freezes the exports mapping without freezing the exported global state', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source)));
      const global = instance.exports.counter as WebAssembly.Global;
      global.value = 42;
      const value: unknown = (instance.exports.counter as WebAssembly.Global).value;
      return { frozen: Object.isFrozen(instance.exports), same: instance.exports.counter === global, value };
    }, globalModule)).toEqual({ frozen: true, same: true, value: 42 });
  });

  it('rejects a raw Node Instance at the browser getter boundary', async () => {
    const browser = fixture();
    const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(emptyModule)));
    Reflect.set(browser.window, 'externalInstance', instance);
    Reflect.set(browser.window, 'externalExports', instance.exports);
    expect(await browser.evaluate(() => {
      const getter = Object.getOwnPropertyDescriptor(WebAssembly.Instance.prototype, 'exports')!.get!;
      try { Reflect.apply(getter, Reflect.get(globalThis, 'externalInstance'), []); }
      catch (error) { return error instanceof TypeError; }
      return false;
    })).toBe(true);
  });

  // §10's multiple-table/multiple-memory features must also survive Browlet's
  // function-import adapter: interleave non-function imports with a callback.
  it.each(['constructor', 'module', 'bytes'] as const)('retains distinct memories and tables around a host callback (%s)', async (path) => {
    const browser = fixture();
    expect(await browser.evaluate(async ({ source, path }) => {
      const memoryA = new WebAssembly.Memory({ initial: 1, maximum: 3 });
      const memoryB = new WebAssembly.Memory({ initial: 2, maximum: 3 });
      const tableA = new WebAssembly.Table({ element: 'externref', initial: 1 });
      const tableB = new WebAssembly.Table({ element: 'externref', initial: 1 });
      const first = {}, second = {}, replacement = {};
      tableA.set(0, first);
      tableB.set(0, second);
      let calls = 0;
      const imports = { env: { memoryA, tableA, callback() { calls++; return 7; }, memoryB, tableB } };
      const bytes = new Uint8Array(source);
      const instance = path === 'bytes' ? (await WebAssembly.instantiate(bytes, imports)).instance :
        path === 'module' ? await WebAssembly.instantiate(new WebAssembly.Module(bytes), imports) :
          new WebAssembly.Instance(new WebAssembly.Module(bytes), imports);
      const exports = instance.exports;
      const probeA = exports.probeA as () => [number, unknown, number];
      const probeB = exports.probeB as () => [number, unknown, number];
      const beforeA = probeA(), beforeB = probeB();
      memoryB.grow(1);
      tableB.set(0, replacement);
      const afterA = probeA(), afterB = probeB();
      return {
        identities: exports.memoryA === memoryA && exports.memoryB === memoryB && exports.tableA === tableA && exports.tableB === tableB,
        pages: [beforeA[0], beforeB[0], afterA[0], afterB[0]],
        references: [beforeA[1] === first, beforeB[1] === second, afterA[1] === first, afterB[1] === replacement],
        callbacks: [beforeA[2], beforeB[2], afterA[2], afterB[2]], calls,
      };
    }, { source: multipleStorageModule, path })).toEqual({
      identities: true, pages: [1, 2, 1, 3], references: [true, true, true, true], callbacks: [7, 7, 7, 7], calls: 4,
    });
  });
});

function fixture(): Browlet {
  const browser = new Browlet({ route: () => '', reporting: false });
  Reflect.set(browser.window, 'foreign', createSiblingWindow(browser));
  return browser;
}

// (module)
const emptyModule = [0, 97, 115, 109, 1, 0, 0, 0];

// One (func (result i32) (i32.const 42)), exported under each name, in this declaration order.
// This small export section fits the one-byte unsigned LEB128 length encoding.
const names = ['first', '__proto__', '10', 'constructor', '2', '', 'é', 'a\0b'];
const exportSection = [names.length, ...names.flatMap((name) => {
  const bytes = [...new TextEncoder().encode(name)];
  return [bytes.length, ...bytes, 0, 0];
})];
const namedExports = [
  ...emptyModule, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0,
  7, exportSection.length, ...exportSection, 10, 6, 1, 4, 0, 65, 42, 11,
];

// (module (global (export "counter") (mut i32) (i32.const 1)))
const globalModule = [
  ...emptyModule, 6, 6, 1, 127, 1, 65, 1, 11,
  7, 11, 1, 7, 99, 111, 117, 110, 116, 101, 114, 3, 0,
];

// Two (memory 1 3) and two (table 1 externref) imports, with a () -> i32
// callback between them. probeA/B return memory.size, table.get(0), and callback().
// Every section and function body in this closed fixture fits a one-byte length.
const multipleStorageImports = [5,
  ...field('env'), ...field('memoryA'), 2, 1, 1, 3,
  ...field('env'), ...field('tableA'), 1, 0x6f, 0, 1,
  ...field('env'), ...field('callback'), 0, 0,
  ...field('env'), ...field('memoryB'), 2, 1, 1, 3,
  ...field('env'), ...field('tableB'), 1, 0x6f, 0, 1,
];
const multipleStorageExports = [6,
  ...field('memoryA'), 2, 0, ...field('memoryB'), 2, 1,
  ...field('tableA'), 1, 0, ...field('tableB'), 1, 1,
  ...field('probeA'), 0, 1, ...field('probeB'), 0, 2,
];
const multipleStorageCode = [2, ...[0, 1].flatMap((index) => {
  const body = [0, 0x3f, index, 0x41, 0, 0x25, index, 0x10, 0, 0x0b];
  return [body.length, ...body];
})];
const multipleStorageModule = [
  ...emptyModule,
  1, 11, 2, 0x60, 0, 1, 0x7f, 0x60, 0, 3, 0x7f, 0x6f, 0x7f,
  2, multipleStorageImports.length, ...multipleStorageImports,
  3, 3, 2, 1, 1,
  7, multipleStorageExports.length, ...multipleStorageExports,
  10, multipleStorageCode.length, ...multipleStorageCode,
];

function field(value: string): number[] { return [value.length, ...Buffer.from(value)]; }
