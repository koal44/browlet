import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { BrowsingContext, createDocumentState, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

// WebAssembly JavaScript API §5: compile(), before instantiation and the Module interface review.
// Exercise the binding's conversions together with native completion and object identity.
describe('WebAssembly asynchronous compilation', () => {
  it('returns the invoked realm\'s Promise and native Module', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const result = foreign.WebAssembly.compile(new Uint8Array(source));
      const ownPromise = Object.getPrototypeOf(result) === foreign.Promise.prototype;
      const module = await result;
      return {
        ownPromise,
        ownModule: module instanceof foreign.WebAssembly.Module,
        otherModule: module instanceof WebAssembly.Module,
        usable: new WebAssembly.Instance(module) instanceof WebAssembly.Instance,
      };
    }, emptyModule)).toEqual({ ownPromise: true, ownModule: true, otherModule: false, usable: true });
  });

  it('copies the input before returning and resolves after the current microtasks', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const trace: string[] = [];
      const bytes = new Uint8Array(source);
      const result = WebAssembly.compile(bytes);
      bytes.fill(0);
      void result.then(() => { trace.push('compiled'); });
      queueMicrotask(() => { trace.push('microtask'); });
      trace.push('returned');
      const module = await result;
      return { trace, module: module instanceof WebAssembly.Module };
    }, emptyModule)).toEqual({ trace: ['returned', 'microtask', 'compiled'], module: true });
  });

  it('accepts DataView input with its byte range', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const bytes = new Uint8Array(source.length + 4);
      bytes.fill(0xff);
      bytes.set(source, 2);
      const module = await WebAssembly.compile(new DataView(bytes.buffer, 2, source.length));
      return module instanceof WebAssembly.Module;
    }, emptyModule)).toBe(true);
  });

  it('runs thenable assimilation of a compiled module without another browser task', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const trace: string[] = [];
      Object.defineProperty(WebAssembly.Module.prototype, 'then', {
        get() {
          trace.push('get then');
          return (resolve: (value: unknown) => void) => {
            trace.push('call then');
            resolve(42);
          };
        },
      });
      const result: unknown = await WebAssembly.compile(new Uint8Array(source));
      return { assimilated: result === 42, trace };
    }, emptyModule)).toEqual({ assimilated: true, trace: ['get then', 'call then'] });
  });

  it('rejects invalid input and primitive options through the invoked realm\'s Promise', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const argumentsList = [[null], [new Uint8Array(source), 1]];
      const results: boolean[] = [];
      for (const args of argumentsList) {
        let result: Promise<unknown>;
        try { result = Reflect.apply(foreign.WebAssembly.compile, null, args) as Promise<unknown>; }
        catch { results.push(false); continue; }
        try { await result; results.push(false); }
        catch (error) {
          results.push(Object.getPrototypeOf(result) === foreign.Promise.prototype && error instanceof foreign.TypeError);
        }
      }
      return results;
    }, emptyModule)).toEqual([true, true]);
  });

  it('iterates and converts options before reading imported string constants', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const trace: string[] = [];
      const module = await (Reflect.apply(WebAssembly.compile, null, [new Uint8Array(source), {
        get builtins() {
          trace.push('builtins');
          return {
            *[Symbol.iterator]() {
              trace.push('iterator');
              yield { toString() { trace.push('builtin string'); return 'unknown'; } };
            },
          };
        },
        get importedStringConstants() {
          trace.push('strings');
          return { toString() { trace.push('import string'); return 'constants'; } };
        },
      }]) as Promise<unknown>);
      return { trace, module: module instanceof WebAssembly.Module };
    }, emptyModule)).toEqual({
      trace: ['builtins', 'iterator', 'builtin string', 'strings', 'import string'], module: true,
    });
  });

  it('rejects with the original error from an option iterator', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const marker = new Error('iterator failed');
      let result: Promise<unknown>;
      try {
        result = Reflect.apply(WebAssembly.compile, null, [new Uint8Array(source), {
          builtins: { [Symbol.iterator]() { throw marker; } },
        }]) as Promise<unknown>;
      } catch { return false; }
      try { await result; }
      catch (error) { return error === marker; }
      return false;
    }, emptyModule)).toBe(true);
  });

  it.each(['js-string', 'unknown'])('rejects duplicate %s builtins with CompileError', async (name) => {
    const browser = fixture();
    expect(await browser.evaluate(async ({ source, name }) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      try {
        await Reflect.apply(foreign.WebAssembly.compile, null, [new Uint8Array(source), { builtins: [name, name] }]);
      } catch (error) { return error instanceof foreign.WebAssembly.CompileError; }
      return false;
    }, { source: emptyModule, name })).toBe(true);
  });

  it('rejects duplicate builtins in a later task without exposing a Module', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (source) => {
      const trace: string[] = [];
      const CompileError = WebAssembly.CompileError;
      Object.defineProperty(WebAssembly, 'CompileError', {
        get() { throw new Error('Do not read the public constructor'); },
      });
      Object.defineProperty(WebAssembly.Module.prototype, 'then', {
        get() { trace.push('module then'); return undefined; },
      });
      const result = (Reflect.apply(WebAssembly.compile, null,
        [new Uint8Array(source), { builtins: ['unknown', 'unknown'] }]) as Promise<unknown>).then(
        () => false,
        (error) => { trace.push('rejected'); return error instanceof CompileError; },
      );
      queueMicrotask(() => { trace.push('microtask'); });
      trace.push('returned');
      return { rejected: await result, trace };
    }, emptyModule)).toEqual({ rejected: true, trace: ['returned', 'microtask', 'rejected'] });
  });

  it.each(['mutate', 'detach'])('copies bytes after an option getter can %s them', async (action) => {
    const browser = fixture();
    expect(await browser.evaluate(async ({ source, action }) => {
      const bytes = new Uint8Array(source);
      try {
        await Reflect.apply(WebAssembly.compile, null, [bytes, {
          get builtins() {
            if (action === 'detach') bytes.buffer.transfer();
            else bytes.fill(0);
            return [];
          },
        }]);
      } catch (error) { return error instanceof WebAssembly.CompileError; }
      return false;
    }, { source: emptyModule, action })).toBe(true);
  });
});

function fixture(): Browlet {
  const browser = new Browlet({ route: () => '', reporting: false });
  const foreign = createSiblingWindow(browser);
  const realm = getRelevantRealm(foreign);
  const document = realm.getAssociatedDocument();
  // Compilation completes in an HTML task, so the sibling needs an active Document.
  document.browsingContext = new BrowsingContext(realm.windowProxy);
  document.makeActive();
  new TopLevelTraversable(createDocumentState(document));
  Reflect.set(browser.window, 'foreign', foreign);
  return browser;
}

// (module)
const emptyModule = [0, 97, 115, 109, 1, 0, 0, 0];
