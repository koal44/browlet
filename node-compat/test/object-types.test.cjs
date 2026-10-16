'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const compat = require('../addon/index.cjs');

test('WeakRef predicate recognizes native objects across realms without author code', () => {
  const fail = () => { throw new Error('Author code ran'); };
  for (const value of [new WeakRef({}), vm.runInNewContext('new WeakRef({})')]) {
    assert.equal(compat.isWeakRef(value), true);
    for (const key of ['deref', 'constructor', Symbol.toStringTag]) {
      Object.defineProperty(value, key, { get: fail });
    }
    Object.setPrototypeOf(value, new Proxy({}, {
      get: fail, getPrototypeOf: fail, ownKeys: fail,
    }));
    Object.freeze(value);
    assert.equal(compat.isWeakRef(value), true);
  }
  assert.equal(compat.isWeakRef(Object.setPrototypeOf(new WeakRef({}), null)), true);
});

test('WeakRef predicate rejects other values, prototype impostors, and proxies', () => {
  const fail = () => { throw new Error('Author code ran'); };
  const reference = new WeakRef({});
  const proxy = new Proxy(reference, {
    get: fail, getPrototypeOf: fail, ownKeys: fail,
  });
  const revoked = Proxy.revocable(reference, {});
  revoked.revoke();
  for (const value of [
    undefined, null, true, 1, 1n, 'text', Symbol(), () => {}, [], {},
    new WeakMap(), new WeakSet(), new FinalizationRegistry(() => {}),
    Object.create(WeakRef.prototype), { [Symbol.toStringTag]: 'WeakRef' },
    proxy, revoked.proxy,
  ]) {
    assert.equal(compat.isWeakRef(value), false);
  }
  assert.equal(compat.isWeakRef(), false);
});
