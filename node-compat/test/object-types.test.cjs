'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const compat = require('../addon/index.cjs');
const { itPassesWith } = require('./support/test-runtime.cjs');

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

itPassesWith('finalizationRegistryPredicate')('FinalizationRegistry predicate preserves entries across realms and altered prototypes', () => {
  const fail = () => { throw new Error('Author code ran'); };
  const unregister = FinalizationRegistry.prototype.unregister;
  const target = {}, token = {};
  for (const value of [new FinalizationRegistry(fail), vm.runInNewContext('new FinalizationRegistry(() => {})')]) {
    assert.equal(compat.isFinalizationRegistry(value), true);
    value.register(target, 'held', token);
    for (const key of ['unregister', 'constructor', Symbol.toStringTag]) {
      Object.defineProperty(value, key, { get: fail });
    }
    Object.setPrototypeOf(value, new Proxy({}, {
      get: fail, getPrototypeOf: fail, ownKeys: fail,
    }));
    Object.freeze(value);
    assert.equal(compat.isFinalizationRegistry(value), true);
    assert.equal(unregister.call(value, token), true);
    assert.equal(unregister.call(value, token), false);
  }
  assert.equal(compat.isFinalizationRegistry(Object.setPrototypeOf(new FinalizationRegistry(fail), null)), true);
});

itPassesWith('finalizationRegistryPredicate')('FinalizationRegistry predicate rejects other values and proxies without author code', () => {
  const fail = () => { throw new Error('Author code ran'); };
  const registry = new FinalizationRegistry(fail);
  const proxy = new Proxy(registry, {
    get: fail, getPrototypeOf: fail, ownKeys: fail,
  });
  const revoked = Proxy.revocable(registry, {});
  revoked.revoke();
  for (const value of [
    undefined, null, true, 1, 1n, 'text', Symbol(), () => {}, [], {},
    new WeakRef({}), new WeakMap(), new WeakSet(),
    Object.create(FinalizationRegistry.prototype), { [Symbol.toStringTag]: 'FinalizationRegistry' },
    proxy, revoked.proxy,
  ]) {
    assert.equal(compat.isFinalizationRegistry(value), false);
  }
  assert.equal(compat.isFinalizationRegistry(), false);
});
