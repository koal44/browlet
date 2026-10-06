'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const compat = require('../addon/index.cjs');

const cases = [
  ['Array', 'isArrayIterator', '[1, 2].values()', 1],
  ['String', 'isStringIterator', "'ab'[Symbol.iterator]()", 'a'],
  ['RegExp String', 'isRegExpStringIterator', "'ab'.matchAll(/./g)", ['a']],
];

for (const [name, method, source, firstValue] of cases) {
  test(`${name} iterator predicate reads the native brand without author code`, {
    skip: !compat[method] && `This engine does not expose ${method}`,
  }, () => {
    const query = compat[method];
    const fail = () => { throw new Error('Author code ran'); };
    for (const iterator of [vm.runInThisContext(source), vm.runInNewContext(source)]) {
      const next = iterator.next;
      const impostor = Object.create(Object.getPrototypeOf(iterator));
      assert.equal(query(impostor), false);
      for (const key of ['marker', 'next', 'constructor', Symbol.iterator, Symbol.toStringTag]) {
        Object.defineProperty(iterator, key, { enumerable: true, get: fail });
      }
      Object.setPrototypeOf(iterator, new Proxy({}, {
        get: fail, getPrototypeOf: fail, ownKeys: fail,
      }));
      Object.freeze(iterator);
      assert.equal(query(iterator), true);
      for (const [, otherMethod] of cases) {
        assert.equal(compat[otherMethod](iterator), method === otherMethod);
      }
      const first = next.call(iterator);
      assert.equal(first.done, false);
      if (Array.isArray(firstValue)) assert.equal(first.value[0], firstValue[0]);
      else assert.equal(first.value, firstValue);
      while (!next.call(iterator).done) { /* Exhaust without consulting next. */ }
      assert.equal(query(iterator), true);
    }

    const iterator = vm.runInThisContext(source);
    const proxy = new Proxy(iterator, { get: fail, getPrototypeOf: fail, ownKeys: fail });
    const revoked = Proxy.revocable(iterator, {});
    revoked.revoke();
    for (const value of [
      undefined, null, true, 1, 1n, 'ab', Symbol(), () => {}, [], {},
      proxy, revoked.proxy, new Map().entries(), new Set().values(),
      (function*() { yield 1; })(), [].values().map(fail),
      { [Symbol.toStringTag]: `${name} Iterator`, next: fail },
    ]) {
      assert.equal(query(value), false);
    }
    assert.equal(query(), false);
  });
}

test('Array iterator predicate includes keys, values, and entries of arrays and typed arrays', {
  skip: !compat.isArrayIterator && 'This engine does not expose isArrayIterator',
}, () => {
  for (const collection of [[1, 2], new Uint8Array([1, 2])]) {
    for (const method of ['keys', 'values', 'entries']) {
      assert.equal(compat.isArrayIterator(collection[method]()), true);
    }
  }
});
