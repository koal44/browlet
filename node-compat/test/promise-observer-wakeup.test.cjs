'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { Worker } = require('node:worker_threads');
const compat = require('../addon/index.cjs');
const { assertCollected } = require('./support/gc.cjs');

for (const alreadySettled of [false, true]) {
  for (const rejected of [false, true]) {
    test(`native observation wakes its destination (settled: ${alreadySettled}, rejected: ${rejected})`, () => {
      const observer = fixture();
      const source = Promise.withResolvers();
      Object.defineProperty(source.promise, 'then', { get() { throw new Error('must not read then'); } });
      Object.freeze(source.promise);
      const value = {};
      const settle = () => rejected ? source.reject(value) : source.resolve(value);
      if (alreadySettled) settle();
      observer.observe(source.promise);
      if (!alreadySettled) {
        assert.equal(observer.notifications, 0, 'pending registration needs no checkpoint');
        settle();
      }
      assert.equal(observer.notifications, 1);
      assert.deepEqual(observer.delivered, [], 'notification must not run reactions');
      observer.queue.runMicrotasks();
      assert.deepEqual(observer.delivered, [[rejected ? 'rejected' : 'fulfilled', value]]);
      assert.equal(observer.notifications, 1, 'draining must not notify itself');
    });
  }
}

for (const alreadySettled of [false, true]) {
  test(`a requested source checkpoint does not mask its observer (settled: ${alreadySettled})`, () => {
    const owner = fixture(), observer = fixture();
    const source = compat.runInContext('Promise.withResolvers()', owner.context);
    compat.runInContext('Promise.resolve()', owner.context);
    assert.equal(owner.notifications, 1);
    if (alreadySettled) source.resolve('done');
    observer.observe(source.promise);
    if (!alreadySettled) source.resolve('done');

    const requested = observer.notifications;
    assert.equal(owner.notifications, 1, 'the source request remains coalesced');
    assert.deepEqual(observer.delivered, [], 'notification must not drain reactions');
    observer.queue.runMicrotasks();
    assert.deepEqual(observer.delivered, [['fulfilled', 'done']],
      'delivery must not depend on draining the source queue');
    owner.queue.runMicrotasks();
    assert.equal(requested, 1, 'the destination needs its own immediate checkpoint request');
  });
}

test('native observation coalesces by destination and re-arms after a checkpoint', () => {
  const a = fixture(), b = fixture(), idle = fixture();
  const source = Promise.withResolvers();
  a.observe(source.promise);
  a.observe(source.promise);
  b.observe(source.promise);
  source.resolve('first');
  assert.equal(a.notifications, 1);
  assert.equal(b.notifications, 1);
  assert.equal(idle.notifications, 0);
  a.queue.runMicrotasks();
  assert.equal(a.delivered.length, 2);
  assert.equal(b.delivered.length, 0);
  b.queue.runMicrotasks();
  assert.deepEqual(b.delivered, [['fulfilled', 'first']]);
  a.observe(Promise.resolve('later'));
  assert.equal(a.notifications, 2);
  assert.equal(b.notifications, 1);
  assert.equal(idle.notifications, 0);
  a.queue.runMicrotasks();
  assert.deepEqual(a.delivered.at(-1), ['fulfilled', 'later']);
});

test('native observation preserves another queue wake-up during a checkpoint', () => {
  const a = fixture(), b = fixture();
  const source = Promise.withResolvers();
  a.observe(source.promise);
  b.observe(source.promise);
  a.queue.enqueueMicrotask(() => source.resolve('done'));
  a.queue.runMicrotasks();
  assert.equal(a.notifications, 0, 'the running queue already drains its reactions');
  assert.equal(b.notifications, 1);
  assert.deepEqual(a.delivered, [['fulfilled', 'done']]);
  assert.deepEqual(b.delivered, []);
  b.queue.runMicrotasks();
  assert.deepEqual(b.delivered, [['fulfilled', 'done']]);
});

