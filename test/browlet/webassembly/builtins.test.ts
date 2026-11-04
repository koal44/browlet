import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { createSiblingWindow } from '../../support/windows';

const i32 = [0x7f], i64 = [0x7e], externref = [0x6f], nonnullExternref = [0x64, 0x6f];

// JavaScript API §6 and §§6.1.1–6.1.3. Compilation selects builtins; they are
// engine functions, not properties looked up on Browlet's WebAssembly namespace.
describe('WebAssembly builtin selection', () => {
  it.each(['Module', 'compile', 'instantiate'] as const)('retains builtin selection through %s', async (method) => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate(async ({ source, method }) => {
      const bytes = new Uint8Array(source);
      const options = { builtins: ['unknown-set', 'js-string'] };
      const imports = new Proxy({}, { get() { throw new Error('Builtin imports must not be read'); } });
      let module: WebAssembly.Module;
      let instance: WebAssembly.Instance;
      if (method === 'instantiate') {
        ({ module, instance } = await WebAssembly.instantiate(bytes, imports, options));
      } else {
        module = method === 'Module' ? new WebAssembly.Module(bytes, options) : await WebAssembly.compile(bytes, options);
        options.builtins.length = 0;
        instance = await WebAssembly.instantiate(module, imports);
      }
      const test = instance.exports.test as (value: unknown) => number;
      const cast = instance.exports.cast as (value: unknown) => string;
      return { imports: WebAssembly.Module.imports(module), test: test('yes'), cast: cast('retained') };
    }, { source: stringChecks, method })).toEqual({ imports: [], test: 1, cast: 'retained' });
  });

  it.each(['unknown-set', 'JS-string', 'wasm:js-string', 'js-string\0'])('ignores the unrecognized builtin set %j', async (name) => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate(({ source, name }) => {
      const bytes = new Uint8Array(source);
      const options = { builtins: [name] };
      const module = new WebAssembly.Module(bytes, options);
      const instance = new WebAssembly.Instance(module, { 'wasm:js-string': { test: () => 42 } });
      return {
        valid: WebAssembly.validate(bytes, options),
        imports: WebAssembly.Module.imports(module),
        result: (instance.exports.test as () => number)(),
      };
    }, { source: numericTest, name })).toEqual({
      valid: true, imports: [{ module: 'wasm:js-string', name: 'test', kind: 'function' }], result: 42,
    });
  });

  it.each([
    ['js-string', 'test'], ['WASM:js-string', 'test'], ['wasm:js-string', 'Test'], ['wasm:js-string', 'unknown'],
  ])('requires an exact builtin import name: %s / %s', async (moduleName, name) => {
    const browser = new Browlet({ route: () => '', reporting: false });
    const source = importFunctions([{ module: moduleName, name, parameters: [], results: [i32] }]);
    expect(await browser.evaluate(({ source, moduleName, name }) => {
      const bytes = new Uint8Array(source);
      const options = { builtins: ['js-string'] };
      const module = new WebAssembly.Module(bytes, options);
      const instance = new WebAssembly.Instance(module, { [moduleName]: { [name]: () => 42 } });
      return {
        valid: WebAssembly.validate(bytes, options),
        imports: WebAssembly.Module.imports(module),
        result: (instance.exports[name] as () => number)(),
      };
    }, { source, moduleName, name })).toEqual({
      valid: true, imports: [{ module: moduleName, name, kind: 'function' }], result: 42,
    });
  });

  it('uses ordinary imports when the builtin set is not enabled', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate((source) => {
      const module = new WebAssembly.Module(new Uint8Array(source));
      const instance = new WebAssembly.Instance(module, {
        'wasm:js-string': { test: () => 42, cast: () => 'author implementation' },
      });
      return {
        count: WebAssembly.Module.imports(module).length,
        test: (instance.exports.test as () => number)(),
        cast: (instance.exports.cast as () => string)(),
      };
    }, stringChecks)).toEqual({ count: 2, test: 42, cast: 'author implementation' });
  });

  it.each([
    { name: 'wrong arity', parameters: [], results: [i32] },
    { name: 'wrong parameter', parameters: [i32], results: [i32] },
    { name: 'wrong result', parameters: [externref], results: [i64] },
  ])('rejects a recognized builtin with $name at every compilation entry point', async ({ parameters, results }) => {
    const browser = new Browlet({ route: () => '', reporting: false });
    const source = importFunctions([{ module: 'wasm:js-string', name: 'test', parameters, results }]);
    expect(await browser.evaluate(async (source) => {
      const bytes = new Uint8Array(source);
      const options = { builtins: ['js-string'] };
      const errors: boolean[] = [];
      try { new WebAssembly.Module(bytes, options); errors.push(false); }
      catch (error) { errors.push(error instanceof WebAssembly.CompileError); }
      try { await WebAssembly.compile(bytes, options); errors.push(false); }
      catch (error) { errors.push(error instanceof WebAssembly.CompileError); }
      const imports = new Proxy({}, { get() { throw new Error('Validation must precede import lookup'); } });
      try { await WebAssembly.instantiate(bytes, imports, options); errors.push(false); }
      catch (error) { errors.push(error instanceof WebAssembly.CompileError); }
      return { withoutBuiltins: WebAssembly.validate(bytes), withBuiltins: WebAssembly.validate(bytes, options), errors };
    }, source)).toEqual({ withoutBuiltins: true, withBuiltins: false, errors: [true, true, true] });
  });

  // SPEC_CLASH(wasm-nonfunction-builtin-import): The draft rejects this global;
  // retain Chromium's ordinary-import behavior. Firefox and WebKit reject it.
  it('treats a non-function import with a builtin name as an ordinary import, following Chromium', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate(async (source) => {
      const bytes = new Uint8Array(source);
      const options = { builtins: ['js-string'] };
      const constructed = new WebAssembly.Module(bytes, options);
      const compiled = await WebAssembly.compile(bytes, options);
      const { instance } = await WebAssembly.instantiate(bytes, { 'wasm:js-string': { test: 42 } }, options);
      return {
        valid: WebAssembly.validate(bytes, options),
        constructedImports: WebAssembly.Module.imports(constructed),
        compiledImports: WebAssembly.Module.imports(compiled),
        value: (instance.exports.test as WebAssembly.Global).value as number,
      };
    }, globalImport)).toEqual({
      valid: true,
      constructedImports: [{ module: 'wasm:js-string', name: 'test', kind: 'global' }],
      compiledImports: [{ module: 'wasm:js-string', name: 'test', kind: 'global' }],
      value: 42,
    });
  });

  it.each(['Instance', 'instantiate'] as const)('keeps ordinary function signatures aligned around builtins through %s', async (method) => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate(async ({ source, method }) => {
      const trace: string[] = [];
      const imports = {
        env: {
          pair: () => ({ *[Symbol.iterator]() { trace.push('pair'); yield 7; yield 9n; } }),
          scalar: () => ({ valueOf() { trace.push('scalar'); return 42; } }),
        },
        get 'wasm:js-string'(): never { throw new Error('Builtin imports must not be read'); },
      };
      const bytes = new Uint8Array(source);
      const options = { builtins: ['js-string'] };
      const instance = method === 'Instance'
        ? new WebAssembly.Instance(new WebAssembly.Module(bytes, options), imports)
        : (await WebAssembly.instantiate(bytes, imports, options)).instance;
      return {
        test: (instance.exports.test as (value: unknown) => number)('yes'),
        pair: (instance.exports.pair as () => [number, bigint])(),
        cast: (instance.exports.cast as (value: unknown) => string)('hello'),
        scalar: (instance.exports.scalar as () => number)(),
        trace,
      };
    }, { source: mixedImports, method })).toEqual({ test: 1, pair: [7, 9n], cast: 'hello', scalar: 42, trace: ['pair', 'scalar'] });
  });
});

