import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { createSiblingWindow } from '../../support/windows';

// JavaScript API §§6.1.4–6.1.5. Test direct re-exports and calls from Wasm;
// the arrays here are opaque Wasm GC arrays, not JavaScript typed arrays.
describe.each(['direct', 'wasm'] as const)('WebAssembly string/array builtins (%s)', (path) => {
  it('reads exactly the selected UTF-16 code units without changing the array', async () => {
    const browser = await fixture();
    expect(await browser.evaluate(({ path, units }) => {
      const api = Reflect.get(globalThis, 'stringArrays') as StringArrayExports;
      const read = path === 'direct' ? api.fromCharCodeArray : api.callFromCharCodeArray;
      const array = api.makeArray(units.length, 0);
      units.forEach((unit, index) => api.set(array, index, unit));
      return {
        whole: read(array, 0, units.length), middle: read(array, 2, 6),
        pair: read(array, 6, 8), loneHigh: read(array, 6, 7),
        unchanged: units.map((_, index) => api.get(array, index)),
      };
    }, { path, units: codeUnits })).toEqual({
      whole: '\0Aé\ud800B\udc00🙂\uffff', middle: 'é\ud800B\udc00',
      pair: '🙂', loneHigh: '\ud83d', unchanged: codeUnits,
    });
  });

  it('accepts empty ranges, including the end of an array and an empty array', async () => {
    const browser = await fixture();
    expect(await browser.evaluate((path) => {
      const api = Reflect.get(globalThis, 'stringArrays') as StringArrayExports;
      const read = path === 'direct' ? api.fromCharCodeArray : api.callFromCharCodeArray;
      const array = api.makeArray(2, 65);
      return [read(array, 0, 0), read(array, 1, 1), read(array, 2, 2), read(api.makeArray(0, 0), 0, 0)];
    }, path)).toEqual(['', '', '', '']);
  });

  it('traps on reversed or out-of-bounds ranges, treating i32 offsets as unsigned', async () => {
    const browser = await fixture();
    expect(await browser.evaluate((path) => {
      const api = Reflect.get(globalThis, 'stringArrays') as StringArrayExports;
      const read = path === 'direct' ? api.fromCharCodeArray : api.callFromCharCodeArray;
      const array = api.makeArray(2, 65);
      return [[1, 0], [0, 3], [3, 3], [-1, 0], [0, -1], [-1, -1]].map(([start, end]) => {
        try { read(array, start!, end!); } catch (error) { return error instanceof WebAssembly.RuntimeError; }
        return false;
      });
    }, path)).toEqual([true, true, true, true, true, true]);
  });

  it('writes code units in place and returns the number written, preserving surrounding elements', async () => {
    const browser = await fixture();
    expect(await browser.evaluate((path) => {
      const api = Reflect.get(globalThis, 'stringArrays') as StringArrayExports;
      const write = path === 'direct' ? api.intoCharCodeArray : api.callIntoCharCodeArray;
      const array = api.makeArray(13, 46);
      const written = write('\0Aé\ud800B\udc00🙂\uffff', array, 2);
      return { written, units: Array.from({ length: 13 }, (_, index) => api.get(array, index)) };
    }, path)).toEqual({ written: 9, units: [46, 46, ...codeUnits, 46, 46] });
  });

  it('accepts an empty write at the end of an array, including an empty array', async () => {
    const browser = await fixture();
    expect(await browser.evaluate((path) => {
      const api = Reflect.get(globalThis, 'stringArrays') as StringArrayExports;
      const write = path === 'direct' ? api.intoCharCodeArray : api.callIntoCharCodeArray;
      const array = api.makeArray(2, 65);
      return {
        counts: [write('', array, 0), write('', array, 2), write('', api.makeArray(0, 0), 0)],
        units: [api.get(array, 0), api.get(array, 1)],
      };
    }, path)).toEqual({ counts: [0, 0, 0], units: [65, 65] });
  });

  it('checks the whole destination range before writing, without wrapping an overflowing offset', async () => {
    const browser = await fixture();
    expect(await browser.evaluate((path) => {
      const api = Reflect.get(globalThis, 'stringArrays') as StringArrayExports;
      const write = path === 'direct' ? api.intoCharCodeArray : api.callIntoCharCodeArray;
      const cases: [string, number][] = [['abc', 0], ['ab', 1], ['', 3], ['a', -1], ['', -1], ['ab', 0xffffffff]];
      return cases.map(([value, start]) => {
        const array = api.makeArray(2, 65);
        let trapped = false;
        try { write(value, array, start); } catch (error) { trapped = error instanceof WebAssembly.RuntimeError; }
        return [trapped, api.get(array, 0), api.get(array, 1)];
      });
    }, path)).toEqual(Array.from({ length: 6 }, () => [true, 65, 65]));
  });

  it('traps on null arrays even when no code units would be read or written', async () => {
    const browser = await fixture();
    expect(await browser.evaluate((path) => {
      const api = Reflect.get(globalThis, 'stringArrays') as StringArrayExports;
      const read = path === 'direct' ? api.fromCharCodeArray : api.callFromCharCodeArray;
      const write = path === 'direct' ? api.intoCharCodeArray : api.callIntoCharCodeArray;
      return [() => read(null, 0, 0), () => write('', null, 0)].map((call) => {
        try { call(); } catch (error) { return error instanceof WebAssembly.RuntimeError; }
        return false;
      });
    }, path)).toEqual([true, true]);
  });

  it('rejects JavaScript arrays, typed arrays, proxies, and incompatible Wasm arrays before index coercion', async () => {
    const browser = await fixture();
    expect(await browser.evaluate((path) => {
      const api = Reflect.get(globalThis, 'stringArrays') as StringArrayExports;
      const read = path === 'direct' ? api.fromCharCodeArray : api.callFromCharCodeArray;
      const write = path === 'direct' ? api.intoCharCodeArray : api.callIntoCharCodeArray;
      let coercions = 0;
      const index = { valueOf() { coercions++; return 0; } };
      const array = api.makeArray(2, 0);
      const invalid = [{}, [], new Uint16Array(2), new Proxy(array, {}), api.makeByteArray(2), api.makeGroupedArray(2)];
      const results = invalid.map((value) => [() => { Reflect.apply(read, undefined, [value, index, 0]); },
        () => { Reflect.apply(write, undefined, ['', value, index]); }].map((call) => {
        try { call(); } catch (error) { return error instanceof TypeError; }
        return false;
      }));
      return { results, coercions };
    }, path)).toEqual({ results: Array.from({ length: 6 }, () => [true, true]), coercions: 0 });
  });

  it('requires a primitive string and never coerces a nonstring source', async () => {
    const browser = await fixture();
    expect(await browser.evaluate((path) => {
      const api = Reflect.get(globalThis, 'stringArrays') as StringArrayExports;
      const write = path === 'direct' ? api.intoCharCodeArray : api.callIntoCharCodeArray;
      const array = api.makeArray(2, 65);
      let coercions = 0;
      const object = { [Symbol.toPrimitive]() { coercions++; return 'x'; } };
      const values = [null, undefined, 42, 0n, true, Symbol(), Object('x'), object];
      const rejected = values.map((value) => {
        try { write(value, array, 0); } catch (error) { return error instanceof WebAssembly.RuntimeError; }
        return false;
      });
      return { rejected, coercions, unchanged: [api.get(array, 0), api.get(array, 1)] };
    }, path)).toEqual({ rejected: Array(8).fill(true), coercions: 0, unchanged: [65, 65] });
  });

  it('finishes argument conversion before executing the builtin', async () => {
    const browser = await fixture();
    expect(await browser.evaluate((path) => {
      const api = Reflect.get(globalThis, 'stringArrays') as StringArrayExports;
      const read = path === 'direct' ? api.fromCharCodeArray : api.callFromCharCodeArray;
      const write = path === 'direct' ? api.intoCharCodeArray : api.callIntoCharCodeArray;
      const array = api.makeArray(2, 0);
      const trace: string[] = [];
      const start = { valueOf() { trace.push('start'); api.set(array, 0, 65); return 0; } };
      const end = { valueOf() { trace.push('end'); api.set(array, 1, 66); return 2; } };
      const result: unknown = Reflect.apply(read, undefined, [array, start, end]);
      let trapped = false;
      try { Reflect.apply(write, undefined, [null, array, start]); }
      catch (error) { trapped = error instanceof WebAssembly.RuntimeError; }
      return { result, trace, trapped };
    }, path)).toEqual({ result: 'AB', trace: ['start', 'end', 'start'], trapped: true });
  });

  it('uses ordinary Wasm i32 conversion for JavaScript offsets', async () => {
    const browser = await fixture();
    expect(await browser.evaluate((path) => {
      const api = Reflect.get(globalThis, 'stringArrays') as StringArrayExports;
      const read = path === 'direct' ? api.fromCharCodeArray : api.callFromCharCodeArray;
      const write = path === 'direct' ? api.intoCharCodeArray : api.callIntoCharCodeArray;
      const offsets = [NaN, Infinity, -Infinity, 0.9, 1.9, 2 ** 32, 2 ** 32 + 1];
      return offsets.map((offset) => {
        const array = api.makeArray(2, 65);
        api.set(array, 1, 66);
        const result = read(array, offset, 2);
        const written = write('x', array, offset);
        return [result, written, api.get(array, 0), api.get(array, 1)];
      });
    }, path)).toEqual([
      ['AB', 1, 120, 66], ['AB', 1, 120, 66], ['AB', 1, 120, 66], ['AB', 1, 120, 66],
      ['B', 1, 65, 120], ['AB', 1, 120, 66], ['B', 1, 65, 120],
    ]);
  });

  it('preserves errors from index conversion and leaves the destination untouched', async () => {
    const browser = await fixture();
    expect(await browser.evaluate((path) => {
      const api = Reflect.get(globalThis, 'stringArrays') as StringArrayExports;
      const read = path === 'direct' ? api.fromCharCodeArray : api.callFromCharCodeArray;
      const write = path === 'direct' ? api.intoCharCodeArray : api.callIntoCharCodeArray;
      const array = api.makeArray(2, 65);
      const marker = new Error('index conversion');
      const start = { valueOf() { throw marker; } };
      let ends = 0;
      const end = { valueOf() { ends++; return 2; } };
      const errors = [() => { Reflect.apply(read, undefined, [array, start, end]); },
        () => { Reflect.apply(write, undefined, ['x', array, start]); }].map((call) => {
        try { call(); } catch (error) { return error === marker; }
        return false;
      });
      return { errors, ends, units: [api.get(array, 0), api.get(array, 1)] };
    }, path)).toEqual({ errors: [true, true], ends: 0, units: [65, 65] });
  });

  it('uses native string primitives despite replacement of the corresponding JavaScript methods', async () => {
    const browser = await fixture();
    expect(await browser.evaluate((path) => {
      const api = Reflect.get(globalThis, 'stringArrays') as StringArrayExports;
      const read = path === 'direct' ? api.fromCharCodeArray : api.callFromCharCodeArray;
      const write = path === 'direct' ? api.intoCharCodeArray : api.callIntoCharCodeArray;
      const array = api.makeArray(2, 0);
      const fromCharCode = String.fromCharCode;
      const charCodeAt = Reflect.get(String.prototype, 'charCodeAt');
      try {
        String.fromCharCode = () => { throw new Error('Replaced fromCharCode'); };
        String.prototype.charCodeAt = () => { throw new Error('Replaced charCodeAt'); };
        const written = write('é\ud800', array, 0);
        return { written, value: read(array, 0, 2), units: [api.get(array, 0), api.get(array, 1)] };
      } finally {
        String.fromCharCode = fromCharCode;
        String.prototype.charCodeAt = charCodeAt;
      }
    }, path)).toEqual({ written: 2, value: 'é\ud800', units: [233, 55296] });
  });
});

