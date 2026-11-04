import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { createSiblingWindow } from '../../support/windows';

/* eslint-disable @typescript-eslint/unbound-method -- Tests deliberately borrow native methods/accessors and supply receivers through Reflect.apply. */

// WebAssembly JavaScript API §5.9: the native prototype still supplies these members.
describe('WebAssembly Exception methods', () => {
  it('matches tag identity, including foreign tags, rather than matching signatures', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const tag = new foreign.WebAssembly.Tag({ parameters: ['externref'] });
      const other = new WebAssembly.Tag({ parameters: ['externref'] });
      const marker = {};
      const exception = new WebAssembly.Exception(tag, [marker]);
      return [exception.is(tag), exception.is(other), exception.is(WebAssembly.JSTag),
        foreign.WebAssembly.Exception.prototype.is.call(exception, tag),
        foreign.WebAssembly.Exception.prototype.getArg.call(exception, tag, 0) === marker];
    })).toEqual([true, false, false, true, true]);
  });

  it('reads the payload snapshot without repeating coercion or consulting author properties', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const tag = new WebAssembly.Tag({ parameters: ['i32', 'i64', 'f32', 'f64', 'externref'] });
      let conversions = 0;
      const payload: unknown[] = [{ valueOf() { conversions++; return 7; } }, 9n, 1.337, -0, document];
      const exception = new WebAssembly.Exception(tag, payload);
      payload.fill(null);
      const fail = (): never => { throw new Error('Author property read'); };
      Object.defineProperty(exception, 'constructor', { get: fail });
      Object.defineProperty(tag, 'constructor', { get: fail });
      Object.setPrototypeOf(exception, new Proxy({}, { get: fail }));
      Object.setPrototypeOf(tag, null);
      const read = (index: number): unknown => WebAssembly.Exception.prototype.getArg.call(exception, tag, index);
      return [read(0), read(0), read(1), read(2), Object.is(read(3), -0), read(4) === document, conversions];
    })).toEqual([7, 7, 9n, Math.fround(1.337), true, true, 1]);
  });

  it('converts ordinary indices using EnforceRange unsigned long', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const tag = new WebAssembly.Tag({ parameters: ['i32', 'i32'] });
      const exception = new WebAssembly.Exception(tag, [7, 9]);
      return [-0, 0.9, '1', true, null, { valueOf: () => 1.9 }].map((index) =>
        Reflect.apply(exception.getArg, exception, [tag, index]) as unknown);
    })).toEqual([7, 7, 9, 9, 7, 9]);
  });

  // SPEC_CLASH(wasm-exception-index-range): Web IDL truncates before its range check;
  // V8/Chromium checks the fraction first. Ordinary Binding follows Web IDL.
  it('truncates a negative fractional index before range checking', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const tag = new WebAssembly.Tag({ parameters: ['i32'] });
      return new WebAssembly.Exception(tag, [7]).getArg(tag, -0.9) === 7;
    })).toBe(true);
  });

  it('checks payload bounds after truncating a fraction above UINT32_MAX', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const tag = new WebAssembly.Tag({ parameters: ['i32'] });
      try { new WebAssembly.Exception(tag, [7]).getArg(tag, 0xffffffff + 0.5); }
      catch (error) { return error instanceof RangeError; }
      return false;
    })).toBe(true);
  });

  it('distinguishes invalid index conversion, mismatching tags, and payload bounds', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const tag = new WebAssembly.Tag({ parameters: ['i32'] });
      const other = new WebAssembly.Tag({ parameters: ['i32'] });
      const exception = new WebAssembly.Exception(tag, [7]);
      const typeErrors = [undefined, NaN, Infinity, -Infinity, -1, 2 ** 32, 1n, Symbol()].every((index) => {
        try { Reflect.apply(exception.getArg, exception, [tag, index]); }
        catch (error) { return error instanceof TypeError; }
        return false;
      });
      const bounds = [1, 1.9, 0xffffffff].every((index) => {
        try { exception.getArg(tag, index); }
        catch (error) { return error instanceof RangeError; }
        return false;
      });
      let mismatch = false;
      try { exception.getArg(other, 1); }
      catch (error) { mismatch = error instanceof TypeError; }
      return { typeErrors, bounds, mismatch };
    })).toEqual({ typeErrors: true, bounds: true, mismatch: true });
  });

  it('checks the receiver and tag before coercion, then converts the index before tag matching', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const tag = new WebAssembly.Tag({ parameters: ['i32'] });
      const exception = new WebAssembly.Exception(tag, [7]);
      const other = new WebAssembly.Tag({ parameters: ['i32'] });
      const marker = new Error('index');
      let calls = 0;
      const index = { valueOf(): never { calls++; throw marker; } };
      const invalid = [[{}, tag], [exception, {}], [exception, new Proxy(tag, {})]];
      const rejected = invalid.every(([receiver, tag]) => {
        try { Reflect.apply(WebAssembly.Exception.prototype.getArg, receiver, [tag, index]); }
        catch (error) { return error instanceof TypeError; }
        return false;
      });
      const earlyCalls = calls;
      let same = false;
      try { Reflect.apply(exception.getArg, exception, [other, index]); }
      catch (error) { same = error === marker; }
      return { rejected, earlyCalls, calls, same };
    })).toEqual({ rejected: true, earlyCalls: 0, calls: 1, same: true });
  });

  it('rejects forged, proxied, and revoked receivers without observing author properties', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const tag = new WebAssembly.Tag({ parameters: [] });
      const exception = new WebAssembly.Exception(tag, []);
      const fail = (): never => { throw new Error('Author property read'); };
      const revoked = Proxy.revocable(exception, {});
      revoked.revoke();
      const prototype = WebAssembly.Exception.prototype;
      const getter = Object.getOwnPropertyDescriptor(prototype, 'stack')!.get!;
      return [null, undefined, 1, {}, Object.create(prototype) as object,
        new Proxy(exception, { get: fail, getPrototypeOf: fail }), revoked.proxy].every((receiver) =>
        [() => { Reflect.apply(prototype.is, receiver, [tag]); },
          () => { Reflect.apply(prototype.getArg, receiver, [tag, 0]); },
          () => { Reflect.apply(getter, receiver, []); }].every((call) => {
          try { call(); }
          catch (error) { return error instanceof TypeError; }
          return false;
        }));
    })).toBe(true);
  });

  it('reports missing arguments and invalid tags in the invoked method realm', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const tag = new WebAssembly.Tag({ parameters: [] });
      const exception = new WebAssembly.Exception(tag, []);
      const prototype = foreign.WebAssembly.Exception.prototype;
      const calls = [() => { Reflect.apply(prototype.is, exception, []); },
        () => { Reflect.apply(prototype.is, exception, [{}]); },
        () => { Reflect.apply(prototype.getArg, exception, []); },
        () => { Reflect.apply(prototype.getArg, exception, [tag]); }];
      return calls.every((call) => {
        try { call(); }
        catch (error) { return error instanceof foreign.TypeError && !(error instanceof TypeError); }
        return false;
      });
    })).toBe(true);
  });

  it('exposes realm-owned nonconstructible methods and a readonly stack accessor', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const prototype = WebAssembly.Exception.prototype;
      const methods = [['getArg', 2], ['is', 1]] as const;
      const valid = methods.every(([name, length]) => {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name)!;
        const method = Reflect.get(prototype, name) as (...args: unknown[]) => unknown;
        let nonconstructible = false;
        try { Reflect.construct(method, []); }
        catch (error) { nonconstructible = error instanceof TypeError; }
        return method.name === name && method.length === length && Object.getPrototypeOf(method) === Function.prototype &&
          descriptor.enumerable && descriptor.writable && descriptor.configurable && nonconstructible;
      });
      const stack = Object.getOwnPropertyDescriptor(prototype, 'stack')!;
      return { valid, getter: typeof stack.get, setter: stack.set, enumerable: stack.enumerable, configurable: stack.configurable };
    })).toEqual({ valid: true, getter: 'function', setter: undefined, enumerable: true, configurable: true });
  });

  it('returns no stack when capture was not requested', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const exception = new WebAssembly.Exception(new WebAssembly.Tag({ parameters: [] }), []);
      return [exception.stack, Reflect.set(exception, 'stack', 'replacement'), Object.hasOwn(exception, 'stack')];
    })).toEqual([undefined, false, false]);
  });

  // SPEC_CLASH(wasm-exception-stack): The draft stores [[Stack]] for the prototype
  // getter. V8/Chromium puts traced stacks on the instance and its getter returns
  // undefined. Preserve this accepted behavior instead of intercepting stack capture.
  it('keeps the traced stack on the instance, matching Chromium', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const exception = new WebAssembly.Exception(new WebAssembly.Tag({ parameters: [] }), [], { traceStack: true });
      const getter = Object.getOwnPropertyDescriptor(WebAssembly.Exception.prototype, 'stack')!.get!;
      return {
        own: Object.hasOwn(exception, 'stack'), type: typeof exception.stack,
        getter: Reflect.apply(getter, exception, []) as unknown,
      };
    })).toEqual({ own: true, type: 'string', getter: undefined });
  });
});

function fixture(): Browlet {
  const browser = new Browlet({ route: () => '', reporting: false });
  Reflect.set(browser.window, 'foreign', createSiblingWindow(browser));
  return browser;
}
