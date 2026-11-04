import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { createSiblingWindow } from '../../support/windows';

// WebAssembly JavaScript API §§4.2, 5.6 and 5.9–5.9.1:
// V8 owns exception addresses and caches; Browlet's import adapter must retain them.
describe('WebAssembly exception references', () => {
  it('catches an imported JavaScript-thrown Exception by tag and extracts its payload', async () => {
    const browser = await fixture();
    expect(await browser.evaluate(() => {
      const exports = Reflect.get(globalThis, 'exceptionExports') as ExceptionExports;
      const tag = Reflect.get(globalThis, 'exceptionTag') as WebAssembly.Tag;
      const exception = new WebAssembly.Exception(tag, [document]);
      return exports.catch(exception) === document;
    })).toBe(true);
  });

  it('does not confuse an ordinary JavaScript throw or a different tag with a tagged exception', async () => {
    const browser = await fixture();
    expect(await browser.evaluate(() => {
      const exports = Reflect.get(globalThis, 'exceptionExports') as ExceptionExports;
      const other = new WebAssembly.Tag({ parameters: ['externref'] });
      const values = [new WebAssembly.Exception(other, [document]), document, new Error('ordinary')];
      return values.every((value) => {
        try { exports.catch(value); }
        catch (error) { return error === value; }
        return false;
      });
    })).toBe(true);
  });

  it('keeps a constructed Exception, its subclass, and its properties through repeated cross-realm rethrows', async () => {
    const browser = await fixture();
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const tag = Reflect.get(globalThis, 'exceptionTag') as WebAssembly.Tag;
      class Derived extends WebAssembly.Exception {}
      const exception = new Derived(tag, [document]);
      Object.defineProperty(exception, 'note', { value: 'retained' });
      Object.freeze(exception);
      for (const target of [globalThis, foreign]) {
        const exports = Reflect.get(target, 'exceptionExports') as ExceptionExports;
        exports.capture(exception);
        for (let i = 0; i < 2; i++) {
          let caught = false;
          try { exports.rethrow(); }
          catch (error) { caught = error === exception; }
          if (!caught) return false;
        }
      }
      return exception instanceof Derived && exception.getArg(tag, 0) === document && Reflect.get(exception, 'note') === 'retained';
    })).toBe(true);
  });

  it('caches a Wasm-created exception object when its stored address is thrown repeatedly', async () => {
    const browser = await fixture();
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const exports = Reflect.get(foreign, 'exceptionExports') as ExceptionExports;
      const own = Reflect.get(globalThis, 'exceptionExports') as ExceptionExports;
      const tag = Reflect.get(globalThis, 'exceptionTag') as WebAssembly.Tag;
      exports.captureNative(document);
      let first: unknown, second: unknown, third: unknown;
      try { exports.rethrow(); }
      catch (error) { first = error; }
      try { exports.rethrow(); }
      catch (error) { second = error; }
      own.capture(first);
      try { own.rethrow(); }
      catch (error) { third = error; }
      if (!(first instanceof foreign.WebAssembly.Exception)) return false;
      return first === second && first === third && first.getArg(tag, 0) === document && first.stack === undefined;
    })).toBe(true);
  });

  it('allocates a distinct exception address for each new Wasm throw', async () => {
    const browser = await fixture();
    expect(await browser.evaluate(() => {
      const exports = Reflect.get(globalThis, 'exceptionExports') as ExceptionExports;
      const tag = Reflect.get(globalThis, 'exceptionTag') as WebAssembly.Tag;
      let first: unknown, second: unknown;
      try { exports.throw(document); }
      catch (error) { first = error; }
      try { exports.throw(document); }
      catch (error) { second = error; }
      return first instanceof WebAssembly.Exception && second instanceof WebAssembly.Exception && first !== second &&
        first.getArg(tag, 0) === document && second.getArg(tag, 0) === document;
    })).toBe(true);
  });

  it('unwraps JavaScript thrown values after catch_all_ref and throw_ref, preserving identity', async () => {
    const browser = await fixture();
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const values = [undefined, null, false, NaN, -0, 42, 1n, 'text', Symbol(), document,
        new Error('own'), new foreign.Error('foreign'), Object.create(WebAssembly.Exception.prototype) as object];
      return [globalThis, foreign].every((target) => {
        const exports = Reflect.get(target, 'exceptionExports') as ExceptionExports;
        return values.every((value) => {
          exports.capture(value);
          try { exports.rethrow(); }
          catch (error) { return Object.is(error, value); }
          return false;
        });
      });
    })).toBe(true);
  });

  it('rejects payload extraction and construction for native v128 and exnref tags', async () => {
    const browser = await fixture();
    expect(await browser.evaluate(() => {
      const exports = Reflect.get(globalThis, 'exceptionExports') as ExceptionExports;
      return [[exports.vectorPayload, exports.vectorTag], [exports.exceptionPayload, exports.exceptionTag]]
        .every(([throwPayload, tag]) => {
          let exception: unknown;
          try { Reflect.apply(throwPayload as () => never, undefined, []); }
          catch (error) { exception = error; }
          if (!(exception instanceof WebAssembly.Exception) || !exception.is(tag as WebAssembly.Tag)) return false;
          let getRejected = false, constructRejected = false;
          try { exception.getArg(tag as WebAssembly.Tag, 0); }
          catch (error) { getRejected = error instanceof TypeError; }
          try { new WebAssembly.Exception(tag as WebAssembly.Tag, [null]); }
          catch (error) { constructRejected = error instanceof TypeError; }
          return getRejected && constructRejected;
        });
    })).toBe(true);
  });

  it('keeps exnref values inside Wasm rather than exposing them as JavaScript function values', async () => {
    const browser = await fixture();
    expect(await browser.evaluate(() => {
      const exports = Reflect.get(globalThis, 'exceptionExports') as ExceptionExports;
      const tag = Reflect.get(globalThis, 'exceptionTag') as WebAssembly.Tag;
      const exception = new WebAssembly.Exception(tag, [document]);
      exports.capture(exception);
      return [() => exports.readRef(), () => exports.acceptRef(exception), () => exports.acceptRef(null)].every((call) => {
        try { call(); }
        catch (error) { return error instanceof TypeError; }
        return false;
      });
    })).toBe(true);
  });

  it('traps when throw_ref receives a null exception reference', async () => {
    const browser = await fixture();
    expect(await browser.evaluate(() => {
      const exports = Reflect.get(globalThis, 'exceptionExports') as ExceptionExports;
      try { exports.rethrow(); }
      catch (error) { return error instanceof WebAssembly.RuntimeError && !(error instanceof WebAssembly.Exception); }
      return false;
    })).toBe(true);
  });
});

