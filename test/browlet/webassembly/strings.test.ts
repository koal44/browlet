import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { createSiblingWindow } from '../../support/windows';

// JavaScript API §§6.1.6–6.1.14. The fixture exposes direct builtin re-exports
// and Wasm functions that call them, using the same declared signatures.
describe('WebAssembly string builtin signatures', () => {
  // SPEC_CLASH(wasm-from-code-point-result): The draft says externref; all three
  // browsers and the original proposal require non-nullable (ref extern).
  it.each([false, true])('requires a non-nullable fromCodePoint result (nullable=%s)', async (nullable) => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate((source) => {
      const bytes = new Uint8Array(source);
      return { ordinary: WebAssembly.validate(bytes), builtin: WebAssembly.validate(bytes, { builtins: ['js-string'] }) };
    }, stringModule(false, nullable))).toEqual({ ordinary: true, builtin: !nullable });
  });
});

describe.each(['direct', 'wasm'] as const)('WebAssembly scalar string builtins (%s)', (path) => {
  it('creates one UTF-16 code unit from the low 16 bits of an i32', async () => {
    const browser = await fixture(path);
    expect(await browser.evaluate(() => {
      const api = Reflect.get(globalThis, 'stringBuiltins') as StringBuiltins;
      return [0, 65, 233, 0xd800, 0xffff, 0x10000, 0x1f642, -1, NaN, Infinity, 65.9, 2 ** 32 + 66]
        .map((value) => api.fromCharCode(value));
    })).toEqual(['\0', 'A', 'é', '\ud800', '\uffff', '\0', '\uf642', '\uffff', '\0', '\0', 'A', 'B']);
  });

  it('creates BMP, surrogate, and supplementary code points without normalization', async () => {
    const browser = await fixture(path);
    expect(await browser.evaluate(() => {
      const api = Reflect.get(globalThis, 'stringBuiltins') as StringBuiltins;
      return [0, 65, 0xffff, 0x10000, 0x10ffff, 0xd800, 0xdfff, 0x1f642].map((value) => api.fromCodePoint(value));
    })).toEqual(['\0', 'A', '\uffff', '\u{10000}', '\u{10ffff}', '\ud800', '\udfff', '🙂']);
  });

  it('traps on out-of-range code points and remains usable after a trap', async () => {
    const browser = await fixture(path);
    expect(await browser.evaluate(() => {
      const api = Reflect.get(globalThis, 'stringBuiltins') as StringBuiltins;
      const trapped = [0x110000, 0x7fffffff, 0x80000000, -1, -2].map((value) => {
        try { api.fromCodePoint(value); } catch (error) { return error instanceof WebAssembly.RuntimeError; }
        return false;
      });
      return { trapped, next: api.fromCodePoint(65) };
    })).toEqual({ trapped: [true, true, true, true, true], next: 'A' });
  });

  it('converts JavaScript code points to i32 before checking their range', async () => {
    const browser = await fixture(path);
    expect(await browser.evaluate(() => {
      const api = Reflect.get(globalThis, 'stringBuiltins') as StringBuiltins;
      return [65.9, -0, NaN, Infinity, 2 ** 32 + 65].map((value) => api.fromCodePoint(value));
    })).toEqual(['A', '\0', '\0', '\0', 'A']);
  });

  it('distinguishes code units from code points at each UTF-16 index', async () => {
    const browser = await fixture(path);
    expect(await browser.evaluate(() => {
      const api = Reflect.get(globalThis, 'stringBuiltins') as StringBuiltins;
      const value = 'A🙂\ud800B\udc00é';
      return {
        units: Array.from({ length: 7 }, (_, index) => api.charCodeAt(value, index)),
        points: Array.from({ length: 7 }, (_, index) => api.codePointAt(value, index)),
      };
    })).toEqual({
      units: [65, 0xd83d, 0xde42, 0xd800, 66, 0xdc00, 233],
      points: [65, 0x1f642, 0xde42, 0xd800, 66, 0xdc00, 233],
    });
  });

  it('traps on out-of-bounds character access instead of returning JavaScript sentinel values', async () => {
    const browser = await fixture(path);
    expect(await browser.evaluate(() => {
      const api = Reflect.get(globalThis, 'stringBuiltins') as StringBuiltins;
      const cases: [string, number][] = [['abc', -1], ['abc', 3], ['abc', 0x80000000], ['', 0]];
      return [api.charCodeAt, api.codePointAt].map((read) => cases.map(([value, index]) => {
        try { read(value, index); } catch (error) { return error instanceof WebAssembly.RuntimeError; }
        return false;
      }));
    })).toEqual([[true, true, true, true], [true, true, true, true]]);
  });

  it('uses Wasm i32 conversion for JavaScript character offsets', async () => {
    const browser = await fixture(path);
    expect(await browser.evaluate(() => {
      const api = Reflect.get(globalThis, 'stringBuiltins') as StringBuiltins;
      return [api.charCodeAt, api.codePointAt].map((read) =>
        [NaN, Infinity, -0.9, 1.9, 2 ** 32 + 1].map((index) => read('AB', index)));
    })).toEqual([[65, 65, 65, 66, 66], [65, 65, 65, 66, 66]]);
  });

  it('counts UTF-16 code units rather than code points or graphemes', async () => {
    const browser = await fixture(path);
    expect(await browser.evaluate(() => {
      const api = Reflect.get(globalThis, 'stringBuiltins') as StringBuiltins;
      return ['', '\0', 'A🙂', '\ud800', 'e\u0301'].map((value) => api.length(value));
    })).toEqual([0, 1, 3, 1, 2]);
  });

  it('concatenates exactly, including empty strings and split surrogate pairs', async () => {
    const browser = await fixture(path);
    expect(await browser.evaluate(() => {
      const api = Reflect.get(globalThis, 'stringBuiltins') as StringBuiltins;
      return [api.concat('', 'abc'), api.concat('abc', ''), api.concat('\ud83d', '\ude42'), api.concat('é', 'e\u0301')];
    })).toEqual(['abc', 'abc', '🙂', 'ée\u0301']);
  });

  it('takes ordered substring ranges, returning empty for reversed or out-of-range starts', async () => {
    const browser = await fixture(path);
    expect(await browser.evaluate(() => {
      const api = Reflect.get(globalThis, 'stringBuiltins') as StringBuiltins;
      const ranges: [number, number][] = [[0, 2], [2, 4], [4, 4], [2, 1], [5, 8], [1, 99], [-1, 4]];
      return ranges.map(([start, end]) => api.substring('abcd', start, end));
    })).toEqual(['ab', 'cd', '', '', '', 'bcd', '']);
  });

  // SPEC_CLASH(wasm-substring-unsigned-offsets): Follow Chromium, Firefox, and the
  // original proposal's unsigned offsets. The draft's ToJSValue(end) is signed.
  it('clamps large unsigned substring end offsets, following Chromium and Firefox', async () => {
    const browser = await fixture(path);
    expect(await browser.evaluate(() => {
      const api = Reflect.get(globalThis, 'stringBuiltins') as StringBuiltins;
      return [api.substring('abcd', 0, -1), api.substring('abcd', 1, 0x80000000)];
    })).toEqual(['abcd', 'bcd']);
  });

  it('slices by code units and preserves lone surrogates', async () => {
    const browser = await fixture(path);
    expect(await browser.evaluate(() => {
      const api = Reflect.get(globalThis, 'stringBuiltins') as StringBuiltins;
      return [api.substring('A🙂B', 1, 2), api.substring('A🙂B', 2, 3), api.substring('A🙂B', 1, 3)];
    })).toEqual(['\ud83d', '\ude42', '🙂']);
  });

  it('compares string values for equality and explicitly allows null', async () => {
    const browser = await fixture(path);
    expect(await browser.evaluate(() => {
      const api = Reflect.get(globalThis, 'stringBuiltins') as StringBuiltins;
      return [api.equals(null, null), api.equals(null, ''), api.equals('', null), api.equals('', ''),
        api.equals('abc', ['a', 'b', 'c'].join('')), api.equals('é', 'e\u0301'), api.equals('\ud800', '\ud800')];
    })).toEqual([1, 0, 0, 1, 1, 0, 1]);
  });

  it('orders strings lexicographically by code units, without locale or normalization', async () => {
    const browser = await fixture(path);
    expect(await browser.evaluate(() => {
      const api = Reflect.get(globalThis, 'stringBuiltins') as StringBuiltins;
      return [api.compare('a', 'b'), api.compare('b', 'a'), api.compare('a', 'a'), api.compare('', 'a'),
        api.compare('aa', 'a'), api.compare('\u{10000}', '\ue000'), api.compare('Z', 'a'), api.compare('é', 'e\u0301')];
    })).toEqual([-1, 1, 0, -1, 1, -1, -1, 1]);
  });

  it('rejects nonstrings in either operand without author coercion', async () => {
    const browser = await fixture(path);
    expect(await browser.evaluate(() => {
      const api = Reflect.get(globalThis, 'stringBuiltins') as StringBuiltins;
      let conversions = 0;
      const coercible = { [Symbol.toPrimitive]() { conversions++; return 'abc'; } };
      const proxy = new Proxy({}, { get() { conversions++; throw new Error('No property access'); } });
      const values = [undefined, 7, 0n, true, Symbol(), Object('abc'), coercible, proxy];
      const results = values.map((value) => [
        () => api.charCodeAt(value, 0), () => api.codePointAt(value, 0), () => api.length(value),
        () => api.concat(value, 'a'), () => api.concat('a', value), () => api.substring(value, 0, 0),
        () => api.equals(value, 'a'), () => api.equals('a', value), () => api.compare(value, 'a'), () => api.compare('a', value),
      ].map((call) => {
        try { call(); } catch (error) { return error instanceof WebAssembly.RuntimeError; }
        return false;
      }));
      return { results, conversions };
    })).toEqual({ results: Array.from({ length: 8 }, () => Array<boolean>(10).fill(true)), conversions: 0 });
  });

  it('rejects null for string operations other than equals', async () => {
    const browser = await fixture(path);
    expect(await browser.evaluate(() => {
      const api = Reflect.get(globalThis, 'stringBuiltins') as StringBuiltins;
      return [() => api.charCodeAt(null, 0), () => api.codePointAt(null, 0), () => api.length(null),
        () => api.concat(null, ''), () => api.concat('', null), () => api.substring(null, 0, 0),
        () => api.compare(null, ''), () => api.compare('', null)].map((call) => {
        try { call(); } catch (error) { return error instanceof WebAssembly.RuntimeError; }
        return false;
      });
    })).toEqual(Array<boolean>(8).fill(true));
  });

  it('converts numeric arguments before running the builtin string checks', async () => {
    const browser = await fixture(path);
    expect(await browser.evaluate(() => {
      const api = Reflect.get(globalThis, 'stringBuiltins') as StringBuiltins;
      const trace: string[] = [];
      const start = { valueOf() { trace.push('start'); return 0; } };
      const end = { valueOf() { trace.push('end'); return 0; } };
      const results = [
        () => { Reflect.apply(api.charCodeAt, undefined, [null, start]); },
        () => { Reflect.apply(api.codePointAt, undefined, [null, start]); },
        () => { Reflect.apply(api.substring, undefined, [null, start, end]); },
      ].map((call) => {
        try { call(); } catch (error) { return error instanceof WebAssembly.RuntimeError; }
        return false;
      });
      return { results, trace };
    })).toEqual({ results: [true, true, true], trace: ['start', 'start', 'start', 'end'] });
  });

  it('preserves author conversion errors and rejects BigInt and Symbol numeric arguments', async () => {
    const browser = await fixture(path);
    expect(await browser.evaluate(() => {
      const api = Reflect.get(globalThis, 'stringBuiltins') as StringBuiltins;
      const marker = new Error('conversion');
      const value = { valueOf() { throw marker; } };
      const original = [api.fromCharCode, api.fromCodePoint].map((create) => {
        try { Reflect.apply(create, undefined, [value]); } catch (error) { return error === marker; }
        return false;
      });
      const invalid = [0n, Symbol()].map((value) => [
        () => { Reflect.apply(api.fromCharCode, undefined, [value]); },
        () => { Reflect.apply(api.fromCodePoint, undefined, [value]); },
        () => { Reflect.apply(api.charCodeAt, undefined, ['a', value]); },
        () => { Reflect.apply(api.codePointAt, undefined, ['a', value]); },
        () => { Reflect.apply(api.substring, undefined, ['a', 0, value]); },
      ].map((call) => {
        try { call(); } catch (error) { return error instanceof TypeError; }
        return false;
      }));
      return { original, invalid };
    })).toEqual({ original: [true, true], invalid: Array.from({ length: 2 }, () => Array<boolean>(5).fill(true)) });
  });

  it('keeps using native primitives when the public String methods are replaced', async () => {
    const browser = await fixture(path);
    expect(await browser.evaluate(() => {
      const api = Reflect.get(globalThis, 'stringBuiltins') as StringBuiltins;
      const properties: [object, string][] = [
        [String, 'fromCharCode'], [String, 'fromCodePoint'], [String.prototype, 'charCodeAt'],
        [String.prototype, 'codePointAt'], [String.prototype, 'concat'], [String.prototype, 'substring'],
      ];
      const originals = properties.map(([object, key]) => Reflect.get(object, key) as unknown);
      try {
        for (const [object, key] of properties) Reflect.set(object, key, () => { throw new Error('Replaced String method'); });
        return [api.fromCharCode(65), api.fromCodePoint(0x1f642), api.charCodeAt('é', 0), api.codePointAt('🙂', 0),
          api.length('🙂'), api.concat('a', 'b'), api.substring('abcd', 1, 3), api.equals('a', 'a'), api.compare('a', 'b')];
      } finally {
        properties.forEach(([object, key], index) => Reflect.set(object, key, originals[index]));
      }
    })).toEqual(['A', '🙂', 233, 0x1f642, 2, 'ab', 'bc', 1, -1]);
  });

  it('uses the instantiating realm for traps and JavaScript argument-conversion failures', async () => {
    const browser = await fixture(path);
    Reflect.set(browser.window, 'foreign', createSiblingWindow(browser));
    expect(await browser.evaluate((source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const module = new foreign.WebAssembly.Module(new Uint8Array(source), { builtins: ['js-string'] });
      const api = new foreign.WebAssembly.Instance(module).exports as unknown as StringBuiltins;
      const traps = [() => api.fromCodePoint(-1), () => api.charCodeAt(null, 0), () => api.compare(null, '')].map((call) => {
        try { call(); }
        catch (error) { return error instanceof foreign.WebAssembly.RuntimeError && !(error instanceof WebAssembly.RuntimeError); }
        return false;
      });
      let conversion = false;
      try { Reflect.apply(api.fromCodePoint, undefined, [0n]); }
      catch (error) { conversion = error instanceof foreign.TypeError && !(error instanceof TypeError); }
      return { traps, conversion, works: api.fromCodePoint(65) };
    }, stringModule(path === 'wasm'))).toEqual({ traps: [true, true, true], conversion: true, works: 'A' });
  });
});

