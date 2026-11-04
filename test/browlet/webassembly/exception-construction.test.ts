import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { getPlatformRecord, PlatformRecordSource } from '../../../src/web-idl/values/platform';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

// WebAssembly JavaScript API §5.9: Binding converts arguments; V8 owns the exception and typed payload.
describe('WebAssembly Exception construction', () => {
  it('consumes an iterable payload without reading array-like properties', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const tag = new WebAssembly.Tag({ parameters: ['i32', 'externref'] });
      const marker = {};
      const payload = {
        get length(): never { throw new Error('length must not be read'); },
        get 0(): never { throw new Error('indices must not be read'); },
        *[Symbol.iterator]() { yield 7; yield marker; },
      };
      const exception = Reflect.construct(WebAssembly.Exception, [tag, payload]) as WebAssembly.Exception;
      return [exception.getArg(tag, 0) as unknown, exception.getArg(tag, 1) === marker];
    })).toEqual([7, true]);
  });

  it('converts payload and options before prototype lookup and native value coercion', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const trace: string[] = [];
      const tag = new WebAssembly.Tag({ parameters: ['i32'] });
      const payload = [{ valueOf() { trace.push('value'); return 9; } }];
      payload[Symbol.iterator] = function* () { trace.push('payload'); yield this[0]!; return undefined; };
      const options = { get traceStack() { trace.push('options'); return false; } };
      const target = new Proxy(function Target() {}, {
        get(target, key, receiver) {
          if (key === 'prototype') trace.push('prototype');
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
      Reflect.construct(WebAssembly.Exception, [tag, payload, options], target);
      return trace;
    })).toEqual(['payload', 'options', 'prototype', 'value']);
  });

  it('rejects non-iterable payloads before options or prototype lookup', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const tag = new WebAssembly.Tag({ parameters: ['i32'] });
      return [undefined, null, { 0: 7, length: 1 }].map((payload) => {
        const trace: string[] = [];
        const options = { get traceStack() { trace.push('options'); return false; } };
        const target = new Proxy(function Target() {}, {
          get(target, key, receiver) {
            if (key === 'prototype') trace.push('prototype');
            return Reflect.get(target, key, receiver) as unknown;
          },
        });
        let rejected = false;
        try { Reflect.construct(WebAssembly.Exception, [tag, payload, options], target); }
        catch (error) { rejected = error instanceof TypeError; }
        return { rejected, trace };
      });
    })).toEqual(Array.from({ length: 3 }, () => ({ rejected: true, trace: [] })));
  });

  it('rejects invalid tags before observing the payload or options', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const fail = (): never => { throw new Error('Author code ran'); };
      const tag = new WebAssembly.Tag({ parameters: [] });
      const payload = { get [Symbol.iterator]() { return fail(); } };
      const options = { get traceStack() { return fail(); } };
      return [null, {}, Object.create(WebAssembly.Tag.prototype) as object,
        new Proxy(tag, { get: fail, getPrototypeOf: fail })].every((tag) => {
        try { Reflect.construct(WebAssembly.Exception, [tag, payload, options]); }
        catch (error) { return error instanceof TypeError; }
        return false;
      });
    })).toBe(true);
  });

  it('finishes argument conversion before rejecting JSTag or a mismatched payload length', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      return [WebAssembly.JSTag, new WebAssembly.Tag({ parameters: [] })].map((tag) => {
        const trace: string[] = [];
        const payload = { *[Symbol.iterator]() { trace.push('payload'); yield { valueOf() { trace.push('value'); return 7; } }; } };
        const options = { get traceStack() { trace.push('options'); return false; } };
        let rejected = false;
        try { Reflect.construct(WebAssembly.Exception, [tag, payload, options]); }
        catch (error) { rejected = error instanceof TypeError; }
        return { rejected, trace };
      });
    })).toEqual(Array.from({ length: 2 }, () => ({ rejected: true, trace: ['payload', 'options'] })));
  });

  it('snapshots payload entries before options can mutate the input array', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const tag = new WebAssembly.Tag({ parameters: ['i32'] });
      const payload = [7];
      const exception = new WebAssembly.Exception(tag, payload, {
        get traceStack() { payload[0] = 99; return false; },
      });
      return [exception.getArg(tag, 0) as unknown, payload[0]];
    })).toEqual([7, 99]);
  });

  it('uses the native typed payload conversions and retains reference identity', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const tag = new WebAssembly.Tag({ parameters: ['i32', 'i64', 'f32', 'f64', 'externref', 'anyfunc'] });
      const marker = {};
      const exception = new WebAssembly.Exception(tag, [2 ** 32 + 1, 2n ** 64n + 3n, 1.337, -0, marker, null]);
      return [exception.getArg(tag, 0) === 1, exception.getArg(tag, 1) === 3n,
        exception.getArg(tag, 2) === Math.fround(1.337), Object.is(exception.getArg(tag, 3), -0),
        exception.getArg(tag, 4) === marker, exception.getArg(tag, 5) === null];
    })).toEqual([true, true, true, true, true, true]);
  });

  it('preserves author failures from iteration, options, and native numeric conversion', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const tag = new WebAssembly.Tag({ parameters: ['i32'] });
      const marker = new Error('author');
      const cases = [
        [{ [Symbol.iterator]() { throw marker; } }, {}],
        [[7], { get traceStack(): never { throw marker; } }],
        [[{ valueOf() { throw marker; } }], {}],
      ];
      return cases.map(([payload, options]) => {
        try { Reflect.construct(WebAssembly.Exception, [tag, payload, options]); }
        catch (error) { return error === marker; }
        return false;
      });
    })).toEqual([true, true, true]);
  });

  it('defaults null or omitted options and converts traceStack as a boolean', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const tag = new WebAssembly.Tag({ parameters: [] });
      const stacks = [undefined, null, {}, { traceStack: false }].map((options) => {
        const exception = Reflect.construct(WebAssembly.Exception, [tag, [], options]) as WebAssembly.Exception;
        return exception.stack;
      });
      const exception = Reflect.construct(WebAssembly.Exception, [tag, [], {
        traceStack: { valueOf(): never { throw new Error('Boolean conversion must not call valueOf'); } },
      }]) as WebAssembly.Exception;
      return { stacks, traced: exception.stack === undefined || typeof exception.stack === 'string' };
    })).toEqual({ stacks: [undefined, undefined, undefined, undefined], traced: true });
  });

  it('allocates errors in the constructor realm and rejects unsupported payload values', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const cases: [WebAssembly.Tag, unknown, unknown][] = [
        [new WebAssembly.Tag({ parameters: [] }), [], 42],
        [new WebAssembly.Tag({ parameters: ['i64'] }), [1], {}],
        [new WebAssembly.Tag({ parameters: ['anyfunc'] }), [() => {}], {}],
        [new WebAssembly.Tag({ parameters: ['v128'] }), [0], {}],
      ];
      return cases.map((args) => {
        try { Reflect.construct(foreign.WebAssembly.Exception, args); }
        catch (error) { return error instanceof foreign.TypeError && !(error instanceof TypeError); }
        return false;
      });
    })).toEqual([true, true, true, true]);
  });

  it('requires new and retains native prototype and constructor metadata', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const Constructor = WebAssembly.Exception;
      const tag = new WebAssembly.Tag({ parameters: [] });
      let rejected = false;
      try { Reflect.apply(Constructor, undefined, [tag, []]); }
      catch (error) { rejected = error instanceof TypeError; }
      const exception = new Constructor(tag, []);
      return {
        rejected, name: Constructor.name, length: Constructor.length,
        constructor: Constructor.prototype.constructor === Constructor,
        prototype: Object.getPrototypeOf(exception) === Constructor.prototype,
        description: Object.prototype.toString.call(exception), is: exception.is(tag),
      };
    })).toEqual({
      rejected: true, name: 'Exception', length: 2, constructor: true,
      prototype: true, description: '[object WebAssembly.Exception]', is: true,
    });
  });

  it('preserves subclassing and constructor ownership', async () => {
    const browser = fixture();
    await browser.evaluate(() => {
      const tag = new WebAssembly.Tag({ parameters: [] });
      class Derived extends WebAssembly.Exception {}
      const exception = new Derived(tag, []);
      if (!(exception instanceof Derived) || !(exception instanceof WebAssembly.Exception)) throw new Error('Subclass prototype lost');
      Reflect.set(globalThis, 'nativeException', exception);
    });
    const exception = Reflect.get(browser.window, 'nativeException') as WebAssembly.Exception;
    const record = getPlatformRecord(exception, PlatformRecordSource.Platform)!;
    expect(record).toBeDefined();
    expect(record.realm).toBe(getRelevantRealm(browser.window));
    expect(record.implInst).not.toBe(exception);
    expect(record.implInst.constructor.name).toBe('WasmExceptionImpl');
    expect(record.platformObject).toBe(exception);
  });

  it('retains constructor ownership when newTarget selects a foreign prototype', async () => {
    const browser = fixture();
    await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const tag = new foreign.WebAssembly.Tag({ parameters: [] });
      Reflect.set(globalThis, 'nativeException', Reflect.construct(WebAssembly.Exception, [tag, []], foreign.WebAssembly.Exception));
    });
    const exception = Reflect.get(browser.window, 'nativeException') as WebAssembly.Exception;
    const foreign = Reflect.get(browser.window, 'foreign') as typeof globalThis;
    expect(Object.getPrototypeOf(exception)).toBe(foreign.WebAssembly.Exception.prototype);
    expect(getPlatformRecord(exception, PlatformRecordSource.Platform)!.realm).toBe(getRelevantRealm(browser.window));
  });

  it('uses captured constructors after the author replaces the namespace property', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const Constructor = WebAssembly.Exception;
      const tag = new WebAssembly.Tag({ parameters: [] });
      Reflect.set(WebAssembly, 'Exception', function Replacement() { throw new Error('replacement invoked'); });
      return new Constructor(tag, []).is(tag);
    })).toBe(true);
  });

  // Each assertion isolates one step of an engine throw reaching author code
  // directly, without a Web IDL call that could replace the exception object.
  it.each(['instanceof', 'is', 'getArg'] as const)('supports %s on a Wasm-thrown Exception', async (operation) => {
    const browser = fixture();
    expect(await browser.evaluate(({ bytes, operation }) => {
      const tag = new WebAssembly.Tag({ parameters: ['i32'] });
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      const instance = Reflect.construct(WebAssembly.Instance, [module, { env: { tag } }]) as WebAssembly.Instance;
      try { (instance.exports.throw as (value: number) => never)(42); }
      catch (error) {
        const exception = error as WebAssembly.Exception;
        if (operation === 'instanceof') return exception instanceof WebAssembly.Exception;
        if (operation === 'is') return exception.is(tag);
        return exception.getArg(tag, 0) === 42;
      }
      return false;
    }, { bytes: throwingModule, operation })).toBe(true);
  });

  it('accepts a frozen foreign Wasm exception through borrowed public methods after prototype removal', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const tag = new foreign.WebAssembly.Tag({ parameters: ['i32'] });
      const module = new foreign.WebAssembly.Module(new Uint8Array(bytes));
      const instance = Reflect.construct(foreign.WebAssembly.Instance, [module, { env: { tag } }]) as WebAssembly.Instance;
      try { (instance.exports.throw as (value: number) => never)(7); }
      catch (exception) {
        Object.setPrototypeOf(exception, null);
        Object.freeze(exception);
        return WebAssembly.Exception.prototype.is.call(exception, tag) &&
          WebAssembly.Exception.prototype.getArg.call(exception, tag, 0) === 7;
      }
      return false;
    }, throwingModule)).toBe(true);
  });

  it('keeps native typed function identity and the Exception prototype after namespace replacement', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const Constructor = WebAssembly.Exception;
      const tag = new WebAssembly.Tag({ parameters: ['i32'] });
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      const instance = Reflect.construct(WebAssembly.Instance, [module, { env: { tag } }]) as WebAssembly.Instance;
      const throwFunction = instance.exports.throw as (value: number) => never;
      const table = new WebAssembly.Table({ element: 'anyfunc', initial: 1 });
      table.set(0, throwFunction);
      if (table.get(0) !== throwFunction) return false;
      Reflect.set(WebAssembly, 'Exception', function Replacement() { throw new Error('replacement invoked'); });
      try { (table.get(0) as (value: number) => never)(42); }
      catch (error) {
        return error instanceof Constructor && Object.getPrototypeOf(error) === Constructor.prototype &&
          error.is(tag) && error.getArg(tag, 0) === 42;
      }
      return false;
    }, throwingModule)).toBe(true);
  });

  it('applies Web IDL conversion and the method realm to a frozen engine-created receiver', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const tag = new foreign.WebAssembly.Tag({ parameters: ['i32'] });
      const module = new foreign.WebAssembly.Module(new Uint8Array(bytes));
      const instance = Reflect.construct(foreign.WebAssembly.Instance, [module, { env: { tag } }]) as WebAssembly.Instance;
      let exception: unknown;
      try { (instance.exports.throw as (value: number) => never)(42); }
      catch (error) { exception = error; }
      Object.setPrototypeOf(exception, null);
      Object.freeze(exception);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise a borrowed method with an explicit foreign receiver.
      const getArg = WebAssembly.Exception.prototype.getArg;
      const value: unknown = getArg.call(exception, tag, -0.5);
      let conversions = 0;
      const invalidIndex = { valueOf() { conversions++; return -1; } };
      let rejected = false;
      try { Reflect.apply(getArg, exception, [tag, invalidIndex]); }
      catch (error) { rejected = error instanceof TypeError && !(error instanceof foreign.TypeError); }
      return [value, conversions, rejected];
    }, throwingModule)).toEqual([42, 1, true]);
  });

  // https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal
  it.each([false, true])('rejects cloning an engine Exception before reading properties (method called: %s)', async (callMethod) => {
    const browser = fixture();
    expect(await browser.evaluate(({ bytes, callMethod }) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const tag = new foreign.WebAssembly.Tag({ parameters: ['i32'] });
      const module = new foreign.WebAssembly.Module(new Uint8Array(bytes));
      const instance = Reflect.construct(foreign.WebAssembly.Instance, [module, { env: { tag } }]) as WebAssembly.Instance;
      let exception: unknown;
      try { (instance.exports.throw as (value: number) => never)(42); }
      catch (error) { exception = error; }
      let reads = 0;
      Object.defineProperty(exception, 'extra', { enumerable: true, get() { reads++; return 'author data'; } });
      Object.setPrototypeOf(exception, null);
      Object.freeze(exception);
      if (callMethod) WebAssembly.Exception.prototype.is.call(exception, tag);
      let result = 'cloned';
      try { structuredClone(exception); }
      catch (error) { result = error instanceof DOMException ? error.name : 'wrong error'; }
      return [result, reads];
    }, { bytes: throwingModule, callMethod })).toEqual(['DataCloneError', 0]);
  });
});

function fixture(): Browlet {
  const browser = new Browlet({ route: () => '', reporting: false });
  Reflect.set(browser.window, 'foreign', createSiblingWindow(browser));
  return browser;
}

// (module (import "env" "tag" (tag (param i32)))
//   (func (export "throw") (param i32) (throw 0 (local.get 0))))
const throwingModule = [
  0, 97, 115, 109, 1, 0, 0, 0,
  1, 5, 1, 96, 1, 127, 0,
  2, 12, 1, 3, 101, 110, 118, 3, 116, 97, 103, 4, 0, 0,
  3, 2, 1, 0,
  7, 9, 1, 5, 116, 104, 114, 111, 119, 0, 0,
  10, 8, 1, 6, 0, 32, 0, 8, 0, 11,
];
