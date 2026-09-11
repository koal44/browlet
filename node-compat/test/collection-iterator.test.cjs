'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { inspect } = require('node:util');
const compat = require('../addon/index.cjs');
const options = {
  skip: typeof compat.createCollectionIterator !== 'function' &&
    'This engine does not expose CollectionIterator::New',
};

for (const kind of ['map', 'set']) {
  test(`${kind} callback iterator uses the supplied context and native next`, options, () => {
    const first = compat.createContextHandle();
    const second = compat.createContextHandle();
    const expression = kind === 'map'
      ? 'Object.getPrototypeOf(new Map().entries())'
      : 'Object.getPrototypeOf(new Set().values())';
    const prototype = compat.runInContext(expression, first);
    const foreignNext = compat.runInContext(expression, second).next;
    const result = compat.runInContext('({ value: [1, 2], done: false })', first);
    let calls = 0;
    const iterator = compat.createCollectionIterator(first, kind, function() {
      assert.equal(this, undefined);
      assert.equal(arguments.length, 0);
      return ++calls === 1 ? result : { done: true };
    });

    assert.equal(calls, 0);
    assert.equal(Object.getPrototypeOf(iterator), prototype);
    assert.equal(Object.hasOwn(iterator, 'next'), false);
    assert.equal(iterator.next, prototype.next);
    assert.equal(Reflect.apply(foreignNext, iterator, []), result);
    const done = iterator.next();
    assert.equal(done.done, true);
    assert.equal(done.value, undefined);
    assert.equal(Object.getPrototypeOf(done), first.globalProxy.Object.prototype);
    assert.equal(iterator.next().done, true);
    assert.equal(calls, 2);
    assert.doesNotThrow(() => inspect(iterator));
  });
}

test('callback iterator creation rejects invalid inputs and detached contexts', options, () => {
  const realm = compat.createContextHandle();
  const next = () => ({ done: true });
  assert.throws(() => compat.createCollectionIterator({}, 'map', next), {
    code: 'ERR_INVALID_ARG_TYPE',
  });
  assert.throws(() => compat.createCollectionIterator(realm, 'array', next), {
    code: 'ERR_INVALID_ARG_VALUE',
  });
  assert.throws(() => compat.createCollectionIterator(realm, 'map', {}), {
    code: 'ERR_INVALID_ARG_TYPE',
  });
  realm.detachGlobal();
  assert.throws(() => compat.createCollectionIterator(realm, 'map', next), {
    code: 'ERR_CONTEXT_NOT_INITIALIZED',
  });
});
