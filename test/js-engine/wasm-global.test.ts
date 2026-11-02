import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

import { isWebAssemblyGlobal } from '../../src/js-engine/built-in-primitives';

it('recognizes Globals across realms and rejects impostors without reading author properties', () => {
  const foreign = runInNewContext('WebAssembly') as typeof WebAssembly;
  const fail = (): never => { throw new Error('Author code ran'); };
  for (const wasm of [WebAssembly, foreign]) {
    for (const value of ['i32', 'i64', 'f32', 'f64', 'externref', 'anyfunc', 'anyref', 'eqref', 'structref', 'arrayref', 'i31ref']) {
      for (const mutable of [false, true]) {
        const global = Reflect.construct(wasm.Global, [{ value, mutable }]) as object;
        for (const key of ['value', 'valueOf', 'constructor', Symbol.toStringTag, Symbol.toPrimitive]) {
          Object.defineProperty(global, key, { get: fail });
        }
        Object.setPrototypeOf(global, new Proxy({}, { get: fail, getPrototypeOf: fail }));
        Object.freeze(global);
        expect(isWebAssemblyGlobal(global)).toBe(true);
      }
    }
  }
  const global = new WebAssembly.Global({ value: 'i32' });
  Object.setPrototypeOf(global, null);
  expect(isWebAssemblyGlobal(global)).toBe(true);
  const revoked = Proxy.revocable(global, {});
  revoked.revoke();
  for (const value of [
    undefined, null, true, 1, 1n, '', Symbol(), {}, [], () => {}, new Map(),
    Object.create(WebAssembly.Global.prototype), { [Symbol.toStringTag]: 'WebAssembly.Global' },
    new Proxy(global, { get: fail, getPrototypeOf: fail, ownKeys: fail }), revoked.proxy,
    new WebAssembly.Memory({ initial: 0 }), new WebAssembly.Table({ element: 'externref', initial: 0 }),
  ]) expect(isWebAssemblyGlobal(value)).toBe(false);
});

it('keeps using captured constructors, exports, and errors after public replacement', () => {
  const matching = new WebAssembly.Global({ value: 'externref' }, {});
  const mismatched = new WebAssembly.Global({ value: 'i32', mutable: true }, 7);
  const namespace = Object.getOwnPropertyDescriptors(WebAssembly);
  const instancePrototype = WebAssembly.Instance.prototype;
  const exports = Object.getOwnPropertyDescriptor(instancePrototype, 'exports')!;
  const fail = (): never => { throw new Error('Replaced intrinsic ran'); };
  for (const key of ['Module', 'Instance', 'LinkError']) Object.defineProperty(WebAssembly, key, { get: fail });
  Object.defineProperty(instancePrototype, 'exports', { get: fail });
  try {
    expect(isWebAssemblyGlobal(matching)).toBe(true);
    expect(isWebAssemblyGlobal(mismatched)).toBe(true);
    expect(isWebAssemblyGlobal({})).toBe(false);
    expect(mismatched.value).toBe(7);
  } finally {
    Object.defineProperties(WebAssembly, namespace);
    Object.defineProperty(instancePrototype, 'exports', exports);
  }
});
