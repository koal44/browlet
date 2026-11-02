import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { createSiblingWindow } from '../../support/windows';

// WebAssembly JavaScript API §5.1: synchronous Module construction and its Web IDL boundary.
describe('WebAssembly Module construction', () => {
  it('compiles synchronously, retaining its own bytes and native Module identity', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const bytes = new Uint8Array(source);
      const module = new WebAssembly.Module(bytes);
      bytes.fill(0);
      return {
        module: module instanceof WebAssembly.Module,
        constructor: module.constructor === WebAssembly.Module,
        usable: new WebAssembly.Instance(module) instanceof WebAssembly.Instance,
        bytes: Array.from(new Uint8Array(WebAssembly.Module.customSections(module, 'meta')[0]!)),
      };
    }, customModule)).toEqual({ module: true, constructor: true, usable: true, bytes: [42] });
  });

  it('accepts the selected DataView range and raw shared buffers', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const padded = new Uint8Array(source.length + 4).fill(255);
      padded.set(source, 2);
      const shared = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer;
      // The custom section consumes the remaining shared memory with an empty name and zero payload.
      new Uint8Array(shared).set([0, 97, 115, 109, 1, 0, 0, 0, 0, 244, 255, 3, 0]);
      return [
        new WebAssembly.Module(new DataView(padded.buffer, 2, source.length)),
        new WebAssembly.Module(shared),
      ].every((module) => new WebAssembly.Instance(module) instanceof WebAssembly.Instance);
    }, emptyModule)).toBe(true);
  });

  it('requires new and rejects non-buffer inputs before touching the options', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      let touched = false;
      const options = { get builtins(): never { touched = true; throw new Error('unexpected'); } };
      let requiresNew = false;
      try { Reflect.apply(foreign.WebAssembly.Module, null, [new Uint8Array(source), options]); }
      catch (error) { requiresNew = error instanceof foreign.TypeError; }
      const invalidInputs = [undefined, null, {}, [], '', new Proxy(new Uint8Array(source), {})];
      const rejects = invalidInputs.every((bytes) => {
        try { Reflect.construct(foreign.WebAssembly.Module, [bytes, options]); }
        catch (error) { return error instanceof foreign.TypeError; }
        return false;
      });
      return { requiresNew, rejects, touched };
    }, emptyModule)).toEqual({ requiresNew: true, rejects: true, touched: false });
  });

  it('uses the invoked realm for native objects and compilation errors', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const module = new foreign.WebAssembly.Module(new Uint8Array(source));
      let compileError = false;
      try { new foreign.WebAssembly.Module(new Uint8Array([0])); }
      catch (error) { compileError = error instanceof foreign.WebAssembly.CompileError; }
      return {
        prototype: Object.getPrototypeOf(module) === foreign.WebAssembly.Module.prototype,
        own: module instanceof foreign.WebAssembly.Module,
        other: module instanceof WebAssembly.Module,
        compileError,
      };
    }, emptyModule)).toEqual({ prototype: true, own: true, other: false, compileError: true });
  });

  it('preserves subclass prototypes and native slots', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      class Derived extends WebAssembly.Module { marker = 42; }
      const module = new Derived(new Uint8Array(source));
      return {
        derived: module instanceof Derived,
        native: module instanceof WebAssembly.Module,
        prototype: Object.getPrototypeOf(module) === Derived.prototype,
        constructor: module.constructor === Derived,
        marker: module.marker,
        usable: new WebAssembly.Instance(module) instanceof WebAssembly.Instance,
      };
    }, emptyModule)).toEqual({ derived: true, native: true, prototype: true, constructor: true, marker: 42, usable: true });
  });

  // SPEC_CLASH(wasm-module-constructor-order): V8 reads the prototype first; Web IDL converts arguments first.
  it('converts options before reading newTarget.prototype, then copies the live bytes', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const bytes = new Uint8Array(source);
      const prototype = {};
      const trace: string[] = [];
      const target = new Proxy(function Target() {}, {
        get(target, key, receiver) {
          if (key === 'prototype') {
            trace.push('prototype');
            bytes[bytes.length - 1] = 17;
            return prototype;
          }
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
      const module = Reflect.construct(WebAssembly.Module, [bytes, {
        get builtins() { trace.push('builtins'); return []; },
        get importedStringConstants() { trace.push('strings'); return null; },
      }], target) as WebAssembly.Module;
      return {
        trace,
        prototype: Object.getPrototypeOf(module) === prototype,
        bytes: Array.from(new Uint8Array(WebAssembly.Module.customSections(module, 'meta')[0]!)),
      };
    }, customModule)).toEqual({ trace: ['builtins', 'strings', 'prototype'], prototype: true, bytes: [17] });
  });

  it('falls back to the newTarget realm\'s Module prototype', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      // A bound constructor has no prototype property, but retains its target's realm.
      const target = foreign.Object.bind(null);
      const module = Reflect.construct(WebAssembly.Module, [new Uint8Array(source)], target);
      return {
        prototype: Object.getPrototypeOf(module) === foreign.WebAssembly.Module.prototype,
        usable: new WebAssembly.Instance(module) instanceof WebAssembly.Instance,
      };
    }, emptyModule)).toEqual({ prototype: true, usable: true });
  });

  it('keeps native reflection and saved construction usable after public properties are replaced', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const Constructor = WebAssembly.Module;
      const CompileError = WebAssembly.CompileError;
      const descriptor = Object.getOwnPropertyDescriptor(Constructor, 'prototype')!;
      Reflect.set(WebAssembly, 'Module', () => { throw new Error('replaced'); });
      Reflect.set(WebAssembly, 'CompileError', () => { throw new Error('replaced'); });
      const module = new Constructor(new Uint8Array(source));
      let compileError = false;
      try { Reflect.construct(Constructor, [new Uint8Array(source), { builtins: ['x', 'x'] }]); }
      catch (error) { compileError = error instanceof CompileError; }
      return {
        name: Constructor.name, length: Constructor.length,
        prototypeDescriptor: [descriptor.writable, descriptor.enumerable, descriptor.configurable],
        constructor: module.constructor === Constructor,
        exports: Constructor.exports(module), imports: Constructor.imports(module),
        compileError,
      };
    }, emptyModule)).toEqual({
      name: 'Module', length: 1, prototypeDescriptor: [false, false, false],
      constructor: true, exports: [], imports: [], compileError: true,
    });
  });

  it('converts the options dictionary, accepting null defaults and rejecting primitives', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const bytes = new Uint8Array(source);
      const defaults = [undefined, null].every((options) =>
        Reflect.construct(foreign.WebAssembly.Module, [bytes, options]) instanceof foreign.WebAssembly.Module);
      const rejects = [false, 1, 1n, '', Symbol()].every((options) => {
        try { Reflect.construct(foreign.WebAssembly.Module, [bytes, options]); }
        catch (error) { return error instanceof foreign.TypeError; }
        return false;
      });
      return { defaults, rejects };
    }, emptyModule)).toEqual({ defaults: true, rejects: true });
  });

  it('iterates and converts builtin names before imported string constants', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const trace: string[] = [];
      const module: unknown = Reflect.construct(WebAssembly.Module, [new Uint8Array(source), {
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
          return { toString() { trace.push('module string'); return 'constants'; } };
        },
      }]);
      return { trace, module: module instanceof WebAssembly.Module };
    }, emptyModule)).toEqual({ trace: ['builtins', 'iterator', 'builtin string', 'strings', 'module string'], module: true });
  });

  it('preserves an exception thrown while iterating the options', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const marker = new Error('iterator failed');
      try {
        Reflect.construct(WebAssembly.Module, [new Uint8Array(source), {
          builtins: { [Symbol.iterator]() { throw marker; } },
        }]);
      } catch (error) { return error === marker; }
      return false;
    }, emptyModule)).toBe(true);
  });

  it.each(['known', 'unknown'])('rejects duplicate %s builtin names with CompileError', async (kind) => {
    const browser = fixture();
    expect(await browser.evaluate(({ source, kind }) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const name = kind === 'known' ? 'js-string' : 'unknown';
      try { Reflect.construct(foreign.WebAssembly.Module, [new Uint8Array(source), { builtins: [name, name] }]); }
      catch (error) { return error instanceof foreign.WebAssembly.CompileError; }
      return false;
    }, { source: emptyModule, kind })).toBe(true);
  });

  it.each(['mutate', 'detach'])('copies the bytes after an option getter can %s them', async (action) => {
    const browser = fixture();
    expect(await browser.evaluate(({ source, action }) => {
      const bytes = new Uint8Array(source);
      try {
        Reflect.construct(WebAssembly.Module, [bytes, {
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
  Reflect.set(browser.window, 'foreign', createSiblingWindow(browser));
  return browser;
}

const emptyModule = [0, 97, 115, 109, 1, 0, 0, 0];
// (module (@custom "meta" "\2a"))
const customModule = [...emptyModule, 0, 6, 4, 109, 101, 116, 97, 42];