describe('WebAssembly string builtins: cast and test', () => {
  it.each(['re-exported', 'called from Wasm'])('accepts primitive strings, preserving UTF-16 code units (%s)', async (path) => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate((source) => {
      const module = new WebAssembly.Module(new Uint8Array(source), { builtins: ['js-string'] });
      const { exports } = new WebAssembly.Instance(module);
      const test = exports.test as (value: unknown) => number;
      const cast = exports.cast as (value: unknown) => string;
      return ['', 'hello', '\0', 'a\u{1f642}b', '\ud800', '\udfff'].map((value) => [test(value), cast(value) === value]);
    }, path === 're-exported' ? stringChecks : stringCalls)).toEqual(Array.from({ length: 6 }, () => [1, true]));
  });

  it.each(['re-exported', 'called from Wasm'])('tests nonstrings without coercion and traps when casting them (%s)', async (path) => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate((source) => {
      const module = new WebAssembly.Module(new Uint8Array(source), { builtins: ['js-string'] });
      const { exports } = new WebAssembly.Instance(module);
      const test = exports.test as (value?: unknown) => number;
      const cast = exports.cast as (value?: unknown) => string;
      let coercions = 0;
      const object = { [Symbol.toPrimitive]() { coercions++; return 'string'; } };
      const proxy = new Proxy({}, { get() { coercions++; throw new Error('No property access'); } });
      const values = [undefined, null, 42, 0n, false, Symbol(), {}, [], () => '', Object('boxed'), object, proxy];
      const results = values.map((value) => {
        let trap = false;
        try { cast(value); } catch (error) { trap = error instanceof WebAssembly.RuntimeError; }
        return [test(value), trap];
      });
      return { results, coercions };
    }, path === 're-exported' ? stringChecks : stringCalls)).toEqual({ results: Array.from({ length: 12 }, () => [0, true]), coercions: 0 });
  });

  it('does not consult author replacements of String or WebAssembly properties', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate((source) => {
      const module = new WebAssembly.Module(new Uint8Array(source), { builtins: ['js-string'] });
      const { exports } = new WebAssembly.Instance(module);
      const test = exports.test as (value: unknown) => number;
      const cast = exports.cast as (value: unknown) => string;
      const StringConstructor = String;
      const RuntimeError = WebAssembly.RuntimeError;
      try {
        Reflect.set(globalThis, 'String', () => { throw new Error('Replaced String'); });
        Reflect.set(WebAssembly, 'RuntimeError', () => { throw new Error('Replaced RuntimeError'); });
        let nativeError = false;
        try { cast({}); } catch (error) { nativeError = error instanceof RuntimeError; }
        return { test: test('yes'), cast: cast('unchanged'), nativeError };
      } finally {
        Reflect.set(globalThis, 'String', StringConstructor);
        Reflect.set(WebAssembly, 'RuntimeError', RuntimeError);
      }
    }, stringChecks)).toEqual({ test: 1, cast: 'unchanged', nativeError: true });
  });

  it('creates exported builtins and their trap errors in the instantiating realm', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    Reflect.set(browser.window, 'foreign', createSiblingWindow(browser));
    expect(await browser.evaluate((source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const module = new WebAssembly.Module(new Uint8Array(source), { builtins: ['js-string'] });
      const { exports } = new foreign.WebAssembly.Instance(module);
      const cast = exports.cast as (value: unknown) => string;
      let errorRealm = false;
      try { cast({}); }
      catch (error) { errorRealm = error instanceof foreign.WebAssembly.RuntimeError && !(error instanceof WebAssembly.RuntimeError); }
      return {
        functionRealm: Object.getPrototypeOf(cast) === foreign.Function.prototype,
        works: cast('cross realm'), errorRealm,
      };
    }, stringChecks)).toEqual({ functionRealm: true, works: 'cross realm', errorRealm: true });
  });
});

