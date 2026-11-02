/* eslint-disable @typescript-eslint/unbound-method -- Static methods are borrowed to verify receiver independence. */

import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { createSiblingWindow } from '../../support/windows';

describe('WebAssembly Module custom sections', () => {
  it('returns matching payloads in section order, excluding headers, names, and other sections', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      return ['meta', '', 'absent'].map((name) => WebAssembly.Module.customSections(module, name)
        .map((buffer) => Array.from(new Uint8Array(buffer))));
    }, sectionsBytes)).toEqual([[[1, 2], [], longPayload], [[9]], []]);
  });

  it('returns fresh empty arrays for a module without custom sections', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const module = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
      const first = WebAssembly.Module.customSections(module, '');
      const second = WebAssembly.Module.customSections(module, '');
      return first.length === 0 && second.length === 0 && first !== second;
    })).toBe(true);
  });

  it('matches decoded UTF-8 names exactly without normalization or surrogate replacement', async () => {
    const browser = fixture();
    const names = ['méta💡', 'MéTa💡', '\uFEFFmeta', 'é', 'e\u0301', '\0', '\uFFFD', '\uD800'];
    const bytes = [
      ...emptyModule,
      ...section('méta💡', [1]), ...section('\uFEFFmeta', [2]), ...section('é', [3]),
      ...section('e\u0301', [4]), ...section('\0', [5]), ...section('\uFFFD', [6]),
    ];
    expect(await browser.evaluate(({ bytes, names }) => {
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      return names.map((name) => WebAssembly.Module.customSections(module, name)
        .map((buffer) => Array.from(new Uint8Array(buffer))));
    }, { bytes, names })).toEqual([[[1]], [], [[2]], [[3]], [[4]], [[5]], [[6]], []]);
  });

  it('copies payloads into independent fixed-length buffers on every call', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const source = new Uint8Array(bytes);
      const module = new WebAssembly.Module(source);
      const first = WebAssembly.Module.customSections(module, 'meta');
      new Uint8Array(first[0]!).fill(0);
      source.fill(0);
      const second = WebAssembly.Module.customSections(module, 'meta');
      return {
        fresh: first !== second && first.every((buffer, i) => buffer !== second[i]),
        fixed: second.every((buffer) => !buffer.resizable && buffer.maxByteLength === buffer.byteLength),
        bytes: second.map((buffer) => Array.from(new Uint8Array(buffer))),
      };
    }, sectionsBytes)).toEqual({ fresh: true, fixed: true, bytes: [[1, 2], [], longPayload] });
  });

  it('allocates arrays and buffers in the invoked function realm, ignoring its receiver', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      const receiver = new Proxy({}, { get() { throw new Error('Static receiver was read'); } });
      const result = Reflect.apply(foreign.WebAssembly.Module.customSections, receiver, [module, 'meta']);
      return {
        array: Object.getPrototypeOf(result) === foreign.Array.prototype,
        buffers: result.every((buffer) => Object.getPrototypeOf(buffer) === foreign.ArrayBuffer.prototype),
        extensible: Object.isExtensible(result) && result.every((buffer) => Object.isExtensible(buffer)),
        namespaceOnly: !Object.hasOwn(globalThis, 'Module') && !Object.hasOwn(foreign, 'Module'),
      };
    }, sectionsBytes)).toEqual({ array: true, buffers: true, extensible: true, namespaceOnly: true });
  });

  it('converts an explicitly supplied undefined section name to a string', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      const result = Reflect.apply(WebAssembly.Module.customSections, null, [module, undefined]) as ArrayBuffer[];
      return result.map((buffer) => Array.from(new Uint8Array(buffer)));
    }, undefinedSection)).toEqual([[42]]);
  });

  it('converts names with the string hint and propagates author conversion exceptions', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      const trace: string[] = [];
      const name = { [Symbol.toPrimitive](hint: string) { trace.push(hint); return 'undefined'; } };
      const result = Reflect.apply(WebAssembly.Module.customSections, null, [module, name]) as ArrayBuffer[];
      const marker = new Error('conversion');
      let preserved = false;
      try {
        Reflect.apply(WebAssembly.Module.customSections, null, [module, { toString() { throw marker; } }]);
      } catch (error) { preserved = error === marker; }
      return { trace, bytes: result.map((buffer) => Array.from(new Uint8Array(buffer))), preserved };
    }, undefinedSection)).toEqual({ trace: ['string'], bytes: [[42]], preserved: true });
  });

  it('checks Module identity before converting the name and uses the invoked realm for TypeErrors', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      const read = foreign.WebAssembly.Module.customSections;
      const fail = (): never => { throw new Error('Author code ran'); };
      Object.defineProperty(module, 'constructor', { get: fail });
      Object.setPrototypeOf(module, new Proxy({}, { get: fail, getPrototypeOf: fail }));
      Object.freeze(module);
      if (read(module, 'meta').length !== 3) return false;
      const invalid: unknown[] = [undefined, null, 1, {}, Object.create(WebAssembly.Module.prototype), new Proxy(module, {})];
      const name = { toString: fail };
      const calls = [[], [module], [module, Symbol()], ...invalid.map((value) => [value, name])];
      return calls.every((args) => {
        try { Reflect.apply(read, undefined, args); }
        catch (error) { return error instanceof foreign.TypeError; }
        return false;
      });
    }, sectionsBytes)).toBe(true);
  });

  it('keeps captured native reading and allocation when public properties are replaced', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      const read = WebAssembly.Module.customSections;
      const bufferPrototype = ArrayBuffer.prototype;
      const arrayPrototype = Array.prototype;
      const fail = (): never => { throw new Error('Public replacement ran'); };
      Reflect.set(WebAssembly.Module, 'customSections', fail);
      Reflect.set(WebAssembly, 'Module', fail);
      Reflect.set(globalThis, 'ArrayBuffer', fail);
      Reflect.set(globalThis, 'Array', fail);
      const result = read(module, 'meta');
      return Object.getPrototypeOf(result) === arrayPrototype && result.length === 3 &&
        result.every((buffer) => Object.getPrototypeOf(buffer) === bufferPrototype);
    }, sectionsBytes)).toBe(true);
  });

  it('installs the static operation with its Web IDL function and property descriptors', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const read = WebAssembly.Module.customSections;
      const descriptor = Object.getOwnPropertyDescriptor(WebAssembly.Module, 'customSections')!;
      let constructible = true;
      try { Reflect.construct(read, []); }
      catch (error) { if (error instanceof TypeError) constructible = false; else throw error; }
      return {
        name: read.name, length: read.length,
        enumerable: descriptor.enumerable, configurable: descriptor.configurable, writable: descriptor.writable,
        hasPrototype: Object.hasOwn(read, 'prototype'), constructible,
      };
    })).toEqual({
      name: 'customSections', length: 2, enumerable: true, configurable: true, writable: true,
      hasPrototype: false, constructible: false,
    });
  });
});

