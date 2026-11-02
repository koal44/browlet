import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

import { isWebAssemblyTag } from '../../src/js-engine/built-in-primitives';

it('recognizes native Tags across realms without consulting author properties', () => {
  const foreign = runInNewContext('WebAssembly') as typeof WebAssembly;
  const fail = (): never => { throw new Error('Author code ran'); };
  const tag = new WebAssembly.Tag({ parameters: [] });
  const values = [tag, WebAssembly.JSTag, foreign.JSTag, new foreign.Tag({ parameters: ['externref'] })];
  for (const value of values) expect(isWebAssemblyTag(value)).toBe(true);

  Object.defineProperty(tag, 'constructor', { get: fail });
  Object.setPrototypeOf(tag, new Proxy({}, { get: fail, getPrototypeOf: fail }));
  Object.freeze(tag);
  expect(isWebAssemblyTag(tag)).toBe(true);

  const revoked = Proxy.revocable(tag, {});
  revoked.revoke();
  for (const value of [
    null, undefined, true, 1, 1n, 'text', Symbol(), {}, [], () => {},
    Object.create(WebAssembly.Tag.prototype), { [Symbol.toStringTag]: 'WebAssembly.Tag' },
    new WebAssembly.Exception(tag, []),
    new Proxy(tag, { get: fail, getPrototypeOf: fail }), revoked.proxy,
  ]) expect(isWebAssemblyTag(value)).toBe(false);
});

it('keeps using the captured Tag check after public intrinsic replacement', () => {
  const tag = new WebAssembly.Tag({ parameters: [] });
  const descriptor = Object.getOwnPropertyDescriptor(WebAssembly.Exception.prototype, 'is')!;
  Object.defineProperty(WebAssembly.Exception.prototype, 'is', {
    value() { throw new Error('Replaced intrinsic ran'); }, configurable: true,
  });
  try {
    expect(isWebAssemblyTag(tag)).toBe(true);
    expect(isWebAssemblyTag({})).toBe(false);
  } finally {
    Object.defineProperty(WebAssembly.Exception.prototype, 'is', descriptor);
  }
});
