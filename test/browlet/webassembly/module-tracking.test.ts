import { describe, expect, it } from 'vitest';

import { reference } from '../../../src/web-idl/core/index';
import { getPlatformRecord, PlatformRecordSource } from '../../../src/web-idl/values/platform';
import { WasmModuleImpl } from '../../../src/browlet/webassembly/index';
import { Browlet } from '../../../src/browlet/browlet';
import { browletBindingWorld } from '../../../src/browlet/integration/web-idl/index';
import { BrowsingContext, createDocumentState, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { getBindingContext, getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

describe('Module implementation and platform records', () => {
  it('records construction ownership before a foreign prototype can disguise it', async () => {
    const { browser, context, foreignRealm } = fixture();
    await browser.evaluate((source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const module = Reflect.construct(foreign.WebAssembly.Module, [new Uint8Array(source)], WebAssembly.Module);
      Reflect.set(globalThis, 'nativeModule', Object.freeze(module));
    }, emptyModule);
    const module = Reflect.get(browser.window, 'nativeModule') as WebAssembly.Module;
    const record = getPlatformRecord(module, PlatformRecordSource.Platform);
    const implementation = context.jsToImpl(module, reference(WasmModuleImpl));
    expect(record).toBeDefined();
    expect(getPlatformRecord(module, PlatformRecordSource.Implementation)).toBeUndefined();
    expect(record).toBe(getPlatformRecord(record!.implInst, PlatformRecordSource.Implementation));
    expect(record!.realm).toBe(foreignRealm);
    expect(record!.implInst).toBeInstanceOf(WasmModuleImpl);
    expect(record!.platformObject).toBe(module);
    expect(record!.project()).toBe(module);
    expect(context.getPlatformRecord(module, PlatformRecordSource.Platform)).toBe(record);
    expect(browletBindingWorld.unwrap(module)).toBe(record!.implInst);
    expect(browletBindingWorld.project(record!.implInst)).toBe(module);
    expect(Reflect.ownKeys(module)).toEqual([]);
    expect(implementation.exports(context.getEnvironment())).toEqual([]);
  });

  it.each(['input', 'output', 'lookup', 'unwrap', 'project', 'realm'] as const)(
    'preserves the original record of a frozen compiled Module at the %s boundary', async (boundary) => {
      const { browser, context, foreignRealm } = fixture();
      await browser.evaluate(async (source) => {
        const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
        const module = await foreign.WebAssembly.compile(new Uint8Array(source));
        Object.setPrototypeOf(module, null);
        Reflect.set(globalThis, 'nativeModule', Object.freeze(module));
      }, emptyModule);
      const value = Reflect.get(browser.window, 'nativeModule') as WebAssembly.Module;
      const record = getPlatformRecord(value, PlatformRecordSource.Platform)!;
      expect(record).toBeDefined();
      const implementation = context.jsToImpl(value, reference(WasmModuleImpl));
      expect(record.implInst).toBe(implementation);
      switch (boundary) {
        case 'input': expect(context.jsToImpl(value, reference(WasmModuleImpl))).toBe(implementation); break;
        case 'output': expect(context.implToJS(implementation, reference(WasmModuleImpl))).toBe(value); break;
        case 'lookup': expect(context.getPlatformRecord(value, PlatformRecordSource.Platform)).toBe(record); break;
        case 'unwrap': expect(browletBindingWorld.unwrap(value)).toBe(implementation); break;
        case 'project': expect(browletBindingWorld.project(implementation)).toBe(value); break;
        case 'realm': expect(browletBindingWorld.getRealm(value)).toBe(foreignRealm); break;
      }
      expect(record.realm).toBe(foreignRealm);
      expect(record.platformObject).toBe(value);
      expect(record.project()).toBe(value);
      expect(getBindingContext(foreignRealm).getPlatformRecord(value, PlatformRecordSource.Platform)).toBe(record);
      expect(getPlatformRecord(implementation, PlatformRecordSource.Implementation)).toBe(record);
      expect(getPlatformRecord(value, PlatformRecordSource.Implementation)).toBeUndefined();
      expect(Object.getPrototypeOf(value)).toBeNull();
      expect(Object.isFrozen(value)).toBe(true);
      expect(Reflect.ownKeys(value)).toEqual([]);
      expect(implementation.exports(context.getEnvironment())).toEqual([]);
    },
  );

  it('never records the active caller as a compiled Module\'s owner', async () => {
    const { browser, context, foreignRealm } = fixture();
    Reflect.set(browser.window, 'inspectNative', (value: object) => {
      const record = context.getPlatformRecord(value, PlatformRecordSource.Platform);
      return record ? record.realm === foreignRealm ? 'original' : 'caller' : 'unknown';
    });
    expect(await browser.evaluate(async (source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const module = await foreign.WebAssembly.compile(new Uint8Array(source));
      Object.setPrototypeOf(module, WebAssembly.Module.prototype);
      const inspect = Reflect.get(globalThis, 'inspectNative') as (value: object) => string;
      return inspect(module);
    }, emptyModule)).toBe('original');
  });

  it('requires a platform Module instead of silently adopting a raw engine object', () => {
    const { context } = fixture();
    const module = Object.freeze(new WebAssembly.Module(new Uint8Array(emptyModule)));
    expect(() => context.jsToImpl(module, reference(WasmModuleImpl))).toThrow();
    expect(() => context.implToJS(module, reference(WasmModuleImpl))).toThrow();
    expect(context.getPlatformRecord(module, PlatformRecordSource.Platform)).toBeUndefined();
    expect(getPlatformRecord(module, PlatformRecordSource.Platform)).toBeUndefined();
    expect(getPlatformRecord(module, PlatformRecordSource.Implementation)).toBeUndefined();
  });

  it('does not associate lookalikes or inspect author prototypes to find an owner', () => {
    const { context } = fixture();
    const lookalike = Object.create(WebAssembly.Module.prototype) as object;
    let traps = 0;
    const proxy = new Proxy(new WebAssembly.Module(new Uint8Array(emptyModule)), {
      getPrototypeOf() { traps++; throw new Error('Do not inspect author prototypes'); },
      get() { traps++; throw new Error('Do not inspect author properties'); },
    });
    for (const value of [lookalike, proxy]) {
      expect(context.getPlatformRecord(value, PlatformRecordSource.Platform)).toBeUndefined();
      expect(() => context.jsToImpl(value, reference('Module'))).toThrow();
      expect(getPlatformRecord(value, PlatformRecordSource.Platform)).toBeUndefined();
    }
    expect(traps).toBe(0);
  });
});

function fixture() {
  const browser = new Browlet({ route: () => '', reporting: false });
  const context = getBindingContext(getRelevantRealm(browser.window));
  const foreign = createSiblingWindow(browser);
  const foreignRealm = getRelevantRealm(foreign);
  const document = foreignRealm.getAssociatedDocument();
  document.browsingContext = new BrowsingContext(foreignRealm.windowProxy);
  document.makeActive();
  new TopLevelTraversable(createDocumentState(document));
  Reflect.set(browser.window, 'foreign', foreign);
  return { browser, context, foreignRealm };
}

const emptyModule = [0, 97, 115, 109, 1, 0, 0, 0];
