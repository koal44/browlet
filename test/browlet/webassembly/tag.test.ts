import { describe, expect, it } from 'vitest';

import { WasmTagImpl } from '../../../src/browlet/webassembly/index';
import { Browlet } from '../../../src/browlet/browlet';
import { reference } from '../../../src/web-idl/core/index';
import { getPlatformRecord, PlatformRecordSource } from '../../../src/web-idl/values/platform';
import { getBindingContext, getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

// WebAssembly JavaScript API §5.7: Binding converts TagType; V8 owns tags and their cache.
describe('WebAssembly Tag', () => {
  it('converts the required parameter sequence before reading newTarget.prototype', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const trace: string[] = [];
      const type = {
        get parameters() {
          trace.push('parameters');
          return [{ toString() { trace.push('value type'); return 'i32'; } }];
        },
      };
      const target = new Proxy(function Target() {}, {
        get(target, key, receiver) {
          if (key === 'prototype') trace.push('prototype');
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
      Reflect.construct(WebAssembly.Tag, [type], target);
      return trace;
    })).toEqual(['parameters', 'value type', 'prototype']);
  });

  it('consumes iterable parameters without consulting array-like length or indices', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const parameters = {
        get length(): never { throw new Error('length must not be read'); },
        get 0(): never { throw new Error('indices must not be read'); },
        *[Symbol.iterator]() { yield 'i32'; yield 'externref'; },
      };
      const tag = Reflect.construct(WebAssembly.Tag, [{ parameters }]) as WebAssembly.Tag;
      const value = {};
      const exception = new WebAssembly.Exception(tag, [7, value]);
      return [exception.getArg(tag, 0) as unknown, exception.getArg(tag, 1) === value];
    })).toEqual([7, true]);
  });

  it('rejects missing, non-iterable and invalid parameter types before prototype lookup', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const cases = [undefined, null, {}, { parameters: undefined }, { parameters: null },
        { parameters: { 0: 'i32', length: 1 } }, { parameters: ['bad'] }, { parameters: ['anyref'] }];
      return cases.map((type) => {
        let reads = 0;
        const target = new Proxy(function Target() {}, {
          get(target, key, receiver) {
            if (key === 'prototype') reads++;
            return Reflect.get(target, key, receiver) as unknown;
          },
        });
        try { Reflect.construct(WebAssembly.Tag, [type], target); }
        catch (error) { return [error instanceof TypeError, reads]; }
        return [false, reads];
      });
    })).toEqual(Array.from({ length: 8 }, () => [true, 0]));
  });

  it('stops parameter conversion and preserves an author exception', async () => {
    // Web IDL sequence conversion propagates the element failure without IteratorClose.
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const marker = new Error('parameter');
      let closed = false;
      let same = false;
      const parameters = {
        *[Symbol.iterator]() {
          try { yield { toString() { throw marker; } }; }
          finally { closed = true; }
        },
      };
      try { Reflect.construct(WebAssembly.Tag, [{ parameters }]); }
      catch (error) { same = error === marker; }
      return { closed, same };
    })).toEqual({ closed: false, same: true });
  });

  it('accepts every specified value type, including vector signatures', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => ['i32', 'i64', 'f32', 'f64', 'v128', 'externref', 'anyfunc'].every((type) => {
      const tag = Reflect.construct(WebAssembly.Tag, [{ parameters: [type] }]) as WebAssembly.Tag;
      return tag instanceof WebAssembly.Tag;
    }))).toBe(true);
  });

  it('allocates distinct tags for identical signatures and retains a snapshot of the parameters', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const parameters: WebAssembly.ValueType[] = ['i32'];
      const first = new WebAssembly.Tag({ parameters });
      const second = new WebAssembly.Tag({ parameters });
      parameters[0] = 'i64';
      const exception = new WebAssembly.Exception(first, [9]);
      return { distinct: first !== second, first: exception.is(first), second: exception.is(second), value: exception.getArg(first, 0) as unknown };
    })).toEqual({ distinct: true, first: true, second: false, value: 9 });
  });

  it('requires new and retains the native prototype and constructor metadata', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const Constructor = WebAssembly.Tag;
      let rejected = false;
      try { Reflect.apply(Constructor, undefined, [{ parameters: [] }]); }
      catch (error) { rejected = error instanceof TypeError; }
      const tag = new Constructor({ parameters: [] });
      return {
        rejected, name: Constructor.name, length: Constructor.length,
        constructor: Constructor.prototype.constructor === Constructor,
        prototype: Object.getPrototypeOf(tag) === Constructor.prototype,
        description: Object.prototype.toString.call(tag), keys: Reflect.ownKeys(tag),
      };
    })).toEqual({ rejected: true, name: 'Tag', length: 1, constructor: true, prototype: true, description: '[object WebAssembly.Tag]', keys: [] });
  });

  it('preserves native identity and constructor ownership through subclassing', async () => {
    const browser = fixture();
    await browser.evaluate(() => {
      class Derived extends WebAssembly.Tag {}
      const tag = new Derived({ parameters: [] });
      if (!(tag instanceof Derived) || !(tag instanceof WebAssembly.Tag)) throw new Error('Subclass prototype lost');
      Reflect.set(globalThis, 'nativeTag', tag);
    });
    const tag = Reflect.get(browser.window, 'nativeTag') as WebAssembly.Tag;
    const record = getPlatformRecord(tag, PlatformRecordSource.Platform)!;
    expect(record).toBeDefined();
    expect(record.realm).toBe(getRelevantRealm(browser.window));
    expect(record.implInst).toBeInstanceOf(WasmTagImpl);
    expect(record.implInst).not.toBe(tag);
    expect(record.platformObject).toBe(tag);
    expect(new WebAssembly.Exception((record.implInst as unknown as WasmTagImpl).getBacking() as unknown as WebAssembly.Tag, []).is(
      (record.implInst as unknown as WasmTagImpl).getBacking() as unknown as WebAssembly.Tag)).toBe(true);
  });

  it('retains constructor ownership when newTarget selects a foreign prototype', async () => {
    const browser = fixture();
    await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      Reflect.set(globalThis, 'nativeTag', Reflect.construct(WebAssembly.Tag, [{ parameters: [] }], foreign.WebAssembly.Tag));
    });
    const tag = Reflect.get(browser.window, 'nativeTag') as WebAssembly.Tag;
    const foreign = Reflect.get(browser.window, 'foreign') as typeof globalThis;
    expect(Object.getPrototypeOf(tag)).toBe(foreign.WebAssembly.Tag.prototype);
    expect(getPlatformRecord(tag, PlatformRecordSource.Platform)!.realm).toBe(getRelevantRealm(browser.window));
  });

  it('uses captured constructors after the author replaces the namespace property', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const Constructor = WebAssembly.Tag;
      Reflect.set(WebAssembly, 'Tag', function Replacement() { throw new Error('replacement invoked'); });
      const tag = new Constructor({ parameters: [] });
      return new WebAssembly.Exception(tag, []).is(tag);
    })).toBe(true);
  });

  it('allocates conversion errors in the constructor realm and preserves author-thrown values', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      let ownError = false, foreignError = false, same = false;
      try { Reflect.construct(foreign.WebAssembly.Tag, [{ parameters: ['invalid'] }]); }
      catch (error) { ownError = error instanceof TypeError; foreignError = error instanceof foreign.TypeError; }
      const marker = new Error('descriptor');
      try { new foreign.WebAssembly.Tag({ get parameters(): never { throw marker; } }); }
      catch (error) { same = error === marker; }
      return { ownError, foreignError, same };
    })).toEqual({ ownError: false, foreignError: true, same: true });
  });

  it('keeps import/re-export identity across instances and realms', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const tag = new WebAssembly.Tag({ parameters: ['i32'] });
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      // TypeScript's host WebAssembly.ImportValue omits exception tags.
      const first = Reflect.construct(WebAssembly.Instance, [module, { env: { tag } }]) as WebAssembly.Instance;
      const second = Reflect.construct(foreign.WebAssembly.Instance, [module, { env: { tag } }]) as WebAssembly.Instance;
      return { first: first.exports.tag === tag, second: second.exports.tag === tag, repeated: first.exports.tag === first.exports.tag };
    }, importedTag)).toEqual({ first: true, second: true, repeated: true });
  });

  it('rejects forged, proxied and signature-mismatched tag imports in the instantiating realm', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const tag = new WebAssembly.Tag({ parameters: ['i32'] });
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      return [Object.create(WebAssembly.Tag.prototype) as object, new Proxy(tag, {}), new WebAssembly.Tag({ parameters: ['i64'] })]
        .every((tag) => {
          try { Reflect.construct(foreign.WebAssembly.Instance, [module, { env: { tag } }]); }
          catch (error) { return error instanceof foreign.WebAssembly.LinkError; }
          return false;
        });
    }, importedTag)).toBe(true);
  });

  it('recognizes engine-created foreign tags without reassigning their ownership', async () => {
    const browser = fixture();
    await browser.evaluate((bytes) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const module = new foreign.WebAssembly.Module(new Uint8Array(bytes));
      const tag = new foreign.WebAssembly.Instance(module).exports.tag;
      Object.setPrototypeOf(tag, null);
      Reflect.set(globalThis, 'nativeTag', Object.freeze(tag));
    }, exportedTag);
    const tag = Reflect.get(browser.window, 'nativeTag') as object;
    const context = getBindingContext(getRelevantRealm(browser.window));
    expect(context.jsToImpl(tag, reference('Tag'))).toBe(getPlatformRecord(tag, PlatformRecordSource.Platform)!.implInst);
    const record = getPlatformRecord(tag, PlatformRecordSource.Platform);
    expect(record!.realm).toBe(getRelevantRealm(Reflect.get(browser.window, 'foreign') as object));
    expect(record!.platformObject).toBe(tag);
    expect(Reflect.ownKeys(tag)).toEqual([]);
  });
});

function fixture(): Browlet {
  const browser = new Browlet({ route: () => '', reporting: false });
  Reflect.set(browser.window, 'foreign', createSiblingWindow(browser));
  return browser;
}

const header = [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0];
const signature = [1, 5, 1, 0x60, 1, 0x7f, 0]; // (type (func (param i32)))
const tagExport = [7, 7, 1, 3, 0x74, 0x61, 0x67, 4, 0]; // (export "tag" (tag 0))
// (module (tag (export "tag") (param i32)))
const exportedTag = [...header, ...signature, 13, 3, 1, 0, 0, ...tagExport];
// (module (import "env" "tag" (tag (param i32))) (export "tag" (tag 0)))
const importedTag = [...header, ...signature, 2, 12, 1, 3, 0x65, 0x6e, 0x76, 3, 0x74, 0x61, 0x67, 4, 0, 0, ...tagExport];
