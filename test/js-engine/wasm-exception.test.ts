import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

import { isWebAssemblyException } from '../../src/js-engine/built-in-primitives';

it('recognizes native Exceptions across realms without consulting author properties', () => {
  const foreign = runInNewContext('WebAssembly') as typeof WebAssembly;
  const fail = (): never => { throw new Error('Author code ran'); };
  const tag = new WebAssembly.Tag({ parameters: [] });
  const exception = new WebAssembly.Exception(tag, []);
  const other = new foreign.Exception(new foreign.Tag({ parameters: ['externref'] }), [{}]);
  expect(isWebAssemblyException(exception)).toBe(true);
  expect(isWebAssemblyException(other)).toBe(true);

  Object.defineProperty(exception, 'stack', { get: fail });
  Object.defineProperty(exception, 'constructor', { get: fail });
  Object.setPrototypeOf(exception, new Proxy({}, { get: fail, getPrototypeOf: fail }));
  Object.freeze(exception);
  expect(isWebAssemblyException(exception)).toBe(true);

  const revoked = Proxy.revocable(exception, {});
  revoked.revoke();
  for (const value of [
    null, undefined, true, 1, 1n, 'text', Symbol(), {}, [], () => {}, tag, new Error(),
    Object.create(WebAssembly.Exception.prototype), { [Symbol.toStringTag]: 'WebAssembly.Exception' },
    new Proxy(exception, { get: fail, getPrototypeOf: fail }), revoked.proxy,
  ]) expect(isWebAssemblyException(value)).toBe(false);
});

it('keeps using the captured Exception check after public intrinsic replacement', () => {
  const exception = new WebAssembly.Exception(new WebAssembly.Tag({ parameters: [] }), []);
  const descriptor = Object.getOwnPropertyDescriptor(WebAssembly.Exception.prototype, 'is')!;
  Object.defineProperty(WebAssembly.Exception.prototype, 'is', {
    value() { throw new Error('Replaced intrinsic ran'); }, configurable: true,
  });
  try {
    expect(isWebAssemblyException(exception)).toBe(true);
    expect(isWebAssemblyException({})).toBe(false);
  } finally {
    Object.defineProperty(WebAssembly.Exception.prototype, 'is', descriptor);
  }
});
