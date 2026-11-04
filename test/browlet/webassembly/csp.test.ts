import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { CSPList } from '../../../src/browlet/browsing/policy/csp/list';
import { ContentSecurityPolicy, type CSPDisposition } from '../../../src/browlet/browsing/policy/csp/policy';
import { BrowsingContext, createDocumentState, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { addon } from '../../../src/js-engine/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

describe('WebAssembly CSP integration', () => {
  it('throws a compilation-realm CompileError from the Module constructor', async () => {
    const { browser } = fixture("script-src 'none'");
    expect(await browser.evaluate((source) => {
      try { new WebAssembly.Module(new Uint8Array(source)); }
      catch (error) { return error instanceof WebAssembly.CompileError; }
      return false;
    }, emptyModule)).toBe(true);
  });

  it.each(['compile', 'instantiate', 'compileStreaming', 'instantiateStreaming'] as const)(
    'rejects %s through its own Promise without touching imports', async (operation) => {
      const { browser } = fixture("default-src 'none'");
      expect(await browser.evaluate(async ({ source, operation }) => {
        let touched = false;
        const imports = new Proxy({}, { get() { touched = true; throw new Error('Must not read imports'); } });
        const bytes = new Uint8Array(source);
        const response = new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } });
        let result: Promise<unknown>;
        try {
          switch (operation) {
            case 'compile': result = WebAssembly.compile(bytes); break;
            case 'instantiate': result = WebAssembly.instantiate(bytes, imports); break;
            case 'compileStreaming': result = WebAssembly.compileStreaming(response); break;
            case 'instantiateStreaming': result = WebAssembly.instantiateStreaming(response, imports); break;
          }
        } catch { return ['threw']; }
        try { await result; return ['fulfilled']; }
        catch (error) { return [result instanceof Promise, error instanceof WebAssembly.CompileError, touched]; }
      }, { source: [...callImport()], operation })).toEqual([true, true, false]);
    },
  );

  it.each(['compile', 'compileStreaming'] as const)('reports once and permits %s under report-only policy', async (operation) => {
    const { browser, realm } = fixture("script-src 'none'; report-to wasm", 'report');
    expect(await browser.evaluate(async ({ source, operation }) => {
      const reported = new Promise<void>((resolve) => document.addEventListener('securitypolicyviolation', () => { resolve(); }, { once: true }));
      const bytes = new Uint8Array(source);
      const result = operation === 'compile' ? WebAssembly.compile(bytes) :
        WebAssembly.compileStreaming(new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } }));
      const module = await result;
      await reported;
      return module instanceof WebAssembly.Module;
    }, { source: emptyModule, operation })).toBe(true);
    const reports = realm.env.getWindowOrWorkerGlobalScopeMixin().reports;
    // In stock mode, callback cleanup can resume Node before the report task
    // finishes queueing its body, even after its event has been dispatched.
    await expect.poll(() => reports.length).toBe(1);
    expect(reports[0]!.data).toMatchObject({ blockedURL: 'wasm-eval', effectiveDirective: 'script-src', disposition: 'report', sample: '' });
  });

  it('rechecks cached bytes against the live policy while retaining validation, cloning, and instantiation', async () => {
    const { browser, policies } = fixture("script-src 'wasm-unsafe-eval'");
    expect(await browser.evaluate(async (source) => {
      const module = await WebAssembly.compile(new Uint8Array(source));
      Reflect.set(globalThis, 'retained', module);
      return module instanceof WebAssembly.Module;
    }, [...callImport()])).toBe(true);
    policies.policies[0] = ContentSecurityPolicy.parse("script-src 'none'", 'header', 'enforce');
    expect(await browser.evaluate(async (source) => {
      const module = Reflect.get(globalThis, 'retained') as WebAssembly.Module;
      const imports = { './js': { answer: () => 42 } };
      const first = new WebAssembly.Instance(module, imports);
      const cloned = structuredClone(module);
      const second = await WebAssembly.instantiate(cloned, imports);
      let blocked = false;
      try { await WebAssembly.compile(new Uint8Array(source)); }
      catch (error) { blocked = error instanceof WebAssembly.CompileError; }
      return [WebAssembly.validate(new Uint8Array(source)),
        (first.exports.answer as () => number)(), (second.exports.answer as () => number)(), blocked];
    }, [...callImport()])).toEqual([true, 42, 42, true]);
    policies.policies.length = 0;
    expect(await browser.evaluate(async (source) => await WebAssembly.compile(new Uint8Array(source)) instanceof WebAssembly.Module,
      emptyModule)).toBe(true);
  });

  it('uses the borrowed constructor and operation realm, not the caller policy', async () => {
    const { browser } = fixture("script-src 'wasm-unsafe-eval'");
    const foreign = createSiblingWindow(browser);
    const realm = getRelevantRealm(foreign);
    const document = realm.getAssociatedDocument();
    document.browsingContext = new BrowsingContext(realm.windowProxy);
    new TopLevelTraversable(createDocumentState(document));
    const policies = new CSPList(realm.env.origin);
    policies.policies.push(ContentSecurityPolicy.parse("script-src 'none'", 'header', 'enforce'));
    realm.env.policyContainer.cspList = policies;
    Reflect.set(browser.window, 'foreign', foreign);
    expect(await browser.evaluate(async (source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const bytes = new Uint8Array(source);
      const own = new WebAssembly.Module(bytes) instanceof WebAssembly.Module;
      let constructor = false;
      try { new foreign.WebAssembly.Module(bytes); }
      catch (error) { constructor = error instanceof foreign.WebAssembly.CompileError && !(error instanceof WebAssembly.CompileError); }
      try { await foreign.WebAssembly.compile(bytes); }
      catch (error) { return [own, constructor, error instanceof foreign.WebAssembly.CompileError && !(error instanceof WebAssembly.CompileError)]; }
      return [own, constructor, false];
    }, emptyModule)).toEqual([true, true, true]);
  });

  it('covers captured native entry points with the addon, leaving the stock boundary explicit', async () => {
    const { realm } = fixture("script-src 'none'");
    const construct = () => Reflect.construct(realm.WebAssemblyModule, [new Uint8Array(emptyModule)]) as object;
    if (addon.setAllowWasmCodeGenerationCallback) {
      expect(construct).toThrow(realm.WebAssemblyCompileError);
      // Observe this realm's native Promise through the existing host observer.
      const result = Reflect.apply(realm.webAssemblyCompile, undefined, [new Uint8Array(emptyModule)]) as Promise<unknown>;
      await expect(new Promise((resolve, reject) => realm.observePromise(result, resolve, reject))).rejects.toBeInstanceOf(realm.WebAssemblyCompileError);
    } else {
      // ACCOMMODATION: Stock Node cannot intercept a retained native constructor.
      expect(construct()).toBeInstanceOf(realm.WebAssemblyModule);
    }
  });
});

function fixture(serialized: string, disposition: CSPDisposition = 'enforce') {
  const browser = new Browlet({ route: () => '' });
  const realm = getRelevantRealm(browser.window);
  const policies = new CSPList(realm.env.origin);
  policies.policies.push(ContentSecurityPolicy.parse(serialized, 'header', disposition));
  realm.env.policyContainer.cspList = policies;
  return { browser, realm, policies };
}

const emptyModule = [0, 97, 115, 109, 1, 0, 0, 0];
const { callImport } = createRequire(__filename)('../../../node-compat/test/support/wasm-fixtures.cjs') as {
  callImport(this: void): Uint8Array;
};
