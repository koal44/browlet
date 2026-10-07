'use strict';

const assert = require('node:assert/strict');
const { join } = require('node:path');
const { test } = require('node:test');
const { addonBuild } = require('../node-base.cjs');
const compat = require('../addon/index.cjs');
const { assertCollected } = require('./support/gc.cjs');

test('function realm follows bound and proxy targets without author property access', () => {
  const first = compat.createContextHandle();
  const second = compat.createContextHandle();
  const target = compat.runInContext('(function Target() {})', second);
  first.globalProxy.foreignTarget = target;
  Object.setPrototypeOf(target, compat.runInContext('Function.prototype', first));
  const returned = compat.runInContext('foreignTarget', first);
  const bound = compat.runInContext('Function.prototype.bind.call(foreignTarget, null)', first);
  const traps = {
    get() { throw new Error('unexpected get'); },
    getPrototypeOf() { throw new Error('unexpected getPrototypeOf'); },
    getOwnPropertyDescriptor() { throw new Error('unexpected getOwnPropertyDescriptor'); },
  };
  const proxy = new Proxy(target, traps);
  const boundProxy = Function.prototype.bind.call(new Proxy(target, {}), null);

  for (const value of [target, returned, bound, proxy, new Proxy(bound, traps), boundProxy]) {
    assert.equal(compat.getFunctionRealm(value), second.realm);
  }
  const revoked = Proxy.revocable(target, {});
  revoked.revoke();
  assert.throws(() => compat.getFunctionRealm(revoked.proxy), { code: 'ERR_REVOKED_PROXY' });
  assert.throws(() => compat.getFunctionRealm(new Proxy(revoked.proxy, traps)), {
    code: 'ERR_REVOKED_PROXY',
  });
  assert.throws(() => compat.getFunctionRealm({}), { code: 'ERR_INVALID_ARG_TYPE' });
});

test('reloading the addon preserves existing realm references', () => {
  const path = join(addonBuild(process.env.NODE_BASE ?? '24.19.0'), 'node-compat.node');
  const first = require(path);
  const handle = compat.createContextHandle();
  const callback = compat.runInContext('() => 1', handle);
  const realm = first.getFunctionRealm(callback);
  delete require.cache[require.resolve(path)];
  const second = require(path);
  assert.notEqual(second, first);
  assert.equal(second.getFunctionRealm(callback), realm);
  assert.equal(first.getFunctionRealm(callback), realm);
  assert.equal(second.getRealm(callback), realm);
});

test('realm lookup keys do not retain discarded callbacks or their contexts', async () => {
  function allocate() {
    const handle = compat.createContextHandle();
    const callback = compat.runInContext('() => 1', handle);
    const realm = compat.getFunctionRealm(callback);
    assert.equal(realm, handle.realm);
    return {
      handle: new WeakRef(handle),
      callback: new WeakRef(callback),
      realm: new WeakRef(realm),
    };
  }
  await assertCollected(allocate());
});
