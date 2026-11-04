import { describe, expect, it } from 'vitest';
import { itPassesWith } from '../../test-runtime';

import { Browlet } from '../../../src/browlet/browlet';
import { BrowsingContext, DocumentState, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

// WebAssembly JavaScript API §5.6. These are engine functions, not Web IDL callback objects.
describe('WebAssembly Exported Functions', () => {
  it('exposes builtin function metadata, ignores the receiver, and rejects construction', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const fn = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source))).exports.run as Callable;
      const length = Object.getOwnPropertyDescriptor(fn, 'length')!;
      const name = Object.getOwnPropertyDescriptor(fn, 'name')!;
      let rejected = false;
      try { Reflect.construct(fn, [1, 2]); } catch (error) { rejected = error instanceof TypeError; }
      return {
        name: fn.name, length: fn.length, ownPrototype: Object.hasOwn(fn, 'prototype'), rejected,
        functionPrototype: Object.getPrototypeOf(fn) === Function.prototype,
        descriptors: [length, name].every((descriptor) => !descriptor.writable && !descriptor.enumerable && descriptor.configurable),
        values: [fn(2, 3), Reflect.apply(fn, null, [3, 4]), Reflect.apply(fn, document, [4, 5])],
      };
    }, functionModule([i32, i32], [i32], [0x20, 0, 0x20, 1, 0x6a]))).toEqual({
      name: '0', length: 2, ownPrototype: false, rejected: true, functionPrototype: true,
      descriptors: true, values: [5, 7, 9],
    });
  });

  it('retains function identities and originating realms through aliases and foreign re-exports', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const module = new WebAssembly.Module(new Uint8Array(source));
      const original = new foreign.WebAssembly.Instance(module, { env: { fn: () => 42 } }).exports;
      const run = original.run as Callable;
      const first = new WebAssembly.Instance(module, { env: { fn: run } }).exports;
      const second = new WebAssembly.Instance(module, { env: { fn: run } }).exports;
      return {
        aliases: original.run === original.alias, reexports: first.imported === run && second.imported === run,
        distinct: first.run !== second.run, names: [run.name, (original.imported as Callable).name],
        originalRealm: Object.getPrototypeOf(first.imported) === foreign.Function.prototype,
        newRealm: Object.getPrototypeOf(first.run) === Function.prototype, result: run(),
      };
    }, importedFunctionModule([], [i32]))).toEqual({
      aliases: true, reexports: true, distinct: true, names: ['1', '0'], originalRealm: true, newRealm: true, result: 42,
    });
  });

  it('converts numeric arguments and results, including wrapping integers and preserving special floats', async () => {
    const browser = fixture();
    expect(await browser.evaluate((sources) => {
      const functions = sources.map((source) =>
        new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source))).exports.run as Callable);
      const [int, big, single, double] = functions as [Callable, Callable, Callable, Callable];
      return {
        integers: [int(2 ** 32 + 3), int(-3.75), int(NaN), int(Infinity)],
        big: [String(big(2n ** 64n + 5n)), String(big('9223372036854775808'))],
        floats: [single(1 / 3) === Math.fround(1 / 3), Object.is(single(-0), -0),
          double(Infinity) === Infinity, Number.isNaN(double(NaN)), Object.is(double(-0), -0)],
      };
    }, [i32, i64, f32, f64].map((type) => functionModule([type], [type], [0x20, 0])))).toEqual({
      integers: [3, -3, 0, 0], big: ['5', '-9223372036854775808'], floats: [true, true, true, true, true],
    });
  });

  it('converts arguments in order, stops at abrupt completion, and ignores surplus arguments', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const fn = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source))).exports.run as Callable;
      const trace: string[] = [];
      const marker = new Error('argument');
      const first = { valueOf() { trace.push('first'); return 2; } };
      const second = { valueOf() { trace.push('second'); return 3; } };
      const extra = { valueOf() { throw new Error('Surplus argument converted'); } };
      const value = fn(first, second, extra);
      let same = false;
      try { fn({ valueOf() { trace.push('throw'); throw marker; } }, second); }
      catch (error) { same = error === marker; }
      return { value, trace, same, missing: fn() };
    }, functionModule([i32, i32], [i32], [0x20, 0, 0x20, 1, 0x6a]))).toEqual({
      value: 5, trace: ['first', 'second', 'throw'], same: true, missing: 0,
    });
  });

  it('uses undefined for missing arguments and rejects Number/BigInt mixing in the callee realm', async () => {
    const browser = fixture();
    expect(await browser.evaluate((sources) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const [big, double] = sources.map((source) =>
        new foreign.WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source))).exports.run as Callable) as [Callable, Callable];
      const rejected = [() => big(), () => big(1), () => double(1n), () => double(Symbol())].every((call) => {
        try { call(); } catch (error) { return error instanceof foreign.TypeError; }
        return false;
      });
      return { rejected, missingFloat: Number.isNaN(double()) };
    }, [i64, f64].map((type) => functionModule([type], [type], [0x20, 0])))).toEqual({ rejected: true, missingFloat: true });
  });

  it('returns undefined, scalar values, or fresh callee-realm arrays according to result arity', async () => {
    const browser = fixture();
    expect(await browser.evaluate(({ empty, scalar, tuple }) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const [noResult, one, many] = [empty, scalar, tuple].map((source) =>
        new foreign.WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source))).exports.run as Callable) as [Callable, Callable, Callable];
      const first = many(3, 4n, document) as unknown[];
      const second = many(3, 4n, document) as unknown[];
      return {
        noResult: noResult() === undefined, scalar: one(7),
        tuple: [first[0], String(first[1]), first[2] === document],
        realm: Object.getPrototypeOf(first) === foreign.Array.prototype,
        fresh: first !== second, descriptors: Object.getOwnPropertyDescriptor(first, '0'),
      };
    }, {
      empty: functionModule([], [], []), scalar: functionModule([i32], [i32], [0x20, 0]),
      tuple: functionModule([i32, i64, externref], [i32, i64, externref], [0x20, 0, 0x20, 1, 0x20, 2]),
    })).toEqual({
      noResult: true, scalar: 7, tuple: [3, '4', true], realm: true, fresh: true,
      descriptors: { value: 3, writable: true, enumerable: true, configurable: true },
    });
  });

  it('preserves externref values without coercion and only accepts native Wasm functions as funcref', async () => {
    const browser = fixture();
    expect(await browser.evaluate(({ external, functionRef, callable }) => {
      const instantiate = (source: number[]) =>
        new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source))).exports.run as Callable;
      const echo = instantiate(external);
      const fn = instantiate(callable);
      const ref = instantiate(functionRef);
      const values = [undefined, null, -0, NaN, 1n, Symbol(), document, {}, fn,
        { [Symbol.toPrimitive]() { throw new Error('Value coerced'); } }];
      const invalid = [undefined, {}, () => 1, fn.bind(null), new Proxy(fn, {})].every((value) => {
        try { ref(value); } catch (error) { return error instanceof TypeError; }
        return false;
      });
      return { externref: values.every((value) => Object.is(echo(value), value)), native: ref(fn) === fn, null: ref(null), invalid };
    }, {
      external: functionModule([externref], [externref], [0x20, 0]),
      functionRef: functionModule([funcref], [funcref], [0x20, 0]), callable: functionModule([], [], []),
    })).toEqual({ externref: true, native: true, null: null, invalid: true });
  });

  it('rejects vector signatures on each call before converting arguments', async () => {
    const browser = fixture();
    expect(await browser.evaluate((sources) => {
      let conversions = 0;
      const argument = { valueOf() { conversions++; return 1; } };
      const rejected = sources.every((source) => {
        const fn = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source))).exports.run as Callable;
        return [1, 2].every(() => {
          try { fn(argument); } catch (error) { return error instanceof TypeError; }
          return false;
        });
      });
      return { rejected, conversions };
    }, [
      functionModule([i32, v128], [], []),
      functionModule([i32], [v128], [0xfd, 0x0c, ...Array<number>(16).fill(0)]),
    ])).toEqual({ rejected: true, conversions: 0 });
  });

  it('reports native traps in the exported function realm', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const fn = new foreign.WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source))).exports.run as Callable;
      try { fn(); } catch (error) { return error instanceof foreign.WebAssembly.RuntimeError; }
      return false;
    }, functionModule([], [], [0x00]))).toBe(true);
  });

  it('calls a strict imported function with undefined this and converts its arguments and scalar return', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      let receiverIsUndefined = false;
      let argument: unknown;
      let returns = 0;
      const fn = function(this: unknown, value: unknown) {
        'use strict';
        receiverIsUndefined = this === undefined;
        argument = value;
        return { valueOf() { returns++; return 2 ** 32 + 9; } };
      };
      const run = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source)), { env: { fn } }).exports.run as Callable;
      return { result: Reflect.apply(run, document, [2 ** 32 + 7]), receiver: receiverIsUndefined, argument, returns };
    }, importedFunctionModule([i32], [i32]))).toEqual({ result: 9, receiver: true, argument: 7, returns: 1 });
  });

  it('finishes iterating a multi-value host result before converting its entries', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const trace: string[] = [];
      const fn = () => ({
        *[Symbol.iterator]() {
          trace.push('first');
          yield { valueOf() { trace.push('convert first'); return 3; } };
          trace.push('second');
          yield { valueOf() { trace.push('convert second'); return 4n; } };
          trace.push('done');
        },
      });
      const run = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source)), { env: { fn } }).exports.run as Callable;
      const result = run() as unknown[];
      return { trace, result: [result[0], String(result[1])] };
    }, importedFunctionModule([], [i32, i64]))).toEqual({
      trace: ['first', 'second', 'done', 'convert first', 'convert second'], result: [3, '4'],
    });
  });

  it('checks host result arity before coercion and preserves iterator exceptions', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const module = new WebAssembly.Module(new Uint8Array(source));
      let conversions = 0;
      const value = { valueOf() { conversions++; return 1; } };
      const invalid = [null, {}, [value], [value, value, value]].every((result) => {
        const run = new WebAssembly.Instance(module, { env: { fn: () => result } }).exports.run as Callable;
        try { run(); } catch (error) { return error instanceof TypeError; }
        return false;
      });
      const marker = new Error('iterator');
      const run = new WebAssembly.Instance(module, { env: { fn: () => ({ *[Symbol.iterator]() { yield value; throw marker; } }) } }).exports.run as Callable;
      let same = false;
      try { run(); } catch (error) { same = error === marker; }
      return { invalid, conversions, same };
    }, importedFunctionModule([], [i32, i32]))).toEqual({ invalid: true, conversions: 0, same: true });
  });

  it('preserves JavaScript and Wasm exception identity through imported functions', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const module = new WebAssembly.Module(new Uint8Array(source));
      const values = [undefined, null, 3, Symbol(), {}, new Error('host'),
        new WebAssembly.Exception(new WebAssembly.Tag({ parameters: ['externref'] }), [document])];
      return values.every((value) => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Arbitrary JavaScript throw values must survive Wasm.
        const run = new WebAssembly.Instance(module, { env: { fn: () => { throw value; } } }).exports.run as Callable;
        try { run(); } catch (error) { return error === value; }
        return false;
      });
    }, importedFunctionModule([], []))).toBe(true);
  });

  it.each(['constructor', 'module', 'bytes'])('prepares and cleans up an imported callback through %s instantiation', async (path) => {
    const browser = callbackFixture();
    expect(await browser.evaluate(async ({ source, path }) => {
      const read = Reflect.get(globalThis, 'readCallbackState') as () => CallbackState;
      const module = new WebAssembly.Module(new Uint8Array(source));
      const imports = { env: { fn: () => read() } };
      const instance = path === 'constructor' ? new WebAssembly.Instance(module, imports) : path === 'module'
        ? await WebAssembly.instantiate(module, imports) : (await WebAssembly.instantiate(new Uint8Array(source), imports)).instance;
      const run = instance.exports.run as Callable;
      const before = read();
      const during = run() as ReturnType<typeof read>;
      const after = read();
      return {
        scriptEntries: during.scripts - before.scripts, callbackEntries: during.callbacks - before.callbacks,
        storedSettings: during.storedSettings,
        restored: after.scripts === before.scripts && after.callbacks === before.callbacks,
      };
    }, { source: importedFunctionModule([], [externref]), path })).toEqual({
      scriptEntries: 1, callbackEntries: 1, storedSettings: true, restored: true,
    });
  });

  it.each(['data', 'accessors'])('adapts frozen %s imports without changing receivers or function-valued globals', async (kind) => {
    const browser = callbackFixture();
    expect(await browser.evaluate(({ source, kind }) => {
      const read = Reflect.get(globalThis, 'readCallbackState') as () => CallbackState;
      const trace: string[] = [];
      const fn = () => read();
      const namespace = Object.freeze(kind === 'data' ? { fn } : {
        get fn() { trace.push(this === namespace ? 'fn' : 'wrong field receiver'); return fn; },
      });
      const imports = Object.freeze(kind === 'data' ? { env: namespace } : {
        get env() { trace.push(this === imports ? 'env' : 'wrong module receiver'); return namespace; },
      });
      // The adapter must use retained intrinsics, not these replaceable public methods.
      WebAssembly.Module.imports = () => { throw new Error('Replaced import reflection'); };
      WebAssembly.Table.prototype.grow = () => { throw new Error('Replaced function recognition'); };
      const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source)), imports);
      const before = read();
      const first = (instance.exports.first as Callable)() as CallbackState;
      const second = (instance.exports.second as Callable)() as CallbackState;
      return {
        trace, depths: [first, second].map((state) => state.callbacks - before.callbacks),
        globalUnchanged: (instance.exports.value as WebAssembly.Global).value === fn,
      };
    }, { source: mixedImportsModule, kind })).toEqual({
      trace: kind === 'data' ? [] : ['env', 'fn', 'env', 'fn', 'env', 'fn'], depths: [1, 1], globalUnchanged: true,
    });
  });

  it('carries the initiating settings through foreign byte compilation and later import reads', async () => {
    const browser = callbackFixture();
    const foreign = getRelevantRealm(Reflect.get(browser.window, 'foreign') as typeof browser.window);
    const document = foreign.getAssociatedDocument();
    document.browsingContext = new BrowsingContext(foreign.windowProxy);
    document.makeActive();
    new TopLevelTraversable(DocumentState.create(document));
    expect(await browser.evaluate(async (source) => {
      const read = Reflect.get(globalThis, 'readCallbackState') as () => CallbackState;
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const reads: CallbackState[] = [];
      const imports = { get env() { reads.push(read()); return { fn: () => read() }; } };
      const { instance } = await foreign.WebAssembly.instantiate(new Uint8Array(source), imports);
      const during = (instance.exports.run as Callable)() as CallbackState;
      return { reads: reads.map((state) => state.storedSettings), callbackStored: during.storedSettings };
    }, importedFunctionModule([], [externref]))).toEqual({ reads: [true], callbackStored: true });
  });

  it('keeps function import lookup aligned when the engine supplies builtins and string constants', async () => {
    const browser = callbackFixture();
    expect(await browser.evaluate((source) => {
      const read = Reflect.get(globalThis, 'readCallbackState') as () => CallbackState;
      const trace: string[] = [];
      const module = new WebAssembly.Module(new Uint8Array(source), { builtins: ['js-string'], importedStringConstants: 'strings' });
      let during: CallbackState | undefined;
      const { exports } = new WebAssembly.Instance(module, {
        get env() {
          trace.push('env');
          return { get fn() { trace.push('fn'); return () => { during = read(); return 7; }; } };
        },
      });
      const before = read();
      const value = (exports.run as Callable)();
      return {
        trace, value, depth: during!.callbacks - before.callbacks,
        hello: (exports.hello as WebAssembly.Global).value as unknown, length: (exports.length as Callable)('hello'),
      };
    }, builtinHostModule)).toEqual({ trace: ['env', 'fn'], value: 7, depth: 1, hello: 'hello', length: 5 });
  });

  it.each(['bound', 'proxy'])('prepares ordinary %s callables as host callbacks', async (kind) => {
    const browser = callbackFixture();
    expect(await browser.evaluate(({ source, kind }) => {
      const read = Reflect.get(globalThis, 'readCallbackState') as () => CallbackState;
      const original = () => read();
      const fn = kind === 'bound' ? original.bind(null) : new Proxy(original, {});
      const run = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source)), { env: { fn } }).exports.run as Callable;
      const before = read();
      const during = run() as CallbackState;
      return { scripts: during.scripts - before.scripts, callbacks: during.callbacks - before.callbacks, stored: during.storedSettings };
    }, { source: importedFunctionModule([], [externref]), kind })).toEqual({ scripts: 1, callbacks: 1, stored: true });
  });

  it.each(['before', 'after'])('defers errors for callable Proxies revoked %s import until invocation', async (when) => {
    const browser = callbackFixture();
    expect(await browser.evaluate(({ source, when }) => {
      const read = Reflect.get(globalThis, 'readCallbackState') as () => CallbackState;
      const { proxy, revoke } = Proxy.revocable(() => 1, {});
      if (when === 'before') revoke();
      const run = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source)), { env: { fn: proxy } }).exports.run as Callable;
      if (when === 'after') revoke();
      const before = read();
      let threw = false;
      try { run(); } catch { threw = true; }
      const after = read();
      return { threw, restored: before.scripts === after.scripts && before.callbacks === after.callbacks };
    }, { source: importedFunctionModule([], [i32]), when })).toEqual({ threw: true, restored: true });
  });

  // A wrapper that cleans up as soon as the JS function returns is too short-lived:
  // run a host function includes result conversion, which may execute more author code.
  // The addon bridge completes conversion here; stock Node still lacks signature access.
  itPassesWith('wasmImportCalls').each([false, true])('keeps scalar result conversion inside the callback scope (throws: %s)', async (throws) => {
    const browser = callbackFixture();
    expect(await browser.evaluate(({ source, throws }) => {
      const read = Reflect.get(globalThis, 'readCallbackState') as () => CallbackState;
      const states: CallbackState[] = [];
      const marker = new Error('result conversion');
      const fn = () => ({
        valueOf() {
          states.push(read());
          if (throws) throw marker;
          return 7;
        },
      });
      const run = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source)), { env: { fn } }).exports.run as Callable;
      const before = read();
      let outcome: unknown;
      try { outcome = run(); } catch (error) { outcome = error === marker ? 'marker' : 'unexpected exception'; }
      const after = read();
      return {
        outcome, scopes: states.map((state) => ({
          scripts: state.scripts - before.scripts, callbacks: state.callbacks - before.callbacks, stored: state.storedSettings,
        })),
        restored: after.scripts === before.scripts && after.callbacks === before.callbacks,
      };
    }, { source: importedFunctionModule([], [i32]), throws })).toEqual({
      outcome: throws ? 'marker' : 7, scopes: [{ scripts: 1, callbacks: 1, stored: true }], restored: true,
    });
  });

  itPassesWith('wasmImportCalls').each([false, true])('keeps multi-value iteration and conversion inside the callback scope (iterator throws: %s)', async (throws) => {
    const browser = callbackFixture();
    expect(await browser.evaluate(({ source, throws }) => {
      const read = Reflect.get(globalThis, 'readCallbackState') as () => CallbackState;
      const states: { step: string; state: CallbackState; }[] = [];
      const record = (step: string) => { states.push({ step, state: read() }); };
      const marker = new Error('result iterator');
      const fn = () => ({
        get [Symbol.iterator]() {
          record('get iterator');
          return function*() {
            record('next 1');
            yield { valueOf() { record('convert 1'); return 3; } };
            record('next 2');
            if (throws) throw marker;
            yield { valueOf() { record('convert 2'); return 4; } };
            record('done');
          };
        },
      });
      const run = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source)), { env: { fn } }).exports.run as Callable;
      const before = read();
      let outcome: unknown;
      try { outcome = run(); } catch (error) { outcome = error === marker ? 'marker' : 'unexpected exception'; }
      const after = read();
      return {
        outcome, scopes: states.map(({ step, state }) => ({
          step, scripts: state.scripts - before.scripts, callbacks: state.callbacks - before.callbacks, stored: state.storedSettings,
        })),
        restored: after.scripts === before.scripts && after.callbacks === before.callbacks,
      };
    }, { source: importedFunctionModule([], [i32, i32]), throws })).toEqual({
      outcome: throws ? 'marker' : [3, 4],
      scopes: (throws ? ['get iterator', 'next 1', 'next 2']
        : ['get iterator', 'next 1', 'next 2', 'done', 'convert 1', 'convert 2']).map((step) => ({
        step, scripts: 1, callbacks: 1, stored: true,
      })),
      restored: true,
    });
  });

  it('keeps the conversion bridge independent of replaced exports and Array iterators', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const module = new WebAssembly.Module(new Uint8Array(source));
      const run = new WebAssembly.Instance(module, {
        env: { fn: function*() { yield 3; yield 4; } },
      }).exports.run as () => number[];
      const descriptor = Object.getOwnPropertyDescriptor(WebAssembly.Instance.prototype, 'exports')!;
      const iterator = Array.prototype[Symbol.iterator];
      const fail = () => { throw new Error('author replacement invoked'); };
      Object.defineProperty(WebAssembly.Instance.prototype, 'exports', { get: fail });
      Array.prototype[Symbol.iterator] = fail;
      try {
        const result = run();
        return { first: result[0], second: result[1] };
      } finally {
        Object.defineProperty(WebAssembly.Instance.prototype, 'exports', descriptor);
        Array.prototype[Symbol.iterator] = iterator;
      }
    }, importedFunctionModule([], [i32, i32]))).toEqual({ first: 3, second: 4 });
  });

  it('restores the outer callback scope when a nested Wasm callback throws', async () => {
    const browser = callbackFixture();
    expect(await browser.evaluate((source) => {
      const read = Reflect.get(globalThis, 'readCallbackState') as () => CallbackState;
      const module = new WebAssembly.Module(new Uint8Array(source));
      const states: CallbackState[] = [];
      const marker = new Error('nested callback');
      const inner = new WebAssembly.Instance(module, { env: { fn: () => { states.push(read()); throw marker; } } }).exports.run as Callable;
      let same = false;
      const outer = new WebAssembly.Instance(module, {
        env: {
          fn: () => {
            states.push(read());
            try { inner(); } catch (error) { same = error === marker; }
            states.push(read());
            return 9;
          },
        },
      }).exports.run as Callable;
      const before = read();
      const result = outer();
      const after = read();
      return {
        result, same, scopes: states.map((state) => ({
          scripts: state.scripts - before.scripts, callbacks: state.callbacks - before.callbacks, stored: state.storedSettings,
        })),
        restored: after.scripts === before.scripts && after.callbacks === before.callbacks,
      };
    }, importedFunctionModule([], [i32]))).toEqual({
      result: 9, same: true, scopes: [1, 2, 1].map((depth) => ({ scripts: depth, callbacks: depth, stored: true })), restored: true,
    });
  });

  // A calls B's author function to instantiate in C; the callback belongs to C,
  // but importing it must save B. A later call from A must not replace that saved B.
  // Stock Node still lacks the native entry that can observe B's author frame.
  itPassesWith('platformEntries').each(['constructor', 'module', 'bytes'])('saves B while running C callbacks after A-to-B %s registration', async (path) => {
    const browser = fixture();
    const a = getRelevantRealm(browser.window);
    const b = getRelevantRealm(Reflect.get(browser.window, 'foreign') as object);
    const cWindow = createSiblingWindow(browser);
    const c = getRelevantRealm(cWindow);
    // Asynchronous instantiation queues an HTML task in C, requiring an active Document.
    const document = c.getAssociatedDocument();
    document.browsingContext = new BrowsingContext(c.windowProxy);
    document.makeActive();
    new TopLevelTraversable(DocumentState.create(document));
    const loop = a.env.responsibleEventLoop;
    Reflect.set(cWindow, 'readCallbackState', () => ({
      callbackRealm: loop.runningExecutionContext?.realm === c,
      storedB: loop.backupIncumbentEnvironmentStack.at(-1) === b.env,
    }));
    // These two functions must originate in distinct realms; the public exercise
    // below still enters through Browlet.evaluate() and the author-facing API.
    const callback = c.evaluate('() => readCallbackState()', 'wasm-callback-c.js');
    const register = b.evaluate(`(path, wasm, source, callback) => {
      const imports = { env: { fn: callback } };
      return path === 'constructor' ? new wasm.Instance(source, imports) : wasm.instantiate(source, imports);
    }`, 'wasm-registration-b.js');
    Reflect.set(browser.window, 'registerInB', register);
    Reflect.set(browser.window, 'callbackInC', callback);
    Reflect.set(browser.window, 'windowC', cWindow);
    expect(await browser.evaluate(async ({ source, path }) => {
      const c = Reflect.get(globalThis, 'windowC') as typeof globalThis;
      const register = Reflect.get(globalThis, 'registerInB') as
        (path: string, wasm: typeof WebAssembly, source: WebAssembly.Module | Uint8Array, callback: Callable) =>
          WebAssembly.Instance | Promise<WebAssembly.Instance | WebAssembly.WebAssemblyInstantiatedSource>;
      const callback = Reflect.get(globalThis, 'callbackInC') as Callable;
      const bytes = new Uint8Array(source);
      const result = await register(path, c.WebAssembly, path === 'bytes' ? bytes : new WebAssembly.Module(bytes), callback);
      const instance = 'instance' in result ? result.instance : result;
      return (instance.exports.run as Callable)();
    }, { source: importedFunctionModule([], [externref]), path })).toEqual({ callbackRealm: true, storedB: true });
    expect(loop.executionContextStack).toEqual([]);
    expect(loop.backupIncumbentEnvironmentStack).toEqual([]);
  });
});