describe('WebAssembly string/array type identity', () => {
  it('accepts an equivalent array type from another module and realm and traps in the called realm', async () => {
    const browser = await fixture();
    Reflect.set(browser.window, 'foreign', createSiblingWindow(browser));
    expect(await browser.evaluate((source) => {
      const api = Reflect.get(globalThis, 'stringArrays') as StringArrayExports;
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const module = new foreign.WebAssembly.Module(new Uint8Array(source), { builtins: ['js-string'] });
      const other = new foreign.WebAssembly.Instance(module).exports as unknown as StringArrayExports;
      const array = other.makeArray(2, 65);
      const written = api.intoCharCodeArray('é', array, 1);
      let ownError = false;
      try { other.fromCharCodeArray(array, 0, 3); }
      catch (error) { ownError = error instanceof foreign.WebAssembly.RuntimeError && !(error instanceof WebAssembly.RuntimeError); }
      return { written, value: api.fromCharCodeArray(array, 0, 2), otherRead: other.get(array, 1), ownError };
    }, stringArrayModule())).toEqual({ written: 1, value: 'Aé', otherRead: 233, ownError: true });
  });

  it.each([
    { name: 'mutable i16 array', type: [0x5e, 0x77, 1], functionType: 1, valid: true },
    { name: 'immutable i16 array', type: [0x5e, 0x77, 0], functionType: 1, valid: false },
    { name: 'mutable i8 array', type: [0x5e, 0x78, 1], functionType: 1, valid: false },
    { name: 'mutable i32 array', type: [0x5e, 0x7f, 1], functionType: 1, valid: false },
    { name: 'i16 array in a two-type recursive group', type: [0x4e, 2, 0x5e, 0x77, 1, 0x5f, 0], functionType: 2, valid: false },
  ])('validates the exact builtin array type: $name', async ({ type, functionType, valid }) => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate((source) => {
      const bytes = new Uint8Array(source);
      const options = { builtins: ['js-string'] };
      let constructed = true;
      try { new WebAssembly.Module(bytes, options); }
      catch (error) { if (!(error instanceof WebAssembly.CompileError)) throw error; constructed = false; }
      return { ordinaryModule: WebAssembly.validate(bytes), builtinModule: WebAssembly.validate(bytes, options), constructed };
    }, arrayImports(type, functionType))).toEqual({ ordinaryModule: true, builtinModule: valid, constructed: valid });
  });
});

