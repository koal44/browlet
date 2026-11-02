import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

import { isWebAssemblyFunction } from '../../src/js-engine/built-in-primitives';

it('recognizes native Wasm functions across realms without consulting author properties', () => {
  const foreign = runInNewContext('WebAssembly') as typeof WebAssembly;
  const module = new WebAssembly.Module(new Uint8Array(identityModule));
  const local = new WebAssembly.Instance(module).exports.run as (value: number) => number;
  const other = new foreign.Instance(module).exports.run;
  const fail = (): never => { throw new Error('Author code ran'); };
  for (const fn of [local, other]) expect(isWebAssemblyFunction(fn)).toBe(true);
  const bound = local.bind(null);
  Object.setPrototypeOf(local, new Proxy({}, { get: fail, getPrototypeOf: fail }));
  Object.freeze(local);
  expect(isWebAssemblyFunction(local)).toBe(true);
  expect(local(7)).toBe(7);

  const revoked = Proxy.revocable(local, {});
  revoked.revoke();
  for (const value of [
    null, undefined, {}, 1, 'function', () => 0, bound,
    new Proxy(local, { get: fail, getPrototypeOf: fail }), revoked.proxy,
  ]) expect(isWebAssemblyFunction(value)).toBe(false);
});

it('keeps the private zero-length table and captured grow intrinsic out of author reach', () => {
  const module = new WebAssembly.Module(new Uint8Array(identityModule));
  const fn = new WebAssembly.Instance(module).exports.run;
  const descriptor = Object.getOwnPropertyDescriptor(WebAssembly.Table.prototype, 'grow')!;
  Object.defineProperty(WebAssembly.Table.prototype, 'grow', {
    value() { throw new Error('Replaced intrinsic ran'); }, configurable: true,
  });
  try {
    expect(isWebAssemblyFunction(fn)).toBe(true);
    expect(isWebAssemblyFunction(() => 0)).toBe(false);
    expect(isWebAssemblyFunction(fn)).toBe(true);
  } finally {
    Object.defineProperty(WebAssembly.Table.prototype, 'grow', descriptor);
  }
});

// (module (func (export "run") (param i32) (result i32) local.get 0))
const identityModule = [
  0, 97, 115, 109, 1, 0, 0, 0, 1, 6, 1, 96, 1, 127, 1, 127,
  3, 2, 1, 0, 7, 7, 1, 3, 114, 117, 110, 0, 0, 10, 6, 1, 4, 0, 32, 0, 11,
];