function fixture(): Browlet {
  const browser = new Browlet({ route: () => '', reporting: false });
  Reflect.set(browser.window, 'foreign', createSiblingWindow(browser));
  return browser;
}

function callbackFixture(): Browlet {
  const browser = fixture();
  const { env } = getRelevantRealm(browser.window);
  const loop = env.responsibleEventLoop;
  Reflect.set(browser.window, 'readCallbackState', (): CallbackState => ({
    scripts: loop.executionContextStack.length,
    callbacks: loop.backupIncumbentEnvironmentStack.length,
    storedSettings: loop.backupIncumbentEnvironmentStack.at(-1) === env,
  }));
  return browser;
}

interface CallbackState {
  scripts: number;
  callbacks: number;
  storedSettings: boolean;
}

type Callable = (...argumentsList: unknown[]) => unknown;

const i32 = 0x7f, i64 = 0x7e, f32 = 0x7d, f64 = 0x7c, v128 = 0x7b, funcref = 0x70, externref = 0x6f;
const header = [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]; // \0asm, binary format version 1.

// (module (import "env" "fn" (func (result externref)))
//   (import "env" "fn" (func (result externref))) (import "env" "fn" (global externref))
//   (export "first" (func 0)) (export "second" (func 1)) (export "value" (global 0)))
const mixedImportsModule = [
  ...header, 1, 5, 1, 96, 0, 1, 111,
  2, 29, 3, 3, 101, 110, 118, 2, 102, 110, 0, 0,
  3, 101, 110, 118, 2, 102, 110, 0, 0, 3, 101, 110, 118, 2, 102, 110, 3, 111, 0,
  7, 26, 3, 5, 102, 105, 114, 115, 116, 0, 0, 6, 115, 101, 99, 111, 110, 100, 0, 1,
  5, 118, 97, 108, 117, 101, 3, 0,
];