function fixture(): Browlet {
  const browser = new Browlet({ route: () => '', reporting: false });
  Reflect.set(browser.window, 'foreign', createSiblingWindow(browser));
  return browser;
}

function section(name: string, bytes: number[]): number[] {
  const encoded = Array.from(new TextEncoder().encode(name));
  const payload = [...u32(encoded.length), ...encoded, ...bytes];
  return [0, ...u32(payload.length), ...payload];
}

function u32(value: number): number[] {
  const bytes: number[] = [];
  do {
    const byte = value & 0x7f;
    value >>>= 7;
    bytes.push(byte | (value ? 0x80 : 0));
  } while (value);
  return bytes;
}

const emptyModule = [0, 97, 115, 109, 1, 0, 0, 0];
const longPayload = Array.from({ length: 140 }, (_, index) => index);
const sectionsBytes = [
  ...emptyModule,
  ...section('meta', [1, 2]),
  1, 1, 0, // An ordinary, empty type section between custom sections.
  ...section('', [9]), ...section('meta', []), ...section('other', [8]), ...section('meta', longPayload),
];

// (module (@custom "undefined" "\2a"))
const undefinedSection = [
  0, 97, 115, 109, 1, 0, 0, 0,
  0, 11, 9, 117, 110, 100, 101, 102, 105, 110, 101, 100, 42,
];
