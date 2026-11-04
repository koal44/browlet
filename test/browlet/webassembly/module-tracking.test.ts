import { describe, expect, it } from 'vitest';

import { addon } from '../../../src/js-engine/index';
import { reference } from '../../../src/web-idl/core/index';
import { getPlatformRecord, PlatformRecordSource } from '../../../src/web-idl/values/platform';
import { Browlet } from '../../../src/browlet/browlet';
import { browletBindingWorld } from '../../../src/browlet/integration/web-idl/index';
import { BrowsingContext, createDocumentState, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { getBindingContext, getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

describe('native Module binding records', () => {
  it('records construction ownership before a foreign prototype can disguise it', async () => {
    const { browser, context, foreignRealm } = fixture();
    await browser.evaluate((source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const module = Reflect.construct(foreign.WebAssembly.Module, [new Uint8Array(source)], WebAssembly.Module);
      Reflect.set(globalThis, 'nativeModule', Object.freeze(module));
    }, emptyModule);
    const module = Reflect.get(browser.window, 'nativeModule') as WebAssembly.Module;
    const record = getPlatformRecord(module, PlatformRecordSource.Platform);
    expect(record).toBeDefined();
    expect(record).toBe(getPlatformRecord(module, PlatformRecordSource.Implementation));
    expect(record!.realm).toBe(foreignRealm);
    expect(record!.implInst).toBe(module);
    expect(record!.platformObject).toBe(module);
    expect(record!.project()).toBe(module);
    expect(context.getPlatformRecord(module, PlatformRecordSource.Platform)).toBe(record);
    expect(browletBindingWorld.unwrap(module)).toBe(module);
    expect(browletBindingWorld.project(module)).toBe(module);
    expect(Reflect.ownKeys(module)).toEqual([]);
    expect(WebAssembly.Module.exports(module)).toEqual([]);
  });

  it.each(['input', 'output', 'association', 'unwrap', 'project'] as const)(
    'associates a frozen compiled Module on its first %s boundary', async (boundary) => {
      const { browser, context, foreignRealm } = fixture();
      await browser.evaluate(async (source) => {
        const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
        const module = await foreign.WebAssembly.compile(new Uint8Array(source));
        Object.setPrototypeOf(module, null);
        Reflect.set(globalThis, 'nativeModule', Object.freeze(module));
      }, emptyModule);
      const value = Reflect.get(browser.window, 'nativeModule') as WebAssembly.Module;
      expect(getPlatformRecord(value, PlatformRecordSource.Platform)).toBeUndefined();
      expect(context.getPlatformRecord(value, PlatformRecordSource.Stamped)).toBeUndefined();
      expect(browletBindingWorld.getRealm(value)).toBeUndefined();
      switch (boundary) {
        case 'input': expect(context.jsToImpl(value, reference('Module'))).toBe(value); break;
        case 'output': expect(context.implToJS(value, reference('Module'))).toBe(value); break;
        case 'association': context.getOrCreatePlatformRecord(value); break;
        case 'unwrap': expect(browletBindingWorld.unwrap(value)).toBe(addon.getRealm ? value : undefined); break;
        case 'project': expect(browletBindingWorld.project(value)).toBe(addon.getRealm ? value : undefined); break;
      }
      const record = getPlatformRecord(value, PlatformRecordSource.Platform);
      // Stock Node has no exact creation-realm lookup for an untracked native result.
      if (addon.getRealm) {
        expect(record).toBeDefined();
        expect(record!.realm).toBe(foreignRealm);
        expect(browletBindingWorld.getRealm(value)).toBe(foreignRealm);
        expect(record!.implInst).toBe(value);
        expect(record!.platformObject).toBe(value);
        expect(record!.project()).toBe(value);
        expect(context.getPlatformRecord(value, PlatformRecordSource.Platform)).toBe(record);
        expect(getBindingContext(foreignRealm).getPlatformRecord(value, PlatformRecordSource.Platform)).toBe(record);
        expect(getPlatformRecord(value, PlatformRecordSource.Implementation)).toBe(record);
      } else {
        expect(record).toBeUndefined();
        expect(context.getPlatformRecord(value, PlatformRecordSource.Platform)).toBeUndefined();
      }
      expect(Object.getPrototypeOf(value)).toBeNull();
      expect(Object.isFrozen(value)).toBe(true);
      expect(Reflect.ownKeys(value)).toEqual([]);
      expect(WebAssembly.Module.exports(value)).toEqual([]);
    },
  );

  it('never records the active caller as a compiled Module\'s owner', async () => {
    const { browser, context, foreignRealm } = fixture();
    Reflect.set(browser.window, 'inspectNative', (value: object) => {
      const record = context.getOrCreatePlatformRecord(value);
      return record ? record.realm === foreignRealm ? 'original' : 'caller' : 'unknown';
    });
    expect(await browser.evaluate(async (source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const module = await foreign.WebAssembly.compile(new Uint8Array(source));
      Object.setPrototypeOf(module, WebAssembly.Module.prototype);
      const inspect = Reflect.get(globalThis, 'inspectNative') as (value: object) => string;
      return inspect(module);
    }, emptyModule)).toBe(addon.getRealm ? 'original' : 'unknown');
  });

  it('accepts Modules from unregistered realms without inventing an owner', () => {
    const { context } = fixture();
    const module = Object.freeze(new WebAssembly.Module(new Uint8Array(emptyModule)));
    expect(context.jsToImpl(module, reference('Module'))).toBe(module);
    expect(context.implToJS(module, reference('Module'))).toBe(module);
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
      expect(context.getOrCreatePlatformRecord(value)).toBeUndefined();
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
  new TopLevelTraversable(createDocumentState(document));
  Reflect.set(browser.window, 'foreign', foreign);
  return { browser, context, foreignRealm };
}

const emptyModule = [0, 97, 115, 109, 1, 0, 0, 0];
