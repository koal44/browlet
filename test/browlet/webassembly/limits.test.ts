import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';

// JavaScript API §8. These fixtures validate small declarations; they do not
// allocate the declared memories/tables or deliberately exhaust process memory.
describe('WebAssembly module limits', () => {
  const cases = [
    { name: 'function parameters', limit: 1_000, source: (count: number) => typeModule(Array<number>(count).fill(0x7f), []) },
    { name: 'function results', limit: 1_000, source: (count: number) => typeModule([], Array<number>(count).fill(0x7f)) },
    { name: 'locals including parameters', limit: 50_000, source: localModule },
    {
      name: 'struct fields', limit: 10_000, source: (count: number) => moduleBytes(section(1, [1, 0x5f,
        ...uint(count), ...Array.from({ length: count }, () => [0x7f, 0]).flat()])),
    },
    { name: 'array.new_fixed operands', limit: 10_000, source: fixedArrayModule },
    { name: 'subtype depth', limit: 63, source: subtypeModule },
    { name: 'declared 32-bit memory pages', limit: 65_536, source: (count: number) => memoryModule(0, count, false) },
    { name: 'initial table entries', limit: 10_000_000, source: (count: number) => moduleBytes(section(4, [1, 0x70, 0, ...uint(count)])) },
  ];

  it.each(cases)('accepts the $name boundary and rejects the next value', async ({ limit, source }) => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate(({ valid, invalid }) => {
      const within = new Uint8Array(valid), beyond = new Uint8Array(invalid);
      let accepted = false, compileError = false;
      try { accepted = new WebAssembly.Module(within) instanceof WebAssembly.Module; } catch { /* Checked below. */ }
      try { new WebAssembly.Module(beyond); } catch (error) { compileError = error instanceof WebAssembly.CompileError; }
      return { valid: WebAssembly.validate(within), accepted, invalid: WebAssembly.validate(beyond), compileError };
    }, { valid: source(limit), invalid: source(limit + 1) })).toEqual({ valid: true, accepted: true, invalid: false, compileError: true });
  });

  // SPEC_CLASH(wasm-module-memory-count): The draft caps modules at 100 memories;
  // Chromium accepts more (V8's limit is 100,000). Firefox and WebKit reject 101.
  it('accepts more than 100 memories per module, following Chromium', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate((sources) => sources.map((source) => {
      const bytes = new Uint8Array(source);
      return WebAssembly.validate(bytes) && new WebAssembly.Module(bytes) instanceof WebAssembly.Module;
    }), [100, 101].map((count) => moduleBytes(section(5,
      [...uint(count), ...Array.from({ length: count }, () => [0, 0]).flat()]))))).toEqual([true, true]);
  });

  // SPEC_CLASH(wasm-memory64-declaration-limit): V8 applies its 262,144-page
  // runtime ceiling to declarations too. The draft, Firefox, and WebKit permit
  // maximum declarations up to 2**37 - 1 pages without allocating that storage.
  it('rejects memory64 declarations above 16 GiB, following Chromium', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate((sources) => sources.map((source) => {
      const bytes = new Uint8Array(source);
      let accepted = false, compileError = false;
      try { accepted = new WebAssembly.Module(bytes) instanceof WebAssembly.Module; }
      catch (error) { compileError = error instanceof WebAssembly.CompileError; }
      return { valid: WebAssembly.validate(bytes), accepted, compileError };
    }), [memoryModule(0, 262_144, true), memoryModule(0, 262_145, true), memoryModule(0, 2 ** 37 - 1, true)]))
      .toEqual([
        { valid: true, accepted: true, compileError: false },
        { valid: false, accepted: false, compileError: true },
        { valid: false, accepted: false, compileError: true },
      ]);
  });

  it('reports an excessive function signature as CompileError through asynchronous entry points', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate(async (source) => {
      const bytes = new Uint8Array(source);
      const results: boolean[] = [];
      for (const compile of [() => WebAssembly.compile(bytes), () => WebAssembly.instantiate(bytes)]) {
        try { await compile(); results.push(false); } catch (error) { results.push(error instanceof WebAssembly.CompileError); }
      }
      return results;
    }, typeModule(Array<number>(1_001).fill(0x7f), []))).toEqual([true, true]);
  });
});

function typeModule(parameters: number[], results: number[]): number[] {
  return moduleBytes(section(1, [1, 0x60, ...uint(parameters.length), ...parameters, ...uint(results.length), ...results]));
}

function localModule(count: number): number[] {
  // One parameter plus count - 1 explicit locals. The parameter counts toward the limit.
  const body = [1, ...uint(count - 1), 0x7f, 0x0b];
  return [...typeModule([0x7f], []), ...section(3, [1, 0]), ...section(10, [1, ...uint(body.length), ...body])];
}

function subtypeModule(depth: number): number[] {
  // A chain of non-final empty structs, starting at depth zero.
  return moduleBytes(section(1, [...uint(depth + 1), ...Array.from({ length: depth + 1 }, (_, index) =>
    [0x50, ...(index === 0 ? [0] : [1, ...uint(index - 1)]), 0x5f, 0]).flat()]));
}

function fixedArrayModule(count: number): number[] {
  // Validation only: push count i32 zeros, array.new_fixed an i32 array, drop it.
  const body = [0, ...Array.from({ length: count }, () => [0x41, 0]).flat(), 0xfb, 0x08, 0, ...uint(count), 0x1a, 0x0b];
  return moduleBytes(section(1, [2, 0x5e, 0x7f, 1, 0x60, 0, 0]), section(3, [1, 1]),
    section(10, [1, ...uint(body.length), ...body]));
}

function memoryModule(initial: number, maximum: number, memory64: boolean): number[] {
  return moduleBytes(section(5, [1, memory64 ? 5 : 1, ...uint(initial), ...uint(maximum)]));
}

function moduleBytes(...sections: number[][]): number[] { return [0, 97, 115, 109, 1, 0, 0, 0, ...sections.flat()]; }
function section(id: number, bytes: number[]): number[] { return [id, ...uint(bytes.length), ...bytes]; }
function uint(value: number): number[] {
  const bytes: number[] = [];
  do { const byte = value % 128; value = Math.floor(value / 128); bytes.push(byte | (value ? 128 : 0)); } while (value);
  return bytes;
}
