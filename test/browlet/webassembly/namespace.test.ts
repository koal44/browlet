import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

// WebAssembly JavaScript API §5, through validate(); async operations are a later slice.
// SPEC_CLASH(wasm-validate-bindings): Native engines differ from the draft's input/conversion rules; see the owning roadmap.
describe('WebAssembly namespace and validation', () => {
  it('retains the engine namespace and delegates to its captured validator', async () => {
    const browser = fixture();
    const realm = getRelevantRealm(browser.window);
    const nativeModule: unknown = Reflect.get(realm.WebAssembly, 'Module');
    expect(Reflect.get(browser.window, 'WebAssembly')).toBe(realm.WebAssembly);
    expect(Reflect.get(realm.WebAssembly, 'validate')).not.toBe(realm.webAssemblyValidate);
    expect(await browser.evaluate((source) => {
      const validate = WebAssembly.validate;
      WebAssembly.validate = () => { throw new Error('replaced validator'); };
      const bytes = new Uint8Array(source);
      const valid = validate(bytes);
      const module = new WebAssembly.Module(bytes);
      return valid && new WebAssembly.Instance(module) instanceof WebAssembly.Instance;
    }, emptyModule)).toBe(true);
    expect(Reflect.get(realm.WebAssembly, 'Module')).toBe(nativeModule);
  });

  it('retains the native namespace and realm-owned, nonconstructible operations', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const descriptor = Object.getOwnPropertyDescriptor(WebAssembly, 'validate')!;
      const tag = Object.getOwnPropertyDescriptor(WebAssembly, Symbol.toStringTag)!;
      let rejectsConstruction = false;
      try { Reflect.construct(WebAssembly.validate, [new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])]); }
      catch (error) { rejectsConstruction = error instanceof TypeError; }
      return {
        distinctNamespaces: WebAssembly !== foreign.WebAssembly,
        ownPrototype: Object.getPrototypeOf(WebAssembly) === Object.prototype,
        ownFunction: Object.getPrototypeOf(WebAssembly.validate) === Function.prototype,
        foreignFunction: Object.getPrototypeOf(foreign.WebAssembly.validate) === foreign.Function.prototype,
        rejectsConstruction,
        length: WebAssembly.validate.length,
        operation: [descriptor.writable, descriptor.enumerable, descriptor.configurable],
        tag: [tag.value, tag.writable, tag.enumerable, tag.configurable],
      };
    })).toEqual({
      distinctNamespaces: true, ownPrototype: true, ownFunction: true, foreignFunction: true,
      rejectsConstruction: true, length: 1, operation: [true, true, true],
      tag: ['WebAssembly', false, false, true],
    });
  });

  it('validates buffer ranges, shared views, and resizable buffers without changing them', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const bytes = new Uint8Array(source);
      const padded = new Uint8Array(bytes.length + 4);
      padded.fill(0xff);
      padded.set(bytes, 2);
      const resizable = new ArrayBuffer(bytes.length, { maxByteLength: 32 });
      new Uint8Array(resizable).set(bytes);
      // The Window's SharedArrayBuffer constructor is hidden, but Wasm exposes shared views.
      const shared = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
      const sharedView = new Uint8Array(shared.buffer, 0, bytes.length);
      sharedView.set(bytes);
      return {
        valid: [bytes, bytes.buffer, padded.subarray(2, -2), resizable, sharedView]
          .map((value) => WebAssembly.validate(value)),
        invalid: [padded, new Uint8Array()].map((value) => WebAssembly.validate(value)),
        unchanged: Array.from(bytes),
      };
    }, emptyModule)).toEqual({ valid: [true, true, true, true, true], invalid: [false, false], unchanged: emptyModule });
  });

  it('accepts a DataView and reads only its selected bytes', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const bytes = new Uint8Array(source.length + 4);
      bytes.fill(0xff);
      bytes.set(source, 2);
      return WebAssembly.validate(new DataView(bytes.buffer, 2, source.length));
    }, emptyModule)).toBe(true);
  });

  it('accepts a raw shared buffer and reports invalid bytes without throwing', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
      // Zero-filled memory is not a Wasm module, but its buffer is a permitted input.
      return WebAssembly.validate(memory.buffer);
    })).toBe(false);
  });

  it('rejects non-buffer inputs with the invoked operation realm\'s TypeError', async () => {
    const browser = fixture();
    expect(await browser.evaluate(() => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const inputs = [undefined, null, {}, [], '', new Proxy(new Uint8Array(), {})];
      return inputs.every((value) => {
        try { Reflect.apply(foreign.WebAssembly.validate, null, [value]); }
        catch (error) { return error instanceof foreign.TypeError; }
        return false;
      });
    })).toBe(true);
  });

  it.each(['builtins', 'importedStringConstants'])('checks the import types selected by %s', async (kind) => {
    const browser = fixture();
    const source = kind === 'builtins' ? wrongBuiltinType : wrongStringType;
    const options = kind === 'builtins' ? { builtins: ['js-string'] } : { importedStringConstants: 'strings' };
    expect(await browser.evaluate(({ source, options }) => {
      const bytes = new Uint8Array(source);
      return [WebAssembly.validate(bytes), Reflect.apply(WebAssembly.validate, null, [bytes, options])];
    }, { source, options })).toEqual([true, false]);
  });

  it('converts the optional compile-options dictionary before validation', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const bytes = new Uint8Array(source);
      const validate = (options: unknown) => Reflect.apply(WebAssembly.validate, null, [bytes, options]) as boolean;
      return {
        defaults: [validate(undefined), validate(null)],
        rejectsPrimitives: [false, 1, 1n, '', Symbol()].every((options) => {
          try { validate(options); }
          catch (error) { return error instanceof TypeError; }
          return false;
        }),
      };
    }, emptyModule)).toEqual({ defaults: [true, true], rejectsPrimitives: true });
  });

  it('iterates and converts builtin names before reading imported string constants', async () => {
    const browser = fixture();
    expect(await browser.evaluate((source) => {
      const seen: string[] = [];
      const options = {
        get builtins() {
          seen.push('builtins');
          return {
            *[Symbol.iterator]() {
              seen.push('iterator');
              yield { toString() { seen.push('builtin string'); return 'unknown'; } };
            },
          };
        },
        get importedStringConstants() {
          seen.push('importedStringConstants');
          return { toString() { seen.push('module string'); return 'strings'; } };
        },
      };
      const valid = Reflect.apply(WebAssembly.validate, null, [new Uint8Array(source), options]) as boolean;
      return { valid, seen };
    }, emptyModule)).toEqual({
      valid: true, seen: ['builtins', 'iterator', 'builtin string', 'importedStringConstants', 'module string'],
    });
  });

  it.each(['getter', 'iterator', 'string'])('propagates an exception from the options %s', async (kind) => {
    const browser = fixture();
    expect(await browser.evaluate(({ source, kind }) => {
      const marker = new Error('options conversion');
      const fail = () => { throw marker; };
      const options = kind === 'getter' ? { get builtins() { return fail(); } }
        : kind === 'iterator' ? { builtins: { [Symbol.iterator]: fail } }
          : { builtins: [{ toString: fail }] };
      try { Reflect.apply(WebAssembly.validate, null, [new Uint8Array(source), options]); }
      catch (error) { return error === marker; }
      return false;
    }, { source: emptyModule, kind })).toBe(true);
  });

  it.each(['js-string', 'unknown'])('rejects duplicate builtin names, including %s', async (name) => {
    const browser = fixture();
    expect(await browser.evaluate(({ source, name }) =>
      Reflect.apply(WebAssembly.validate, null, [new Uint8Array(source), { builtins: [name, name] }]),
    { source: emptyModule, name })).toBe(false);
  });

  it.each(['mutate', 'detach'])('copies the bytes after options conversion can %s them', async (action) => {
    const browser = fixture();
    expect(await browser.evaluate(({ source, action }) => {
      const bytes = new Uint8Array(source);
      return Reflect.apply(WebAssembly.validate, null, [bytes, {
        get builtins() {
          if (action === 'detach') bytes.buffer.transfer();
          else bytes.fill(0);
          return [];
        },
      }]);
    }, { source: emptyModule, action })).toBe(false);
  });
});

function fixture(): Browlet {
  const browser = new Browlet({ route: () => '', reporting: false });
  Reflect.set(browser.window, 'foreign', createSiblingWindow(browser));
  return browser;
}

// (module)
const emptyModule = [0, 97, 115, 109, 1, 0, 0, 0];

// (module (import "wasm:js-string" "cast" (func)))
const wrongBuiltinType = [
  0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 2, 23, 1, 14,
  119, 97, 115, 109, 58, 106, 115, 45, 115, 116, 114, 105, 110, 103, 4, 99, 97, 115, 116, 0, 0,
];

// (module (import "strings" "value" (func)))
const wrongStringType = [
  0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 2, 17, 1, 7,
  115, 116, 114, 105, 110, 103, 115, 5, 118, 97, 108, 117, 101, 0, 0,
];
