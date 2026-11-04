import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

// WebAssembly JavaScript API §5 JSTag, with the tag cache and exception-tag
// algorithms it references. Tag and Exception construction have separate suites.
describe('WebAssembly JavaScript exception tag', () => {
  it('returns a stable native Tag without allowing assignment', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const tag = WebAssembly.JSTag;
      return {
        native: tag instanceof WebAssembly.Tag,
        same: tag === WebAssembly.JSTag,
        assignment: Reflect.set(WebAssembly, 'JSTag', {}),
        retained: WebAssembly.JSTag === tag,
      };
    })).toEqual({ native: true, same: true, assignment: false, retained: true });
  });

  it('exposes the readonly namespace getter with its original tag', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const tag = WebAssembly.JSTag;
      const descriptor = Object.getOwnPropertyDescriptor(WebAssembly, 'JSTag')!;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Namespace getters ignore their receiver; test the detached call below.
      const getter = descriptor.get;
      Object.defineProperty(WebAssembly, 'JSTag', { value: {} });
      return {
        getter: typeof getter,
        setter: typeof descriptor.set,
        enumerable: descriptor.enumerable,
        configurable: descriptor.configurable,
        ownFunction: getter && Object.getPrototypeOf(getter) === Function.prototype,
        retained: getter && Reflect.apply(getter, null, []) === tag,
      };
    })).toEqual({
      getter: 'function', setter: 'undefined', enumerable: true, configurable: true,
      ownFunction: true, retained: true,
    });
  });

  it('catches JavaScript throws through the native externref tag', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(bytes)), {
        // TypeScript's ImportValue union still omits native Tags.
        env: { tag: WebAssembly.JSTag as unknown as WebAssembly.ImportValue, throw(value: unknown): never { throw value; } },
      });
      const catchValue = instance.exports.catch as (value: unknown) => unknown;
      const marker = {};
      const values = [undefined, null, false, NaN, -0, 42, 1n, 'text', Symbol(), marker, document];
      return values.every((value) => Object.is(catchValue(value), value));
    }, catchBytes)).toBe(true);
  });

  it('forbids constructing an Exception with the JavaScript exception tag', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      try { new WebAssembly.Exception(WebAssembly.JSTag, [{}]); }
      catch (error) { return error instanceof TypeError; }
      return false;
    })).toBe(true);
  });

  // SPEC_CLASH(wasm-js-tag-realms): Accepted V8/Chromium limitations; retain all three draft expectations below.
  it.fails('shares the cached JavaScript exception tag between same-Agent realms', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      return WebAssembly.JSTag === foreign.WebAssembly.JSTag;
    })).toBe(true);
  });

  it.fails('forbids constructing an Exception with another realm\'s JavaScript exception tag', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      try { new WebAssembly.Exception(foreign.WebAssembly.JSTag, [{}]); }
      catch (error) { return error instanceof TypeError; }
      return false;
    })).toBe(true);
  });

  it.fails('catches a JavaScript throw using another same-Agent realm\'s tag', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(bytes)), {
        env: {
          tag: foreign.WebAssembly.JSTag as unknown as WebAssembly.ImportValue,
          throw(value: unknown): never { throw value; },
        },
      });
      const marker = {};
      try { return (instance.exports.catch as (value: unknown) => unknown)(marker) === marker; }
      catch { return false; }
    }, catchBytes)).toBe(true);
  });
});

function fixture(): Browlet {
  const browser = new Browlet({ route: () => '', reporting: false });
  const foreign = createSiblingWindow(browser);
  expect(getRelevantRealm(foreign).agent).toBe(getRelevantRealm(browser.window).agent);
  Reflect.set(browser.window, 'foreign', foreign);
  return browser;
}

// (module
//   (type (func (param externref) (result externref)))
//   (type (func (param externref)))
//   (type (func (result externref)))
//   (import "env" "throw" (func (type 0)))
//   (import "env" "tag" (tag (type 1)))
//   (func (export "catch") (type 0)
//     (block (result externref)
//       (try_table (result externref) (catch 0 0) (call 0 (local.get 0))))))
const catchBytes = [
  0, 97, 115, 109, 1, 0, 0, 0,
  1, 14, 3, 96, 1, 111, 1, 111, 96, 1, 111, 0, 96, 0, 1, 111,
  2, 24, 2, 3, 101, 110, 118, 5, 116, 104, 114, 111, 119, 0, 0, 3, 101, 110, 118, 3, 116, 97, 103, 4, 0, 1,
  3, 2, 1, 0, 7, 9, 1, 5, 99, 97, 116, 99, 104, 0, 1,
  10, 18, 1, 16, 0, 2, 111, 31, 111, 1, 0, 0, 0, 32, 0, 16, 0, 11, 11, 11,
];
