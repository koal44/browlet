'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const compat = require('../addon/index.cjs');

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