async function fixture(): Promise<Browlet> {
  const browser = new Browlet({ route: () => '', reporting: false });
  Reflect.set(browser.window, 'foreign', createSiblingWindow(browser));
  await browser.evaluate((bytes) => {
    const tag = new WebAssembly.Tag({ parameters: ['externref'] });
    Reflect.set(globalThis, 'exceptionTag', tag);
    for (const target of [globalThis, Reflect.get(globalThis, 'foreign') as typeof globalThis]) {
      const module = new target.WebAssembly.Module(new Uint8Array(bytes));
      const imports = { env: { tag, throw(value: unknown): never { throw value; } } };
      const instance = Reflect.construct(target.WebAssembly.Instance, [module, imports]) as WebAssembly.Instance;
      Reflect.set(target, 'exceptionExports', instance.exports);
    }
  }, exceptionModule());
  return browser;
}

interface ExceptionExports {
  throw(value: unknown): never;
  capture(value: unknown): void;
  captureNative(value: unknown): void;
  rethrow(): never;
  catch(value: unknown): unknown;
  vectorPayload(this: void): never;
  exceptionPayload(this: void): never;
  readRef(): unknown;
  acceptRef(value: unknown): void;
  vectorTag: WebAssembly.Tag;
  exceptionTag: WebAssembly.Tag;
}

// Fixture only: keep a caught exception address in a mutable exnref global.
// capture: (block (result exnref) (try_table (catch_all_ref 0) (call $throw ...)) unreachable) global.set
// captureNative uses (throw $tag ...) instead of the imported callback.
// rethrow: (throw_ref (global.get 0)); catch: (block (result externref) (try_table (catch $tag 0) ...)).
function exceptionModule(): number[] {
  const capture = (throwing: number[]): number[] => [0x02, 0x69, 0x1f, 0x40, 1, 3, 0, ...throwing, 0x0b, 0, 0x0b, 0x24, 0];
  const functions = [
    { name: 'throw', type: 0, body: [0x20, 0, 8, 0] },
    { name: 'capture', type: 0, body: capture([0x20, 0, 0x10, 0]) },
    { name: 'captureNative', type: 0, body: capture([0x20, 0, 8, 0]) },
    { name: 'rethrow', type: 1, body: [0x23, 0, 0x0a] },
    { name: 'catch', type: 2, body: [0x02, 0x6f, 0x1f, 0x40, 1, 0, 0, 0, 0x20, 0, 0x10, 0, 0x0b, 0, 0x0b] },
    { name: 'exceptionPayload', type: 1, body: [0x23, 0, 8, 1] },
    { name: 'vectorPayload', type: 1, body: [0xfd, 12, ...Array<number>(16).fill(0), 8, 2] },
    { name: 'readRef', type: 5, body: [0x23, 0] },
    { name: 'acceptRef', type: 3, body: [] },
  ];
  return [0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, vector([[0x60, 1, 0x6f, 0], [0x60, 0, 0], [0x60, 1, 0x6f, 1, 0x6f],
      [0x60, 1, 0x69, 0], [0x60, 1, 0x7b, 0], [0x60, 0, 1, 0x69]])),
    ...section(2, vector([[...name('env'), ...name('throw'), 0, 0], [...name('env'), ...name('tag'), 4, 0, 0]])),
    ...section(3, vector(functions.map((fn) => [fn.type]))),
    ...section(13, [2, 0, 3, 0, 4]), // tag 1: exnref; tag 2: v128
    ...section(6, [1, 0x69, 1, 0xd0, 0x69, 0x0b]), // (global (mut exnref) (ref.null exn))
    ...section(7, vector([...functions.map((fn, index) => [...name(fn.name), 0, index + 1]),
      [...name('exceptionTag'), 4, 1], [...name('vectorTag'), 4, 2]])),
    ...section(10, vector(functions.map((fn) => { const body = [0, ...fn.body, 0x0b]; return [...uint(body.length), ...body]; }))),
  ];
}

function section(id: number, contents: number[]): number[] { return [id, ...uint(contents.length), ...contents]; }
function vector(entries: number[][]): number[] { return [...uint(entries.length), ...entries.flat()]; }
function name(value: string): number[] { const bytes = [...Buffer.from(value)]; return [...uint(bytes.length), ...bytes]; }
function uint(value: number): number[] {
  const result: number[] = [];
  do { const byte = value & 127; value >>>= 7; result.push(byte | (value ? 128 : 0)); } while (value);
  return result;
}
