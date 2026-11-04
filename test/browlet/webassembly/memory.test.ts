/* eslint-disable @typescript-eslint/unbound-method -- These tests borrow native accessors and methods with explicit receivers. */
import { describe, expect, it } from 'vitest';
import { itPassesWith } from '../../test-runtime';

import { WasmMemoryImpl } from '../../../src/browlet/webassembly/index';
import { Browlet } from '../../../src/browlet/browlet';
import { isWebAssemblyMemory } from '../../../src/js-engine/index';
import { getPlatformRecord, PlatformRecordSource } from '../../../src/web-idl/values/platform';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

// WebAssembly JavaScript API §5.3, including buffer refresh and HostResizeArrayBuffer.
describe('WebAssembly Memory', () => {
  it('converts the whole descriptor before prototype lookup and numeric size conversion', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const trace: string[] = [];
      const descriptor = {
        get address() { trace.push('address'); return 'i32'; },
        get initial() { trace.push('initial'); return { valueOf() { trace.push('initial value'); return 0; } }; },
        get maximum() { trace.push('maximum'); return { valueOf() { trace.push('maximum value'); return 1; } }; },
        get shared() { trace.push('shared'); return false; },
      };
      const target = new Proxy(function Target() {}, {
        get(target, key, receiver) {
          if (key === 'prototype') trace.push('prototype');
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
      Reflect.construct(WebAssembly.Memory, [descriptor], target);
      return trace;
    })).toEqual(['address', 'initial', 'maximum', 'shared', 'prototype', 'initial value', 'maximum value']);
  });

  it('rejects invalid dictionaries, missing initial values, and bad address enums before prototype lookup', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const results = [];
      for (const descriptor of [undefined, null, 1, {}, { initial: undefined }, { address: 'bad', initial: 0 }]) {
        let reads = 0;
        const target = new Proxy(function Target() {}, {
          get(target, key, receiver) {
            if (key === 'prototype') reads++;
            return Reflect.get(target, key, receiver) as unknown;
          },
        });
        try { Reflect.construct(WebAssembly.Memory, [descriptor], target); results.push([false, reads]); }
        catch (error) { results.push([error instanceof TypeError, reads]); }
      }
      return results;
    })).toEqual(Array.from({ length: 6 }, () => [true, 0]));
  });

  it('preserves descriptor exceptions and uses the invoked realm for size and shared-memory errors', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const marker = new Error('author descriptor');
      let original = false;
      try { new foreign.WebAssembly.Memory({ get initial(): never { throw marker; } }); }
      catch (error) { original = error === marker; }
      const cases = [
        [{ initial: -1 }, foreign.TypeError],
        [{ initial: 2, maximum: 1 }, foreign.RangeError],
        [{ initial: 0, maximum: 65537 }, foreign.RangeError],
        [{ initial: 0, shared: true }, foreign.TypeError],
      ] as const;
      const errors = cases.map(([descriptor, expected]) => {
        try { new foreign.WebAssembly.Memory(descriptor); }
        catch (error) { return error instanceof expected; }
        return false;
      });
      return { original, errors };
    })).toEqual({ original: true, errors: [true, true, true, true] });
  });

  it('retains subclassing and constructor ownership despite a foreign prototype or public replacement', async () => {
    const browser = fixture();
    const foreignRealm = getRelevantRealm(Reflect.get(browser.window, 'foreign') as object);
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const Memory = foreign.WebAssembly.Memory;
      class Derived extends Memory {}
      Reflect.set(foreign.WebAssembly, 'Memory', function Replaced() { throw new Error('replacement'); });
      const derived = new Derived({ initial: 0, maximum: 1 });
      const memory = Reflect.construct(Memory, [{ initial: 0 }], WebAssembly.Memory);
      Reflect.set(globalThis, 'nativeMemory', Object.freeze(memory));
      return { subclass: derived instanceof Derived && derived instanceof Memory, grown: derived.grow(1) };
    })).toEqual({ subclass: true, grown: 0 });
    const memory = Reflect.get(browser.window, 'nativeMemory') as object;
    const record = getPlatformRecord(memory, PlatformRecordSource.Platform);
    expect(record).toBeDefined();
    expect(record!.realm).toBe(foreignRealm);
    expect(record!.implInst).toBeInstanceOf(WasmMemoryImpl);
    expect(record!.implInst).not.toBe(memory);
    expect(record!.platformObject).toBe(memory);
    expect(Reflect.ownKeys(memory)).toEqual([]);
  });

  it('recognizes native Memory objects without author properties, even after freezing or prototype changes', async () => {
    const browser = fixture();
    await browser.evaluate(() => {
      const memory = new WebAssembly.Memory({ initial: 0 });
      Object.defineProperty(memory, 'buffer', { get() { throw new Error('Author buffer getter'); } });
      Object.setPrototypeOf(memory, null);
      Reflect.set(globalThis, 'nativeMemory', Object.freeze(memory));
    });
    const memory = Reflect.get(browser.window, 'nativeMemory') as object;
    expect(isWebAssemblyMemory(memory)).toBe(false);
    expect(isWebAssemblyMemory((getPlatformRecord(memory, PlatformRecordSource.Platform)!.implInst as unknown as WasmMemoryImpl).getBacking())).toBe(true);
    expect(isWebAssemblyMemory(new WebAssembly.Memory({ initial: 0 }))).toBe(true);
    for (const value of [undefined, null, 42, {}, Object.create(memory), new Proxy(memory, {})]) {
      expect(isWebAssemblyMemory(value)).toBe(false);
    }
  });

  it('recognizes an external Memory without allocating its buffer in the inspecting realm', async () => {
    const browser = fixture();
    const realm = getRelevantRealm(browser.window);
    // Use the retained constructor to exercise native values created outside our constructor adapter.
    const memory = Reflect.construct(realm.WebAssemblyMemory, [{ initial: 0 }]) as object;
    expect(isWebAssemblyMemory(memory)).toBe(true);
    Reflect.set(browser.window, 'nativeMemory', memory);
    expect(await browser.evaluate(() => {
      const memory = Reflect.get(globalThis, 'nativeMemory') as WebAssembly.Memory;
      return Object.getPrototypeOf(memory.buffer) === ArrayBuffer.prototype;
    })).toBe(true);
  });

  it('creates the first buffer in the constructor realm before a foreign getter can observe it', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const memory = new WebAssembly.Memory({ initial: 0 });
      const getter = Object.getOwnPropertyDescriptor(foreign.WebAssembly.Memory.prototype, 'buffer')!.get!;
      const buffer = Reflect.apply(getter, memory, []) as ArrayBuffer;
      return Object.getPrototypeOf(buffer) === ArrayBuffer.prototype && buffer === memory.buffer;
    })).toBe(true);
  });

  it('refreshes fixed buffers on successful growth, including zero, and preserves them on failure', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
      const first = memory.buffer;
      const initial = new Uint8Array(first).every((value) => value === 0);
      new Uint8Array(first)[0] = 42;
      const grown = memory.grow(1);
      const second = memory.buffer;
      const beforeZero = [first.byteLength, second.byteLength, new Uint8Array(second)[0], new Uint8Array(second)[65536]];
      const zero = memory.grow(0);
      const third = memory.buffer;
      let rangeError = false;
      try { memory.grow(1); } catch (error) { rangeError = error instanceof RangeError; }
      return {
        initial, grown, beforeZero, zero, detached: second.byteLength,
        stable: memory.buffer === third, bytes: third.byteLength, rangeError,
      };
    })).toEqual({
      initial: true, grown: 1, beforeZero: [0, 131072, 42, 0], zero: 2, detached: 0,
      stable: true, bytes: 131072, rangeError: true,
    });
  });

  it('uses BigInt sizes for i64 memories and rejects the wrong numeric kind', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      // lib.dom still types Memory sizes as numbers; the native i64 API accepts and returns BigInt.
      const memory = Reflect.construct(WebAssembly.Memory, [{ address: 'i64', initial: 0n, maximum: 1n }]) as WebAssembly.Memory;
      const previous: unknown = Reflect.apply(memory.grow, memory, [1n]);
      let typeError = false;
      try { memory.grow(0); } catch (error) { typeError = error instanceof TypeError; }
      return { previous: String(previous), kind: typeof previous, bytes: memory.buffer.byteLength, typeError };
    })).toEqual({ previous: '0', kind: 'bigint', bytes: 65536, typeError: true });
  });

  it('refreshes the JavaScript buffer after Wasm memory.grow and keeps it after failed Wasm growth', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
      const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source)), { env: { memory } });
      const grow = instance.exports.grow as (delta: number) => number;
      const first = memory.buffer;
      const previous = grow(1);
      const second = memory.buffer;
      const failed = grow(1);
      return { previous, detached: first.byteLength, bytes: second.byteLength, failed, stable: memory.buffer === second };
    }, growModule)).toEqual({ previous: 1, detached: 0, bytes: 131072, failed: -1, stable: true });
  });

  it('preserves shared backing storage without detaching older shared buffers', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true });
      const first = memory.buffer;
      const oldView = new Uint8Array(first);
      memory.grow(1);
      const second = memory.buffer;
      new Uint8Array(second)[0] = 42;
      return {
        shared: Object.prototype.toString.call(first),
        lengths: [first.byteLength, second.byteLength], sameStorage: oldView[0],
        replaced: first !== second, stable: second === memory.buffer,
      };
    })).toEqual({ shared: '[object SharedArrayBuffer]', lengths: [65536, 131072], sameStorage: 42, replaced: true, stable: true });
  });

  it('keeps native member brand checks and cross-realm receivers', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const memory = new WebAssembly.Memory({ initial: 0 });
      const getter = Object.getOwnPropertyDescriptor(foreign.WebAssembly.Memory.prototype, 'buffer')!.get!;
      const grow = foreign.WebAssembly.Memory.prototype.grow;
      const buffer = memory.buffer;
      Object.setPrototypeOf(memory, null);
      const valid = Reflect.apply(getter, memory, []) === buffer;
      const rejected = [{}, Object.create(foreign.WebAssembly.Memory.prototype), new Proxy(memory, {})].every((value) => {
        try { Reflect.apply(grow, value, [0]); }
        catch (error) { return error instanceof foreign.TypeError; }
        return false;
      });
      return { valid, rejected };
    })).toEqual({ valid: true, rejected: true });
  });

  // Node 24 lacks both buffer-conversion methods; the approved availability gap retains these assertions.
  itPassesWith('v26+')('returns the retained fixed buffer and prevents author detachment', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
      const buffer = memory.toFixedLengthBuffer();
      let blocked = false;
      try { buffer.transfer(); } catch (error) { blocked = error instanceof TypeError; }
      return { same: buffer === memory.buffer, retained: memory.toFixedLengthBuffer() === buffer, blocked, bytes: buffer.byteLength };
    })).toEqual({ same: true, retained: true, blocked: true, bytes: 65536 });
  });

  itPassesWith('v26+')('switches buffer modes and applies page-aligned growth through ArrayBuffer.resize', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 3 });
      const fixed = memory.buffer;
      new Uint8Array(fixed)[0] = 42;
      const buffer = memory.toResizableBuffer();
      const first = [fixed.byteLength, buffer.byteLength, buffer.maxByteLength, buffer.resizable];
      const retained = memory.toResizableBuffer() === buffer;
      memory.grow(1);
      buffer.resize(196608);
      const resized = [memory.grow(0), buffer.byteLength, memory.buffer === buffer, new Uint8Array(buffer)[0]];
      const invalid = [65536, 196609].map((size) => {
        try { buffer.resize(size); } catch (error) { return error instanceof RangeError; }
        return false;
      });
      let needsMaximum = false;
      try { new WebAssembly.Memory({ initial: 0 }).toResizableBuffer(); }
      catch (error) { needsMaximum = error instanceof TypeError; }
      const final = memory.toFixedLengthBuffer();
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const other = new foreign.WebAssembly.Memory({ initial: 0, maximum: 1 });
      const resizable = Reflect.apply(WebAssembly.Memory.prototype.toResizableBuffer, other, []);
      const fixedAgain = Reflect.apply(WebAssembly.Memory.prototype.toFixedLengthBuffer, other, []);
      const borrowed = [resizable, fixedAgain].every((value) => Object.getPrototypeOf(value) === ArrayBuffer.prototype);
      return { first, retained, resized, invalid, needsMaximum, borrowed, detached: buffer.byteLength, final: [final.byteLength, final.resizable] };
    })).toEqual({
      first: [0, 65536, 196608, true], retained: true, resized: [3, 196608, true, 42],
      invalid: [true, true], needsMaximum: true, borrowed: true, detached: 0, final: [196608, false],
    });
  });
});

function fixture(): Browlet {
  const browser = new Browlet({ route: () => '', reporting: false });
  Reflect.set(browser.window, 'foreign', createSiblingWindow(browser));
  return browser;
}

// (module (import "env" "memory" (memory 1 2))
//   (func (export "grow") (param i32) (result i32) (memory.grow (local.get 0))))
const growModule = [
  0, 97, 115, 109, 1, 0, 0, 0, 1, 6, 1, 96, 1, 127, 1, 127,
  2, 16, 1, 3, 101, 110, 118, 6, 109, 101, 109, 111, 114, 121, 2, 1, 1, 2,
  3, 2, 1, 0, 7, 8, 1, 4, 103, 114, 111, 119, 0, 0, 10, 8, 1, 6, 0, 32, 0, 64, 0, 11,
];