async function fixture(): Promise<Browlet> {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.evaluate((source) => {
    const module = new WebAssembly.Module(new Uint8Array(source), { builtins: ['js-string'] });
    Reflect.set(globalThis, 'stringArrays', new WebAssembly.Instance(module).exports);
  }, stringArrayModule());
  return browser;
}

interface StringArrayExports {
  fromCharCodeArray(this: void, array: object | null, start: number, end: number): string;
  intoCharCodeArray(this: void, value: unknown, array: object | null, start: number): number;
  callFromCharCodeArray(this: void, array: object | null, start: number, end: number): string;
  callIntoCharCodeArray(this: void, value: unknown, array: object | null, start: number): number;
  makeArray(this: void, length: number, fill: number): object;
  makeByteArray(this: void, length: number): object;
  makeGroupedArray(this: void, length: number): object;
  get(this: void, array: object, index: number): number;
  set(this: void, array: object, index: number, value: number): void;
}

const codeUnits = [0, 65, 233, 55296, 66, 56320, 55357, 56898, 65535];

// Closed fixture, not a general Wasm builder. Its first types are:
// (type $chars (array (mut i16))) (type $bytes (array (mut i8)))
// (rec (type $groupedChars (array (mut i16))) (type (struct)))
// Both builtin imports use (ref null $chars). The exports expose those imports,
// forwarding Wasm functions, and array.new / array.get_u / array.set helpers.
function stringArrayModule(): number[] {
  const i32 = [0x7f], chars = [0x64, 0], nullableChars = [0x63, 0], externref = [0x6f], string = [0x64, 0x6f];
  const functions = [
    { name: 'callFromCharCodeArray', parameters: [nullableChars, i32, i32], results: [string], body: [0x20, 0, 0x20, 1, 0x20, 2, 0x10, 0] },
    { name: 'callIntoCharCodeArray', parameters: [externref, nullableChars, i32], results: [i32], body: [0x20, 0, 0x20, 1, 0x20, 2, 0x10, 1] },
    { name: 'makeArray', parameters: [i32, i32], results: [chars], body: [0x20, 1, 0x20, 0, 0xfb, 6, 0] },
    { name: 'get', parameters: [chars, i32], results: [i32], body: [0x20, 0, 0x20, 1, 0xfb, 13, 0] },
    { name: 'set', parameters: [chars, i32, i32], results: [], body: [0x20, 0, 0x20, 1, 0x20, 2, 0xfb, 14, 0] },
    { name: 'makeByteArray', parameters: [i32], results: [[0x64, 1]], body: [0x41, 0, 0x20, 0, 0xfb, 6, 1] },
    { name: 'makeGroupedArray', parameters: [i32], results: [[0x64, 2]], body: [0x41, 0, 0x20, 0, 0xfb, 6, 2] },
  ];
  return [0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, vector([
      [0x5e, 0x77, 1], [0x5e, 0x78, 1], [0x4e, 2, 0x5e, 0x77, 1, 0x5f, 0],
      ...functions.map((fn) => [0x60, ...vector(fn.parameters), ...vector(fn.results)]),
    ])),
    ...section(2, vector([
      [...name('wasm:js-string'), ...name('fromCharCodeArray'), 0, 4],
      [...name('wasm:js-string'), ...name('intoCharCodeArray'), 0, 5],
    ])),
    ...section(3, vector(functions.map((_, index) => [index + 4]))),
    ...section(7, vector([
      [...name('fromCharCodeArray'), 0, 0], [...name('intoCharCodeArray'), 0, 1],
      ...functions.map((fn, index) => [...name(fn.name), 0, index + 2]),
    ])),
    ...section(10, vector(functions.map((fn) => { const body = [0, ...fn.body, 0x0b]; return [...uint(body.length), ...body]; }))),
  ];
}

// (type $chars ...) followed by just the two builtin imports, without bodies
// that would themselves constrain the array type. This isolates import validation.
function arrayImports(arrayType: number[], firstFunctionType: number): number[] {
  return [0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, vector([arrayType,
      [0x60, 3, 0x63, 0, 0x7f, 0x7f, 1, 0x64, 0x6f],
      [0x60, 3, 0x6f, 0x63, 0, 0x7f, 1, 0x7f],
    ])),
    ...section(2, vector([
      [...name('wasm:js-string'), ...name('fromCharCodeArray'), 0, firstFunctionType],
      [...name('wasm:js-string'), ...name('intoCharCodeArray'), 0, firstFunctionType + 1],
    ])),
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
