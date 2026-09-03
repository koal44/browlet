import assert from 'node:assert/strict';
import vm from 'node:vm';

const createMicrotaskQueue = Reflect.get(vm, 'createMicrotaskQueue');
assert.equal(
  typeof createMicrotaskQueue,
  'function',
  'compatible Node must expose vm.createMicrotaskQueue()',
);

const createContextHandle = Reflect.get(vm, 'createContextHandle');
assert.equal(
  typeof createContextHandle,
  'function',
  'compatible Node must expose vm.createContextHandle()',
);

const makePrototypeImmutable = Reflect.get(vm, 'makePrototypeImmutable');
assert.equal(
  typeof makePrototypeImmutable,
  'function',
  'compatible Node must expose vm.makePrototypeImmutable()',
);

const queue = Reflect.apply(createMicrotaskQueue, vm, []);
assert.equal(
  typeof queue.enqueueMicrotask,
  'function',
  'compatible Node microtask queues must support enqueueMicrotask()',
);
assert.equal(
  typeof queue.runMicrotasks,
  'function',
  'compatible Node microtask queues must support runMicrotasks()',
);

const order = [];
const first = Reflect.apply(createContextHandle, vm, [{
  microtaskQueue: queue,
}]);
const second = Reflect.apply(createContextHandle, vm, [{
  microtaskQueue: queue,
}]);

first.globalProxy.record = (value) => { order.push(value); };
second.globalProxy.record = (value) => { order.push(value); };
vm.runInContext(
  'Promise.resolve().then(() => record("first"))',
  first,
);
queue.enqueueMicrotask(() => order.push('host'));
vm.runInContext(
  'Promise.resolve().then(() => record("second"))',
  second,
);
assert.deepEqual(order, []);
queue.runMicrotasks();
assert.deepEqual(order, ['first', 'host', 'second']);

const object = {};
const objectPrototype = {};
assert.equal(Reflect.setPrototypeOf(object, objectPrototype), true);
Reflect.apply(makePrototypeImmutable, vm, [object]);
assert.equal(Reflect.setPrototypeOf(object, {}), false);
assert.equal(Object.isExtensible(object), true);

const globalProxy = first.globalProxy;
const firstObject = vm.runInContext('Object', first);
const firstGlobalPrototype = vm.runInContext('({})', first);

assert.equal(vm.isContext(first), true);
assert.equal(vm.isContext(globalProxy), false);
assert.equal(vm.runInContext('globalThis', first), globalProxy);
assert.equal(
  Reflect.setPrototypeOf(globalProxy, firstGlobalPrototype),
  true,
);
Reflect.apply(makePrototypeImmutable, vm, [globalProxy]);
assert.equal(
  Reflect.setPrototypeOf(globalProxy, firstGlobalPrototype),
  true,
);
assert.equal(Reflect.setPrototypeOf(globalProxy, {}), false);

globalProxy.marker = 'old';
assert.equal(first.detachGlobal(), globalProxy);
assert.equal(vm.isContext(first), false);
assert.throws(
  () => vm.runInContext('1', first),
  { code: 'ERR_CONTEXT_NOT_INITIALIZED' },
);

const replacement = Reflect.apply(createContextHandle, vm, [{
  microtaskQueue: queue,
  reuseGlobalProxyFrom: first,
}]);
assert.throws(
  () => Reflect.apply(createContextHandle, vm, [{
    reuseGlobalProxyFrom: first,
  }]),
  { code: 'ERR_INVALID_ARG_VALUE' },
);
const secondGlobalPrototype = vm.runInContext('({})', replacement);

assert.equal(replacement.globalProxy, globalProxy);
assert.equal(vm.isContext(replacement), true);
assert.equal(vm.isContext(globalProxy), false);
assert.equal(vm.runInContext('globalThis', replacement), globalProxy);
assert.equal(vm.runInContext('typeof marker', replacement), 'undefined');
assert.notEqual(vm.runInContext('Object', replacement), firstObject);

// The new backing global starts mutable.
assert.equal(
  Reflect.setPrototypeOf(globalProxy, secondGlobalPrototype),
  true,
);
Reflect.apply(makePrototypeImmutable, vm, [globalProxy]);
assert.equal(
  Reflect.setPrototypeOf(globalProxy, secondGlobalPrototype),
  true,
);
assert.equal(Reflect.setPrototypeOf(globalProxy, {}), false);
