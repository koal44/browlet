'use strict';

const assert = require('node:assert/strict');
const process = require('node:process');
const { log } = require('node:console');
const compat = require('../addon/index.cjs');

const queue = compat.createMicrotaskQueue();
const first = compat.createContextHandle({ microtaskQueue: queue });
const second = compat.createContextHandle({ microtaskQueue: queue });
const order = [];
first.globalProxy.record = second.globalProxy.record = value => order.push(value);
compat.runInContext('Promise.resolve().then(() => record("first"))', first);
queue.enqueueMicrotask(() => order.push('host'));
compat.runInContext('Promise.resolve().then(() => record("second"))', second);
assert.deepEqual(order, []);
queue.runMicrotasks();
assert.deepEqual(order, ['first', 'host', 'second']);
const originalObject = first.globalProxy.Object;
const proxy = first.detachGlobal();
const replacement = compat.createContextHandle({
  microtaskQueue: queue, reuseGlobalProxyFrom: first,
});
assert.equal(replacement.globalProxy, proxy);
assert.notEqual(replacement.globalProxy.Object, originalObject);
log(`[node-compat] ${process.version}: queues and context handles available; ` +
  `post-creation immutable prototypes ${compat.makePrototypeImmutable ? 'available' : 'unavailable'}`);
