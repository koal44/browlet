import { describe, expect, it } from 'vitest';

import { isWebAssemblyModule } from '../../../src/js-engine/index';
import { getPlatformRecord, PlatformRecordSource } from '../../../src/web-idl/values/platform';
import { Browlet } from '../../../src/browlet/browlet';
import { browletBindingWorld } from '../../../src/browlet/integration/web-idl/index';

describe('WebAssembly Module implementation and platform boundary', () => {
  it.each(['construct', 'compile', 'clone'] as const)('%s keeps the native backing behind an implementation', async (operation) => {
    const browser = new Browlet({ route: () => '', reporting: false });
    await browser.evaluate(async ({ bytes, operation }) => {
      const module = operation === 'compile' ? await WebAssembly.compile(new Uint8Array(bytes))
        : operation === 'clone' ? structuredClone(new WebAssembly.Module(new Uint8Array(bytes)))
          : new WebAssembly.Module(new Uint8Array(bytes));
      Reflect.set(globalThis, 'module', module);
    }, { bytes: emptyModule, operation });
    const platform = Reflect.get(browser.window, 'module') as object;
    const record = getPlatformRecord(platform, PlatformRecordSource.Platform)!;
    expect(record).toBeDefined();
    expect(record.implInst).not.toBe(platform);
    expect(isWebAssemblyModule(platform)).toBe(false);
    expect(isWebAssemblyModule(record.implInst)).toBe(false);
    expect(getPlatformRecord(record.implInst, PlatformRecordSource.Implementation)).toBe(record);
    expect(getPlatformRecord(platform, PlatformRecordSource.Implementation)).toBeUndefined();
    expect(browletBindingWorld.unwrap(platform)).toBe(record.implInst);
    expect(browletBindingWorld.project(record.implInst)).toBe(platform);
    expect(Object.hasOwn(record.assembled.primary, 'interfaceOverride')).toBe(false);
    expect(Reflect.ownKeys(platform)).toEqual([]);
  });

  it('converts metadata results through the declared Web IDL dictionaries', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate((bytes) => {
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      return Object.keys(WebAssembly.Module.imports(module)[0]!);
    }, importModule)).toEqual(['kind', 'module', 'name']);
  });

  it.each([
    ['compile', 'Object'], ['compile', 'module source'],
    ['compileStreaming', 'Object'], ['compileStreaming', 'module source'],
  ] as const)('%s exposes only the platform Module to an inherited %s then getter', async (operation, parent) => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate(async ({ bytes, operation, parent }) => {
      const seen: object[] = [];
      const prototype = parent === 'Object' ? Object.prototype : Object.getPrototypeOf(WebAssembly.Module.prototype) as object;
      Object.defineProperty(prototype, 'then', {
        configurable: true,
        get() {
          if (Object.prototype.toString.call(this) === '[object WebAssembly.Module]') seen.push(this as object);
          return undefined;
        },
      });
      try {
        const source = new Uint8Array(bytes);
        const module = operation === 'compile' ? await WebAssembly.compile(source) :
          await WebAssembly.compileStreaming(new Response(source, { headers: { 'Content-Type': 'application/wasm' } }));
        return { publicResult: seen.map((value) => value === module), usable: WebAssembly.Module.exports(module) };
      } finally {
        Reflect.deleteProperty(prototype, 'then');
      }
    }, { bytes: emptyModule, operation, parent })).toEqual({ publicResult: [true], usable: [] });
  });
});

const emptyModule = [0, 97, 115, 109, 1, 0, 0, 0];
// (module (import "env" "log" (func)))
const importModule = [...emptyModule, 1, 4, 1, 96, 0, 0, 2, 11, 1, 3, 101, 110, 118, 3, 108, 111, 103, 0, 0];