// (module (import "strings" "hello" (global externref))
//   (import "wasm:js-string" "length" (func (param externref) (result i32)))
//   (import "env" "fn" (func (param externref) (result i32)))
//   (export "hello" (global 0)) (export "length" (func 0)) (export "run" (func 1)))
const builtinHostModule = [
  ...header, 1, 6, 1, 96, 1, 111, 1, 127,
  2, 51, 3, 7, 115, 116, 114, 105, 110, 103, 115, 5, 104, 101, 108, 108, 111, 3, 111, 0,
  14, 119, 97, 115, 109, 58, 106, 115, 45, 115, 116, 114, 105, 110, 103, 6, 108, 101, 110, 103, 116, 104, 0, 0,
  3, 101, 110, 118, 2, 102, 110, 0, 0,
  7, 24, 3, 5, 104, 101, 108, 108, 111, 3, 0, 6, 108, 101, 110, 103, 116, 104, 0, 0,
  3, 114, 117, 110, 0, 1,
];

// Small closed test fixtures: every vector/section/body length below fits one LEB128 byte.
// (module (func (export "run") (param ...parameters) (result ...results) ...instructions))
function functionModule(parameters: number[], results: number[], instructions: number[]): number[] {
  const type = [1, 0x60, parameters.length, ...parameters, results.length, ...results];
  const body = [0, ...instructions, 0x0b]; // No locals; end.
  return [...header,
    1, type.length, ...type, // Type section.
    3, 2, 1, 0, // One function of type 0.
    7, 7, 1, 3, 0x72, 0x75, 0x6e, 0, 0, // Export "run", function 0.
    10, body.length + 2, 1, body.length, ...body,
  ];
}

// (module (import "env" "fn" (func $import (param ...) (result ...)))
//   (func (export "run") (export "alias") (param ...) (result ...) (call $import (local.get 0) ...))
//   (export "imported" (func $import)))
function importedFunctionModule(parameters: number[], results: number[]): number[] {
  const type = [1, 0x60, parameters.length, ...parameters, results.length, ...results];
  const imports = [1, 3, 0x65, 0x6e, 0x76, 2, 0x66, 0x6e, 0, 0];
  const names: [string, number][] = [['run', 1], ['alias', 1], ['imported', 0]];
  const exports = [names.length, ...names.flatMap(([name, index]) =>
    [name.length, ...new TextEncoder().encode(name), 0, index])];
  const body = [0, ...parameters.flatMap((_, index) => [0x20, index]), 0x10, 0, 0x0b];
  return [...header, 1, type.length, ...type, 2, imports.length, ...imports,
    3, 2, 1, 0, 7, exports.length, ...exports, 10, body.length + 2, 1, body.length, ...body,
  ];
}
