import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { BrowsingContext, createDocumentState, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

// WebAssembly JavaScript API §5.10 delegates these constructors to ECMAScript's
// NativeError Object Structure, not Web IDL. Keep the realm's native constructors.
describe.each(['CompileError', 'LinkError', 'RuntimeError'] as const)('WebAssembly.%s', (name) => {
  it('retains the native constructor, prototype chain, and property descriptors', async () => {
    const browser = fixture();
    expect(await browser.evaluate((name) => {
      const Constructor = WebAssembly[name];
      const property = Object.getOwnPropertyDescriptor(WebAssembly, name)!;
      const prototype = Object.getOwnPropertyDescriptor(Constructor, 'prototype')!;
      const prototypeName = Object.getOwnPropertyDescriptor(Constructor.prototype, 'name')!;
      const prototypeMessage = Object.getOwnPropertyDescriptor(Constructor.prototype, 'message')!;
      return {
        constructor: property.value === Constructor, name: Constructor.name, length: Constructor.length,
        namespace: [property.writable, property.enumerable, property.configurable],
        prototype: [prototype.writable, prototype.enumerable, prototype.configurable],
        parentConstructor: Object.getPrototypeOf(Constructor) === Error,
        parentPrototype: Object.getPrototypeOf(Constructor.prototype) === Error.prototype,
        backReference: Constructor.prototype.constructor === Constructor,
        prototypeName: [prototypeName.value, prototypeName.writable, prototypeName.enumerable, prototypeName.configurable],
        prototypeMessage: [prototypeMessage.value, prototypeMessage.writable, prototypeMessage.enumerable, prototypeMessage.configurable],
        prototypeTag: Object.prototype.toString.call(Constructor.prototype),
      };
    }, name)).toEqual({
      constructor: true, name, length: 1, namespace: [true, false, true], prototype: [false, false, false],
      parentConstructor: true, parentPrototype: true, backReference: true,
      prototypeName: [name, true, false, true], prototypeMessage: ['', true, false, true],
      prototypeTag: '[object Object]',
    });
  });

  it('supports calls and construction with native Error identity and an unchanged cause', async () => {
    const browser = fixture();
    expect(await browser.evaluate((name) => {
      const Constructor = WebAssembly[name];
      const cause = {};
      const receiver = {};
      const called = Reflect.apply(Constructor, receiver, ['failure', { cause }]) as Error;
      const constructed = Reflect.construct(Constructor, ['failure', { cause }]) as Error;
      return [called, constructed].map((error) => {
        const message = Object.getOwnPropertyDescriptor(error, 'message')!;
        const causeProperty = Object.getOwnPropertyDescriptor(error, 'cause')!;
        return {
          native: error instanceof Constructor && error instanceof Error,
          fresh: error !== receiver && called !== constructed,
          prototype: Object.getPrototypeOf(error) === Constructor.prototype,
          cause: error.cause === cause, text: String(error), tag: Object.prototype.toString.call(error),
          message: [message.value, message.writable, message.enumerable, message.configurable],
          causeProperty: [causeProperty.writable, causeProperty.enumerable, causeProperty.configurable],
        };
      });
    }, name)).toEqual(Array.from({ length: 2 }, () => ({
      native: true, fresh: true, prototype: true, cause: true, text: `${name}: failure`, tag: '[object Error]',
      message: ['failure', true, false, true], causeProperty: [true, false, true],
    })));
  });

  it('preserves optional message and cause behavior instead of applying Web IDL defaults', async () => {
    const browser = fixture();
    expect(await browser.evaluate((name) => {
      const Constructor = WebAssembly[name];
      const messages = [[], [undefined], [null], [7n]].map((args) => {
        const error = Reflect.construct(Constructor, args) as Error;
        return [Object.hasOwn(error, 'message'), error.message];
      });
      const ignoredOptions = [undefined, null, true, 1, 'text', Symbol()].every((options) =>
        !Object.hasOwn(Reflect.construct(Constructor, ['', options]) as object, 'cause'));
      const inherited = Reflect.construct(Constructor, [undefined, Object.create({ cause: undefined })]) as Error;
      let symbolRejected = false;
      try { Reflect.construct(Constructor, [Symbol()]); }
      catch (error) { symbolRejected = error instanceof TypeError; }
      return {
        messages, ignoredOptions, symbolRejected,
        inheritedCause: Object.hasOwn(inherited, 'cause') && inherited.cause === undefined,
      };
    }, name)).toEqual({
      messages: [[false, ''], [false, ''], [true, 'null'], [true, '7']],
      ignoredOptions: true, symbolRejected: true, inheritedCause: true,
    });
  });

  it('selects the prototype before message conversion and only then reads the cause', async () => {
    const browser = fixture();
    expect(await browser.evaluate((name) => {
      const trace: string[] = [];
      const prototype = {};
      const target = new Proxy(function Target() {}, {
        get(target, key, receiver) {
          if (key === 'prototype') { trace.push('prototype'); return prototype; }
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
      const message = { [Symbol.toPrimitive](hint: string) { trace.push(hint); return 'failure'; } };
      const cause = {};
      const options = new Proxy({ cause }, {
        has(target, key) { trace.push(`has ${String(key)}`); return Reflect.has(target, key); },
        get(target, key, receiver) { trace.push(`get ${String(key)}`); return Reflect.get(target, key, receiver) as unknown; },
      });
      const error = Reflect.construct(WebAssembly[name], [message, options], target) as Error;
      return { trace, prototype: Object.getPrototypeOf(error) === prototype, message: error.message, cause: error.cause === cause };
    }, name)).toEqual({
      trace: ['prototype', 'string', 'has cause', 'get cause'], prototype: true, message: 'failure', cause: true,
    });
  });

  /* eslint-disable @typescript-eslint/only-throw-error -- Verify that native conversion also preserves arbitrary author-thrown values. */
  it('propagates message and cause failures without replacing the thrown value', async () => {
    const browser = fixture();
    expect(await browser.evaluate((name) => {
      const marker = {};
      const results: boolean[] = [];
      for (const phase of ['message', 'has', 'get']) {
        const trace: string[] = [];
        const message = { toString() { trace.push('message'); if (phase === 'message') throw marker; return 'failure'; } };
        const options = new Proxy({}, {
          has() { trace.push('has'); if (phase === 'has') throw marker; return true; },
          get() { trace.push('get'); throw marker; },
        });
        try { Reflect.construct(WebAssembly[name], [message, options]); results.push(false); }
        catch (error) {
          const expected = phase === 'message' ? ['message'] : phase === 'has' ? ['message', 'has'] : ['message', 'has', 'get'];
          results.push(error === marker && trace.join(',') === expected.join(','));
        }
      }
      return results;
    }, name)).toEqual([true, true, true]);
  });
  /* eslint-enable @typescript-eslint/only-throw-error */

  it('supports subclasses and chooses the newTarget realm for a missing prototype', async () => {
    const browser = fixture();
    expect(await browser.evaluate((name) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const Constructor = WebAssembly[name];
      const ForeignConstructor = foreign.WebAssembly[name];
      class Derived extends Constructor {}
      const derived = new Derived('subclass');
      const foreignError = Reflect.apply(ForeignConstructor, null, ['foreign']);
      // A bound foreign constructor has no own prototype; OrdinaryCreateFromConstructor
      // must select that realm's intrinsic error prototype rather than the caller's.
      const target = foreign.Object.bind(null);
      const fallback = Reflect.construct(Constructor, ['fallback'], target);
      return {
        distinct: Constructor !== ForeignConstructor,
        derived: derived instanceof Derived && derived instanceof Constructor,
        derivedPrototype: Object.getPrototypeOf(derived) === Derived.prototype,
        foreign: foreignError instanceof ForeignConstructor && foreignError instanceof foreign.Error && !(foreignError instanceof Error),
        fallback: Object.getPrototypeOf(fallback) === ForeignConstructor.prototype,
        fallbackMessage: fallback.message,
      };
    }, name)).toEqual({
      distinct: true, derived: true, derivedPrototype: true, foreign: true, fallback: true, fallbackMessage: 'fallback',
    });
  });
});

describe('WebAssembly intrinsic error production', () => {
  it('uses the invoked realm for synchronous failures after public error constructors are replaced', async () => {
    const browser = fixture();
    expect(await browser.evaluate(({ imported, trapping }) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const constructors = [foreign.WebAssembly.CompileError, foreign.WebAssembly.LinkError, foreign.WebAssembly.RuntimeError];
      for (const name of ['CompileError', 'LinkError', 'RuntimeError']) {
        Object.defineProperty(foreign.WebAssembly, name, { get() { throw new Error('Public constructor was read'); } });
      }
      const importedModule = new WebAssembly.Module(new Uint8Array(imported));
      const trapModule = new WebAssembly.Module(new Uint8Array(trapping));
      const operations = [
        () => new foreign.WebAssembly.Module(new Uint8Array()),
        () => new foreign.WebAssembly.Instance(importedModule, { env: { run: 1 } }),
        () => new foreign.WebAssembly.Instance(trapModule),
      ];
      return operations.map((operation, index) => {
        try { operation(); }
        catch (error) { return error instanceof constructors[index]! && error instanceof foreign.Error && !(error instanceof Error); }
        return false;
      });
    }, { imported: importModule, trapping: startTrapModule })).toEqual([true, true, true]);
  });

  it('retains native error identity through asynchronous compilation and instantiation', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async ({ imported, trapping, empty }) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const CompileError = foreign.WebAssembly.CompileError;
      const LinkError = foreign.WebAssembly.LinkError;
      const RuntimeError = foreign.WebAssembly.RuntimeError;
      for (const name of ['CompileError', 'LinkError', 'RuntimeError']) {
        Object.defineProperty(foreign.WebAssembly, name, { get() { throw new Error('Public constructor was read'); } });
      }
      const operations = [
        () => foreign.WebAssembly.compile(new Uint8Array()),
        () => foreign.WebAssembly.instantiate(new WebAssembly.Module(new Uint8Array(imported)), { env: { run: 1 } }),
        () => foreign.WebAssembly.instantiate(new WebAssembly.Module(new Uint8Array(trapping))),
        // Browlet's duplicate-builtin check must use its captured CompileError too.
        () => Reflect.apply(foreign.WebAssembly.compile, null, [new Uint8Array(empty), { builtins: ['unknown', 'unknown'] }]) as Promise<unknown>,
      ];
      const constructors = [CompileError, LinkError, RuntimeError, CompileError];
      const results: boolean[] = [];
      for (const [index, operation] of operations.entries()) {
        const promise = operation();
        try { await promise; results.push(false); }
        catch (error) {
          results.push(promise instanceof foreign.Promise && error instanceof constructors[index]! &&
            error instanceof foreign.Error && !(error instanceof Error));
        }
      }
      return results;
    }, { imported: importModule, trapping: startTrapModule, empty: emptyModule })).toEqual([true, true, true, true]);
  });

  it('allocates an exported-function trap in its own realm when called from another realm', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const RuntimeError = foreign.WebAssembly.RuntimeError;
      const module = new WebAssembly.Module(new Uint8Array(source));
      const instance = new foreign.WebAssembly.Instance(module);
      Object.defineProperty(foreign.WebAssembly, 'RuntimeError', { get() { throw new Error('Public constructor was read'); } });
      try { (instance.exports.trap as () => void)(); }
      catch (error) { return error instanceof RuntimeError && error instanceof foreign.Error && !(error instanceof Error); }
      return false;
    }, exportedTrapModule)).toBe(true);
  });
});

function fixture(): Browlet {
  const browser = new Browlet({ route: () => '', reporting: false });
  const foreign = createSiblingWindow(browser);
  const realm = getRelevantRealm(foreign);
  const document = realm.getAssociatedDocument();
  // Native asynchronous completion runs as an HTML task on the sibling's active Document.
  document.browsingContext = new BrowsingContext(realm.windowProxy);
  new TopLevelTraversable(createDocumentState(document));
  Reflect.set(browser.window, 'foreign', foreign);
  return browser;
}

// (module)
const emptyModule = [0, 97, 115, 109, 1, 0, 0, 0];
// (module (import "env" "run" (func)))
const importModule = [...emptyModule, 1, 4, 1, 96, 0, 0, 2, 11, 1, 3, 101, 110, 118, 3, 114, 117, 110, 0, 0];
// (module (func unreachable) (start 0))
const startTrapModule = [...emptyModule, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 8, 1, 0, 10, 5, 1, 3, 0, 0, 11];
// (module (func (export "trap") unreachable))
const exportedTrapModule = [
  ...emptyModule, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0,
  7, 8, 1, 4, 116, 114, 97, 112, 0, 0, 10, 5, 1, 3, 0, 0, 11,
];