type FunctionImport = { module: string; name: string; parameters: number[][]; results: number[][]; };

// Each import is exported under its field name. When callFromWasm is true,
// export a Wasm function that forwards its parameters to the import instead.
// For example, stringChecks represents:
// (module (import "wasm:js-string" "test" (func (param externref) (result i32)))
//         (import "wasm:js-string" "cast" (func (param externref) (result (ref extern))))
//         (export "test" (func 0)) (export "cast" (func 1)))
function importFunctions(imports: FunctionImport[], callFromWasm = false): number[] {
  const name = (value: string): number[] => {
    const bytes = [...new TextEncoder().encode(value)];
    return [...unsigned(bytes.length), ...bytes];
  };
  const vector = (values: number[][]): number[] => [...unsigned(values.length), ...values.flat()];
  const section = (id: number, bytes: number[]): number[] => [id, ...unsigned(bytes.length), ...bytes];
  const bodies = callFromWasm ? imports.map((entry, index) => {
    // No locals; local.get each parameter, call the import, and end the function.
    const body = [
      0, ...entry.parameters.flatMap((_, parameter) => [0x20, ...unsigned(parameter)]),
      0x10, ...unsigned(index), 0x0b,
    ];
    return [...unsigned(body.length), ...body];
  }) : [];
  const exportOffset = callFromWasm ? imports.length : 0;
  const exports = imports.map((entry, index) => [...name(entry.name), 0, ...unsigned(index + exportOffset)]);
  return [
    0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, vector(imports.map(({ parameters, results }) => [0x60, ...vector(parameters), ...vector(results)]))),
    ...section(2, vector(imports.map((entry, index) => [...name(entry.module), ...name(entry.name), 0, ...unsigned(index)]))),
    ...(callFromWasm ? section(3, vector(imports.map((_, index) => unsigned(index)))) : []),
    ...section(7, vector(exports)),
    ...(callFromWasm ? section(10, vector(bodies)) : []),
  ];
}

function unsigned(value: number): number[] {
  const bytes: number[] = [];
  do {
    const byte = value & 0x7f;
    value >>>= 7;
    bytes.push(byte | (value ? 0x80 : 0));
  } while (value);
  return bytes;
}

const testImport = { module: 'wasm:js-string', name: 'test', parameters: [externref], results: [i32] };
const castImport = { module: 'wasm:js-string', name: 'cast', parameters: [externref], results: [nonnullExternref] };
const stringChecks = importFunctions([testImport, castImport]);
const stringCalls = importFunctions([testImport, castImport], true);
// This signature is valid Wasm but does not match the builtin named "test".
const numericTest = importFunctions([{ ...testImport, parameters: [] }]);
// (module (import "wasm:js-string" "test" (global i32)) (export "test" (global 0)))
const globalImport = [
  0, 97, 115, 109, 1, 0, 0, 0, 2, 24, 1,
  14, 119, 97, 115, 109, 58, 106, 115, 45, 115, 116, 114, 105, 110, 103,
  4, 116, 101, 115, 116, 3, 127, 0,
  7, 8, 1, 4, 116, 101, 115, 116, 3, 0,
];
const mixedImports = importFunctions([
  testImport,
  { module: 'env', name: 'pair', parameters: [], results: [i32, i64] },
  castImport,
  { module: 'env', name: 'scalar', parameters: [], results: [i32] },
]);
