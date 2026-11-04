import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { createSiblingWindow } from '../../support/windows';

// WebAssembly JavaScript API §5.1, through the exports() and imports() algorithms.
// Constructor conversion, customSections(), and interface installation are later slices.
describe('WebAssembly Module import and export metadata', () => {
  it('preserves declaration order, duplicate imports, names, and all five external kinds', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      return {
        imports: WebAssembly.Module.imports(module),
        exports: WebAssembly.Module.exports(module),
      };
    }, metadataBytes)).toEqual({ imports: expectedImports, exports: expectedExports });
  });

  it('returns empty lists for a module with no imports or exports', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      return [WebAssembly.Module.imports(module), WebAssembly.Module.exports(module)];
    }, emptyModule)).toEqual([[], []]);
  });

  it.each(['exports', 'imports'] as const)('%s creates ordinary metadata in the invoked function realm', async (operation) => {
    const browser = fixture();
    expect(await browser.evaluate(({ bytes, operation }) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      const inspect: (module: WebAssembly.Module) => object[] = foreign.WebAssembly.Module[operation];
      const receiver = new Proxy({}, { get() { throw new Error('Static receiver was read'); } });
      const result = Reflect.apply(inspect, receiver, [module]);
      return {
        arrayRealm: Object.getPrototypeOf(result) === foreign.Array.prototype,
        recordRealms: result.every((entry) => Object.getPrototypeOf(entry) === foreign.Object.prototype),
        dataProperties: result.every((entry) => Object.values(Object.getOwnPropertyDescriptors(entry)).every((descriptor) =>
          typeof descriptor.value === 'string' && descriptor.writable && descriptor.enumerable && descriptor.configurable)),
        keys: result.map((entry) => Object.keys(entry).sort()),
      };
    }, { bytes: metadataBytes, operation })).toEqual({
      arrayRealm: true, recordRealms: true, dataProperties: true,
      keys: (operation === 'exports' ? expectedExports : expectedImports)
        .map(() => operation === 'exports' ? ['kind', 'name'] : ['kind', 'module', 'name']),
    });
  });

  it('returns fresh lists and records without rereading the source buffer', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const source = new Uint8Array(bytes);
      const module = new WebAssembly.Module(source);
      const imports = WebAssembly.Module.imports(module);
      const exports = WebAssembly.Module.exports(module);
      const firstImport = imports[0]!;
      const firstExport = exports[0]!;
      firstImport.name = firstExport.name = 'changed';
      imports.length = exports.length = 0;
      source.fill(0);
      const nextImports = WebAssembly.Module.imports(module);
      const nextExports = WebAssembly.Module.exports(module);
      return {
        fresh: imports !== nextImports && exports !== nextExports &&
          firstImport !== nextImports[0] && firstExport !== nextExports[0],
        imports: nextImports, exports: nextExports,
      };
    }, metadataBytes)).toEqual({ fresh: true, imports: expectedImports, exports: expectedExports });
  });

  // SPEC_CLASH(wasm-module-descriptor-order): Web IDL emits dictionary members alphabetically;
  // Chromium, Firefox, and WebKit instead insert name/kind and module/name/kind.
  // Browlet's platform methods use ordinary Web IDL dictionary conversion.
  it.each(['exports', 'imports'] as const)('%s uses Web IDL dictionary property order', async (operation) => {
    const browser = fixture();
    expect(await browser.evaluate(({ bytes, operation }) => {
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      return WebAssembly.Module[operation](module).map((entry) => Object.keys(entry));
    }, { bytes: metadataBytes, operation })).toEqual(
      (operation === 'exports' ? expectedExports : expectedImports)
        .map(() => operation === 'exports' ? ['kind', 'name'] : ['kind', 'module', 'name']),
    );
  });

  it.each(['exports', 'imports'] as const)('%s recognizes platform Modules without author property access', async (operation) => {
    const browser = fixture();
    expect(await browser.evaluate(({ bytes, operation }) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      const foreignModule = new foreign.WebAssembly.Module(new Uint8Array(bytes));
      const inspect: (module: WebAssembly.Module) => object[] = foreign.WebAssembly.Module[operation];
      const fail = (): never => { throw new Error('Author code ran'); };
      for (const value of [module, foreignModule]) {
        Object.defineProperty(value, 'constructor', { get: fail });
        Object.setPrototypeOf(value, new Proxy({}, { get: fail, getPrototypeOf: fail }));
        Object.freeze(value);
        if (inspect(value).length === 0) return false;
      }
      const revoked = Proxy.revocable(module, {});
      revoked.revoke();
      const invalid: unknown[] = [
        undefined, null, true, 1, 1n, 'text', Symbol(), {}, [], () => {},
        Object.create(WebAssembly.Module.prototype), { [Symbol.toStringTag]: 'WebAssembly.Module' },
        new Proxy(module, { get: fail, getPrototypeOf: fail }), revoked.proxy,
      ];
      return [[], ...invalid.map((value) => [value])].every((args) => {
        try { Reflect.apply(inspect, null, args); }
        catch (error) { return error instanceof foreign.TypeError; }
        return false;
      });
    }, { bytes: metadataBytes, operation })).toBe(true);
  });

  it.each([
    { name: 'neither', builtins: [], importedStringConstants: null, names: ['hello', 'length', 'other'] },
    { name: 'builtins', builtins: ['js-string'], importedStringConstants: null, names: ['hello', 'other'] },
    { name: 'string constants', builtins: [], importedStringConstants: 'strings', names: ['length', 'other'] },
    { name: 'both', builtins: ['js-string'], importedStringConstants: 'strings', names: ['other'] },
  ])('filters engine-supplied imports when enabling $name', async ({ builtins, importedStringConstants, names }) => {
    const browser = fixture();
    expect(await browser.evaluate(async ({ bytes, builtins, importedStringConstants }) => {
      const options = { builtins, importedStringConstants };
      const module = await Reflect.apply(WebAssembly.compile, null, [new Uint8Array(bytes), options]);
      // Reflection reads the compiled Module's choices, not the author's options object.
      options.builtins.length = 0;
      options.importedStringConstants = 'env';
      return {
        imports: WebAssembly.Module.imports(module).map(({ name }) => name),
        exports: WebAssembly.Module.exports(module),
      };
    }, { bytes: builtinBytes, builtins, importedStringConstants })).toEqual({
      imports: names,
      exports: [
        { name: 'hello', kind: 'global' }, { name: 'length', kind: 'function' }, { name: 'other', kind: 'global' },
      ],
    });
  });
});

