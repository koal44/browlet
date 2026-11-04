import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { WebAssembly as WebAssemblyAPI } from '../../../src/browlet/platform';
import { addon } from '../../../src/js-engine/node-addons';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

/* eslint-disable @typescript-eslint/unbound-method -- These tests intentionally detach and borrow namespace methods. */

// ESM integration §5: namespace lookup, independently of HTML graph loading.
describe('WebAssembly.namespaceInstance', () => {
  it('installs a realm-owned, nonconstructible namespace operation', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate(() => {
      const api = WebAssembly as unknown as WebAssemblyAPI;
      const descriptor = Object.getOwnPropertyDescriptor(api, 'namespaceInstance')!;
      let rejectsConstruction = false;
      try { Reflect.construct(api.namespaceInstance, [{}]); }
      catch (error) { rejectsConstruction = error instanceof TypeError; }
      return {
        name: api.namespaceInstance.name, length: api.namespaceInstance.length,
        ownFunction: Object.getPrototypeOf(api.namespaceInstance) === Function.prototype,
        descriptor: [descriptor.writable, descriptor.enumerable, descriptor.configurable], rejectsConstruction,
      };
    })).toEqual({ name: 'namespaceInstance', length: 1, ownFunction: true, descriptor: [true, true, true], rejectsConstruction: true });
  });

  it('rejects missing and primitive arguments through Web IDL', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate(() => {
      const operation = (WebAssembly as unknown as WebAssemblyAPI).namespaceInstance;
      return [[], [undefined], [null], [true], [1], [1n], ['module'], [Symbol()]].map((args) => {
        try { Reflect.apply(operation, null, args); return false; }
        catch (error) { return error instanceof TypeError; }
      });
    })).toEqual(Array(8).fill(true));
  });

  it('rejects objects and spoofed namespaces without invoking author code', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate(() => {
      const operation = (WebAssembly as unknown as WebAssemblyAPI).namespaceInstance;
      const trap = () => { throw new Error('author code ran'); };
      const proxy = new Proxy({}, { get: trap, getPrototypeOf: trap, ownKeys: trap });
      const revoked = Proxy.revocable({}, {});
      revoked.revoke();
      const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])));
      return [{}, { [Symbol.toStringTag]: 'Module' }, () => {}, instance, instance.exports, proxy, revoked.proxy].map((value) => {
        try { operation(value); return false; }
        catch (error) { return error instanceof TypeError; }
      });
    })).toEqual(Array(7).fill(true));
  });

  it('rejects a genuine JavaScript module namespace', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    const realm = getRelevantRealm(browser.window);
    const module = realm.compileModule('export const answer = 42;', 'ordinary.js');
    realm.linkModule(module, new Map([[module, []]]));
    const namespace = realm.getModuleNamespace(module);
    // Evaluation arguments are copied; install the actual namespace identity.
    Reflect.set(browser.window, 'namespace', namespace);
    expect(await browser.evaluate(() => {
      const namespace = Reflect.get(globalThis, 'namespace') as object;
      try { (WebAssembly as unknown as WebAssemblyAPI).namespaceInstance(namespace); return false; }
      catch (error) { return error instanceof TypeError; }
    })).toBe(true);
  });

  it('uses the invoked operation realm for errors even when borrowed', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    const foreign = createSiblingWindow(browser);
    Reflect.set(browser.window, 'foreign', foreign);
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      try {
        Reflect.apply((foreign.WebAssembly as unknown as WebAssemblyAPI).namespaceInstance, WebAssembly, [{}]);
        return false;
      } catch (error) { return error instanceof foreign.TypeError && !(error instanceof TypeError); }
    })).toBe(true);
  });

  // These are bridge integration checks. Stock Node has no public Wasm VM module
  // class; its namespace recognition remains a dependency, not a simulated record.
  if (addon.getWebAssemblyNamespaceInstance) {
    it('projects a stable platform Instance over the native namespace instance', async () => {
      const browser = new Browlet({ route: () => '', reporting: false });
      const { fixture } = loadWasmFixture();
      const f = fixture();
      const module = f.compileWasm(new Uint8Array(emptyModule));
      const root = f.compile('import * as ns from "./wasm"; export { ns };');
      f.link(root, new Map([[root, [module]]]));
      expect(f.evaluate(root).state).toBe('fulfilled');
      Reflect.set(browser.window, 'namespace', Reflect.get(root.namespace, 'ns'));
      Reflect.set(browser.window, 'instance', module.instance);
      expect(await browser.evaluate(() => {
        const namespace = Reflect.get(globalThis, 'namespace') as object;
        const instance: unknown = Reflect.get(globalThis, 'instance');
        const result = (WebAssembly as unknown as WebAssemblyAPI).namespaceInstance(namespace);
        return result !== instance && result instanceof WebAssembly.Instance &&
          result === (WebAssembly as unknown as WebAssemblyAPI).namespaceInstance(namespace);
      })).toBe(true);
    });

    it('rejects an unexecuted Wasm namespace without evaluating it, then succeeds after evaluation', async () => {
      const browser = new Browlet({ route: () => '', reporting: false });
      const { fixture } = loadWasmFixture();
      const f = fixture();
      const module = f.compileWasm(new Uint8Array(emptyModule));
      f.link(module);
      Reflect.set(browser.window, 'namespace', module.namespace);
      expect(await browser.evaluate(() => {
        const namespace = Reflect.get(globalThis, 'namespace') as object;
        try { (WebAssembly as unknown as WebAssemblyAPI).namespaceInstance(namespace); return false; }
        catch (error) { return error instanceof ReferenceError; }
      })).toBe(true);
      expect(module.status).toBe('linked');
      f.evaluate(module);
      Reflect.set(browser.window, 'instance', module.instance);
      expect(await browser.evaluate(() => {
        const namespace = Reflect.get(globalThis, 'namespace') as object;
        const instance: unknown = Reflect.get(globalThis, 'instance');
        const result = (WebAssembly as unknown as WebAssemblyAPI).namespaceInstance(namespace);
        return result !== instance && result instanceof WebAssembly.Instance;
      })).toBe(true);
    });
  }
});

const emptyModule = [0, 97, 115, 109, 1, 0, 0, 0];

interface WasmTestModule {
  namespace: object;
  instance?: object;
  status: string;
}

interface WasmFixtureFactory {
  fixture(this: void): {
    compileWasm(bytes: Uint8Array): WasmTestModule;
    compile(source: string): WasmTestModule;
    link(root: WasmTestModule, graph?: Map<WasmTestModule, WasmTestModule[]>): void;
    evaluate(module: WasmTestModule): { state: string; };
  };
}

/** Exercise the real addon bridge independently of HTML's module loader. */
function loadWasmFixture(): WasmFixtureFactory {
  return createRequire(__filename)('../../../node-compat/test/support/wasm.cjs') as WasmFixtureFactory;
}