test('native observation survives adoption of a still-pending Promise', async () => {
  const observer = fixture();
  const source = Promise.withResolvers(), adopted = Promise.withResolvers();
  observer.observe(source.promise);
  source.resolve(adopted.promise);
  await nextTurn();
  observer.queue.runMicrotasks();
  const before = observer.notifications;
  assert.deepEqual(observer.delivered, []);
  adopted.resolve('adopted');
  await nextTurn();
  assert.equal(observer.notifications, before + 1);
  observer.queue.runMicrotasks();
  assert.deepEqual(observer.delivered, [['fulfilled', 'adopted']]);
});

test('native observation added during notification also wakes its destination', () => {
  const source = Promise.withResolvers();
  const b = fixture();
  const a = fixture(() => b.observe(source.promise));
  a.observe(source.promise);
  source.resolve('done');
  assert.equal(a.notifications, 1);
  assert.equal(b.notifications, 1);
  a.queue.runMicrotasks();
  b.queue.runMicrotasks();
  assert.deepEqual(a.delivered, [['fulfilled', 'done']]);
  assert.deepEqual(b.delivered, [['fulfilled', 'done']]);
});

test('a detached observer cannot notify its former queue', () => {
  const observer = fixture();
  const source = Promise.withResolvers();
  observer.observe(source.promise);
  observer.context.detachGlobal();
  source.resolve('done');
  assert.equal(observer.notifications, 0);
  observer.queue.runMicrotasks();
  assert.deepEqual(observer.delivered, []);
});

test('a retained settled Promise does not retain observer contexts or queues', { timeout: 15000 }, async () => {
  const source = Promise.withResolvers();
  function allocate() {
    const callback = () => {};
    const queue = compat.createMicrotaskQueue(callback);
    const context = compat.createContextHandle({ microtaskQueue: queue });
    compat.observePromise(source.promise, compat.runInContext('Promise', context), () => {}, () => {});
    source.resolve();
    queue.runMicrotasks();
    return { queue: new WeakRef(queue), context: new WeakRef(context), callback: new WeakRef(callback) };
  }
  await assertCollected(allocate());
  assert.equal(compat.getPromiseResult(source.promise), undefined);
});

test('pending observer registrations and their Promise remain collectable', { timeout: 15000 }, async () => {
  function allocate() {
    const source = Promise.withResolvers();
    const queue = compat.createMicrotaskQueue(() => {});
    const context = compat.createContextHandle({ microtaskQueue: queue });
    compat.observePromise(source.promise, compat.runInContext('Promise', context), () => {}, () => {});
    return { source: new WeakRef(source.promise), queue: new WeakRef(queue), context: new WeakRef(context) };
  }
  await assertCollected(allocate());
});

test('pending observer registrations are released during worker teardown', { timeout: 15000 }, async () => {
  for (let i = 0; i < 2; i++) {
    await new Promise((resolve, reject) => {
      const worker = new Worker(`
        const compat = require(${JSON.stringify(require.resolve('../addon/index.cjs'))});
        const queue = compat.createMicrotaskQueue(() => {});
        const context = compat.createContextHandle({ microtaskQueue: queue });
        globalThis.source = Promise.withResolvers();
        compat.observePromise(source.promise, compat.runInContext('Promise', context), () => {}, () => {});
      `, { eval: true });
      worker.once('error', reject);
      worker.once('exit', code => code === 0 ? resolve() : reject(new Error('Worker exited ' + code)));
    });
  }
});

function fixture(onNotify = () => {}) {
  const result = { notifications: 0, delivered: [] };
  const queue = compat.createMicrotaskQueue(() => { result.notifications++; onNotify(); });
  const context = compat.createContextHandle({ microtaskQueue: queue });
  const anchor = compat.runInContext('Promise', context);
  return Object.assign(result, { queue, context, observe(promise) {
    compat.observePromise(promise, anchor,
      value => { result.delivered.push(['fulfilled', value]); },
      reason => { result.delivered.push(['rejected', reason]); });
  } });
}