function fixture(): Browlet {
  const browser = new Browlet({ route: () => '', reporting: false });
  Reflect.set(browser.window, 'foreign', createSiblingWindow(browser));
  return browser;
}

const expectedImports = [
  { module: 'mód', name: 'f💡', kind: 'function' },
  { module: 'env', name: 'table', kind: 'table' },
  { module: 'env', name: 'memory', kind: 'memory' },
  { module: 'env', name: 'global', kind: 'global' },
  { module: 'env', name: 'tag', kind: 'tag' },
  { module: 'mód', name: 'f💡', kind: 'function' },
];
const expectedExports = [
  { name: 'global', kind: 'global' }, { name: '', kind: 'function' },
  { name: 'memory', kind: 'memory' }, { name: 'tag', kind: 'tag' }, { name: 'table', kind: 'table' },
];

// (module)
const emptyModule = [0, 97, 115, 109, 1, 0, 0, 0];

// (module
//   (import "mód" "f💡" (func))
//   (import "env" "table" (table 1 funcref))
//   (import "env" "memory" (memory 1))
//   (import "env" "global" (global (mut i32)))
//   (import "env" "tag" (tag))
//   (import "mód" "f💡" (func))
//   (export "global" (global 0)) (export "" (func 1))
//   (export "memory" (memory 0)) (export "tag" (tag 0)) (export "table" (table 0)))
const metadataBytes = [
  0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 2, 80, 6, 4,
  109, 195, 179, 100, 5, 102, 240, 159, 146, 161, 0, 0, 3, 101, 110, 118, 5, 116,
  97, 98, 108, 101, 1, 112, 0, 1, 3, 101, 110, 118, 6, 109, 101, 109, 111, 114,
  121, 2, 0, 1, 3, 101, 110, 118, 6, 103, 108, 111, 98, 97, 108, 3, 127, 1,
  3, 101, 110, 118, 3, 116, 97, 103, 4, 0, 0, 4, 109, 195, 179, 100, 5, 102,
  240, 159, 146, 161, 0, 0, 7, 36, 5, 6, 103, 108, 111, 98, 97, 108, 3, 0,
  0, 0, 1, 6, 109, 101, 109, 111, 114, 121, 2, 0, 3, 116, 97, 103, 4, 0,
  5, 116, 97, 98, 108, 101, 1, 0,
];

// (module (import "strings" "hello" (global externref))
//         (import "wasm:js-string" "length" (func (param externref) (result i32)))
//         (import "env" "other" (global (mut i32)))
//         (export "hello" (global 0)) (export "length" (func 0)) (export "other" (global 1)))
const builtinBytes = [
  0, 97, 115, 109, 1, 0, 0, 0, 1, 6, 1, 96, 1, 111, 1, 127, 2, 55,
  3, 7, 115, 116, 114, 105, 110, 103, 115, 5, 104, 101, 108, 108, 111, 3, 111, 0,
  14, 119, 97, 115, 109, 58, 106, 115, 45, 115, 116, 114, 105, 110, 103, 6, 108, 101,
  110, 103, 116, 104, 0, 0, 3, 101, 110, 118, 5, 111, 116, 104, 101, 114, 3, 127,
  1, 7, 26, 3, 5, 104, 101, 108, 108, 111, 3, 0, 6, 108, 101, 110, 103, 116,
  104, 0, 0, 5, 111, 116, 104, 101, 114, 3, 1,
];