async function fixture(path: 'direct' | 'wasm'): Promise<Browlet> {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.evaluate((source) => {
    const module = new WebAssembly.Module(new Uint8Array(source), { builtins: ['js-string'] });
    Reflect.set(globalThis, 'stringBuiltins', new WebAssembly.Instance(module).exports);
  }, stringModule(path === 'wasm'));
  return browser;
}

interface StringBuiltins {
  fromCharCode(this: void, value: number): string;
  fromCodePoint(this: void, value: number): string;
  charCodeAt(this: void, value: unknown, index: number): number;
  codePointAt(this: void, value: unknown, index: number): number;
  length(this: void, value: unknown): number;
  concat(this: void, first: unknown, second: unknown): string;
  substring(this: void, value: unknown, start: number, end: number): string;
  equals(this: void, first: unknown, second: unknown): number;
  compare(this: void, first: unknown, second: unknown): number;
}

// Closed fixture: import and export each function below from "wasm:js-string".
// callFromWasm adds a forwarding function (local.get each parameter, call import).
// The engine uses (ref extern) for fromCodePoint; nullableCodePoint exercises the
// different (result externref) signature currently written in §6.1.7.
function stringModule(callFromWasm: boolean, nullableCodePoint = false): number[] {
  const i32 = [0x7f], externref = [0x6f], string = [0x64, 0x6f];
  const functions = [
    { name: 'fromCharCode', parameters: [i32], results: [string] },
    { name: 'fromCodePoint', parameters: [i32], results: [nullableCodePoint ? externref : string] },
    { name: 'charCodeAt', parameters: [externref, i32], results: [i32] },
    { name: 'codePointAt', parameters: [externref, i32], results: [i32] },
    { name: 'length', parameters: [externref], results: [i32] },
    { name: 'concat', parameters: [externref, externref], results: [string] },
    { name: 'substring', parameters: [externref, i32, i32], results: [string] },
    { name: 'equals', parameters: [externref, externref], results: [i32] },
    { name: 'compare', parameters: [externref, externref], results: [i32] },
  ];
  const offset = callFromWasm ? functions.length : 0;
  const bodies = callFromWasm ? functions.map((fn, index) => {
    const body = [0, ...fn.parameters.flatMap((_, parameter) => [0x20, parameter]), 0x10, index, 0x0b];
    return [...uint(body.length), ...body];
  }) : [];
  return [0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, vector(functions.map((fn) => [0x60, ...vector(fn.parameters), ...vector(fn.results)]))),
    ...section(2, vector(functions.map((fn, index) => [...name('wasm:js-string'), ...name(fn.name), 0, index]))),
    ...(callFromWasm ? section(3, vector(functions.map((_, index) => [index]))) : []),
    ...section(7, vector(functions.map((fn, index) => [...name(fn.name), 0, index + offset]))),
    ...(callFromWasm ? section(10, vector(bodies)) : []),
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
