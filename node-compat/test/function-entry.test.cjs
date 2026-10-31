'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const compat = require('../addon/index.cjs');
const { assertCollected } = require('./support/gc.cjs');

test('native function entry captures an ordinary author call before host steps run', () => {
  const a = compat.createContextHandle();
  const b = compat.createContextHandle();
  const c = compat.createContextHandle();
  const receiver = {};
  const value = {};
  const seen = [];
  const method = compat.createFunctionWithIncumbent(c, (incumbent, self, args) => {
    seen.push(incumbent);
    assert.equal(self, receiver);
    assert.deepEqual(args, [value, 42]);
    return value;
  });
  assert.equal(compat.getFunctionRealm(method), c.realm);
  assert.equal(Object.getPrototypeOf(method), c.globalProxy.Function.prototype);
  assert.equal(Object.hasOwn(method, 'prototype'), false);
  assert.throws(() => Reflect.construct(method, []), TypeError);
  b.globalProxy.method = method;
  b.globalProxy.receiver = receiver;
  a.globalProxy.value = value;
  a.globalProxy.call = compat.runInContext('(value) => method.call(receiver, value, 42)', b);
  assert.equal(compat.runInContext('call(value)', a), value);
  assert.deepEqual(seen, [b.realm]);
  method.call(receiver, value, 42);
  assert.equal(seen[1], compat.getRealm(globalThis));
});

test('native entry preserves nested incumbents and propagates the original exception', () => {
  const a = compat.createContextHandle();
  const b = compat.createContextHandle();
  const c = compat.createContextHandle();
  const error = {};
  const seen = [];
  const method = compat.createFunctionWithIncumbent(c, (incumbent, _self, [nested]) => {
    seen.push(incumbent);
    if (nested) return nested();
    throw error;
  });
  a.globalProxy.method = b.globalProxy.method = method;
  a.globalProxy.nested = compat.runInContext('() => method()', b);
  assert.throws(() => compat.runInContext('method(nested)', a), (thrown) => thrown === error);
  assert.throws(() => compat.runInContext('method()', a), (thrown) => thrown === error);
  assert.deepEqual(seen, [a.realm, b.realm, a.realm]);
});

test('native entry functions and their captured host steps can be collected', async () => {
  function allocate() {
    const context = compat.createContextHandle();
    const steps = () => undefined;
    const method = compat.createFunctionWithIncumbent(context, steps);
    return { context: new WeakRef(context), steps: new WeakRef(steps), method: new WeakRef(method) };
  }
  await assertCollected(allocate());
});

test('native entry rejects a non-callable host implementation', () => {
  assert.throws(() => compat.createFunctionWithIncumbent(compat.createContextHandle(), {}), {
    code: 'ERR_INVALID_ARG_TYPE',
  });
});
