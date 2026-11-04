/* eslint-disable @typescript-eslint/unbound-method -- These tests inspect and borrow native getters with explicit receivers. */

import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { JSFunctionWithPrototype, JSMethod } from '../../../src/js-engine/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

// ESM integration §5.1 and its Source Phase Imports §28.1 dependency.
// This covers source-object reflection, not HTML source-phase module loading.
describe('WebAssembly Module source objects', () => {
  it('gives the ordinary Module interface the required AbstractModuleSource parents', async () => {
    const browser = fixture();
    const realm = getRelevantRealm(browser.window);
    const NativeModule = realm.WebAssemblyModule;
    const nativeSource: unknown = Object.getPrototypeOf(NativeModule);
    const PublicModule = Reflect.get(Reflect.get(browser.window, 'WebAssembly'), 'Module');
    expect(PublicModule).not.toBe(NativeModule);
    expect(Object.getPrototypeOf(PublicModule)).toBe(nativeSource);
    expect(PublicModule.prototype).not.toBe(NativeModule.prototype);
    expect(await browser.evaluate(() => {
      const Source = Object.getPrototypeOf(WebAssembly.Module) as JSFunctionWithPrototype;
      return {
        name: Source.name,
        constructorParent: Object.getPrototypeOf(Source) === Function.prototype,
        modulePrototypeParent: Object.getPrototypeOf(WebAssembly.Module.prototype) === Source.prototype,
        sourcePrototypeParent: Object.getPrototypeOf(Source.prototype) === Object.prototype,
        sourceConstructor: Reflect.get(Source.prototype, 'constructor') === Source,
        globalName: 'AbstractModuleSource' in globalThis,
      };
    })).toEqual({
      name: 'AbstractModuleSource', constructorParent: true, modulePrototypeParent: true,
      sourcePrototypeParent: true, sourceConstructor: true, globalName: false,
    });
  });

  it('retains the intrinsic constructor and source-kind accessor descriptors', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const Source = Object.getPrototypeOf(WebAssembly.Module) as JSFunctionWithPrototype;
      const prototype = Object.getOwnPropertyDescriptor(Source, 'prototype')!;
      const constructor = Object.getOwnPropertyDescriptor(Source.prototype, 'constructor')!;
      const tag = Object.getOwnPropertyDescriptor(Source.prototype, Symbol.toStringTag)!;
      return {
        name: Source.name, length: Source.length,
        prototype: [prototype.writable, prototype.enumerable, prototype.configurable],
        constructor: [constructor.writable, constructor.enumerable, constructor.configurable],
        getter: [tag.get!.name, tag.get!.length, tag.set === undefined, tag.enumerable, tag.configurable],
        ownFunction: Object.getPrototypeOf(tag.get) === Function.prototype,
      };
    })).toEqual({
      name: 'AbstractModuleSource', length: 0,
      prototype: [false, false, false], constructor: [true, false, true],
      getter: ['get [Symbol.toStringTag]', 0, true, false, true], ownFunction: true,
    });
  });

  it('rejects direct calls and construction without reading arguments or a newTarget prototype', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const Source = Object.getPrototypeOf(WebAssembly.Module) as JSFunctionWithPrototype;
      const trap = () => { throw new Error('author code ran'); };
      const argument = { [Symbol.toPrimitive]: trap };
      const newTarget = new Proxy(function() {}, { get: trap });
      return [
        () => Reflect.apply(Source, null, [argument]),
        () => { Reflect.construct(Source, [argument]); },
        () => { Reflect.construct(Source, [argument], newTarget); },
      ].map((invoke) => {
        try { invoke(); return false; }
        catch (error) { return error instanceof TypeError; }
      });
    })).toEqual([true, true, true]);
  });

  it('recognizes Modules from constructors, compilation, instantiation, streaming, and cloning', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const Source = Object.getPrototypeOf(WebAssembly.Module) as JSFunctionWithPrototype;
      const getKind = Object.getOwnPropertyDescriptor(Source.prototype, Symbol.toStringTag)!.get as JSMethod;
      const bytes = new Uint8Array(source);
      const compiled = await WebAssembly.compile(bytes);
      const instantiated = await WebAssembly.instantiate(bytes);
      const streamed = await WebAssembly.compileStreaming(new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } }));
      const modules = [new WebAssembly.Module(bytes), compiled, instantiated.module, streamed, structuredClone(compiled)];
      return modules.map((module) => ({
        kind: Reflect.apply(getKind, module, []),
        prototype: Object.getPrototypeOf(Object.getPrototypeOf(module)) === Source.prototype,
        usable: new WebAssembly.Instance(module) instanceof WebAssembly.Instance,
      }));
    }, emptyModule)).toEqual(Array.from({ length: 5 }, () => ({ kind: 'WebAssembly.Module', prototype: true, usable: true })));
  });

  it('uses platform identity rather than author tags or prototype inheritance', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const Source = Object.getPrototypeOf(WebAssembly.Module) as JSFunctionWithPrototype;
      const getKind = Object.getOwnPropertyDescriptor(Source.prototype, Symbol.toStringTag)!.get as JSMethod;
      const module = new WebAssembly.Module(new Uint8Array(source));
      Object.defineProperty(module, Symbol.toStringTag, { get() { throw new Error('author tag was read'); } });
      Object.setPrototypeOf(module, null);
      const kind = Reflect.apply(getKind, module, []);
      const instance = new WebAssembly.Instance(module);
      const fake = Object.create(WebAssembly.Module.prototype) as object;
      return {
        kind, usable: instance instanceof WebAssembly.Instance,
        fakeKind: Reflect.apply(getKind, fake, []),
        fakeDisplayTag: Object.prototype.toString.call(fake),
      };
    }, emptyModule)).toEqual({ kind: 'WebAssembly.Module', usable: true, fakeKind: undefined, fakeDisplayTag: '[object WebAssembly.Module]' });
  });

  it('returns undefined for other values and proxies without invoking author code', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const Source = Object.getPrototypeOf(WebAssembly.Module) as JSFunctionWithPrototype;
      const getKind = Object.getOwnPropertyDescriptor(Source.prototype, Symbol.toStringTag)!.get as JSMethod;
      const module = new WebAssembly.Module(new Uint8Array(source));
      const trap = () => { throw new Error('author code ran'); };
      const revoked = Proxy.revocable(module, {});
      revoked.revoke();
      const values = [
        undefined, null, false, 1, 1n, 'module', Symbol(), {}, () => {},
        new WebAssembly.Instance(module), WebAssembly.Module.prototype, Source.prototype,
        Object.create(module) as object,
        { get [Symbol.toStringTag]() { return trap(); } },
        new Proxy(module, { get: trap, getPrototypeOf: trap, ownKeys: trap }), revoked.proxy,
      ];
      return values.every((value) => Reflect.apply(getKind, value, []) === undefined);
    }, emptyModule)).toBe(true);
  });

  it('keeps intrinsics and errors realm-specific while recognizing foreign and cloned Modules', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const Source = Object.getPrototypeOf(WebAssembly.Module) as JSFunctionWithPrototype;
      const ForeignSource = Object.getPrototypeOf(foreign.WebAssembly.Module) as JSFunctionWithPrototype;
      const getKind = Object.getOwnPropertyDescriptor(Source.prototype, Symbol.toStringTag)!.get as JSMethod;
      const foreignGetKind = Object.getOwnPropertyDescriptor(ForeignSource.prototype, Symbol.toStringTag)!.get as JSMethod;
      const module = new WebAssembly.Module(new Uint8Array(source));
      const other = new foreign.WebAssembly.Module(new Uint8Array(source));
      const clone = foreign.structuredClone(module);
      let ownError = false;
      try { Reflect.apply(ForeignSource, null, []); }
      catch (error) { ownError = error instanceof foreign.TypeError && !(error instanceof TypeError); }
      return {
        distinct: Source !== ForeignSource && Source.prototype !== ForeignSource.prototype,
        ownParent: Object.getPrototypeOf(ForeignSource) === foreign.Function.prototype,
        ownPrototype: Object.getPrototypeOf(ForeignSource.prototype) === foreign.Object.prototype,
        foreignModule: Reflect.apply(getKind, other, []),
        localModule: Reflect.apply(foreignGetKind, module, []),
        clone: Reflect.apply(getKind, clone, []),
        clonePrototype: Object.getPrototypeOf(Object.getPrototypeOf(clone)) === ForeignSource.prototype,
        ownError,
      };
    }, emptyModule)).toEqual({
      distinct: true, ownParent: true, ownPrototype: true,
      foreignModule: 'WebAssembly.Module', localModule: 'WebAssembly.Module', clone: 'WebAssembly.Module',
      clonePrototype: true, ownError: true,
    });
  });

  it('retains source identity for subclass instances without invoking the abstract constructor', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const Source = Object.getPrototypeOf(WebAssembly.Module) as JSFunctionWithPrototype;
      const getKind = Object.getOwnPropertyDescriptor(Source.prototype, Symbol.toStringTag)!.get as JSMethod;
      class Derived extends WebAssembly.Module {}
      const module = new Derived(new Uint8Array(source));
      return {
        derived: module instanceof Derived,
        sourceChain: Object.getPrototypeOf(Object.getPrototypeOf(Derived)) === Source,
        kind: Reflect.apply(getKind, module, []),
        usable: new WebAssembly.Instance(module) instanceof WebAssembly.Instance,
      };
    }, emptyModule)).toEqual({ derived: true, sourceChain: true, kind: 'WebAssembly.Module', usable: true });
  });
});

function fixture(): Browlet {
  const browser = new Browlet({ route: () => '', reporting: false });
  Reflect.set(browser.window, 'foreign', createSiblingWindow(browser));
  return browser;
}

const emptyModule = [0, 97, 115, 109, 1, 0, 0, 0];
