'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { Worker } = require('node:worker_threads');
const { promiseHooks } = require('node:v8');
const compat = require('../addon/index.cjs');
const { assertCollected } = require('./support/gc.cjs');

test('Promise settlement requests its owning checkpoint without observing the result', () => {
  let notifications = 0;
  let unrelated = 0;
  const queue = compat.createMicrotaskQueue(() => { notifications++; });
  const other = compat.createMicrotaskQueue(() => { unrelated++; });
  const context = compat.createContextHandle({ microtaskQueue: queue });
  const idle = compat.createContextHandle({ microtaskQueue: other });
  const state = compat.runInContext(`
    const state = { reactions: 0 };
    state.promise = new Promise(resolve => { state.resolve = resolve; });
    state.promise.then(() => { state.reactions++; });
    state.unobserved = new Promise(resolve => { state.resolveUnobserved = resolve; });
    Object.defineProperty(state.unobserved, 'then', { get() { throw 'must not read then'; } });
    Object.defineProperty(state.unobserved, 'constructor', { get() { throw 'must not read constructor'; } });
    state;
  `, context);
  assert.equal(notifications, 0);
  state.resolve('fulfilled');
  state.resolveUnobserved('fulfilled');
  assert.equal(notifications, 1, 'settlements coalesce on the Promise owner, even when called from Node');
  assert.equal(unrelated, 0);
  assert.equal(state.reactions, 0, 'notification must not drain or re-enter author code');
  assert.equal(compat.isPromiseHandled(state.unobserved), false, 'no extra reaction is attached');
  queue.runMicrotasks();
  assert.equal(state.reactions, 1);
  assert.equal(notifications, 1, 'settlement during the checkpoint must not wake it again');
  // Keep the unrelated context live throughout the observations.
  assert.ok(idle.realm);
});

test('settlement notification coexists with Node hooks installed and removed later', () => {
  const observed = new WeakSet();
  const stop = promiseHooks.onSettled(promise => { observed.add(promise); });
  try {
    let notifications = 0;
    const queue = compat.createMicrotaskQueue(() => { notifications++; });
    const context = compat.createContextHandle({ microtaskQueue: queue });
    const state = compat.runInContext(`
      const state = {};
      state.promise = new Promise(resolve => { state.resolve = resolve; });
      state.next = new Promise(resolve => { state.resolveNext = resolve; });
      state;
    `, context);
    state.resolve();
    assert.ok(observed.has(state.promise));
    assert.equal(notifications, 1);
    queue.runMicrotasks();
    stop();
    state.resolveNext();
    assert.equal(notifications, 2, 'removing another Node hook must preserve notification');
    queue.runMicrotasks();
    Promise.resolve('unrelated Node work');
    assert.equal(notifications, 2, 'Node-owned settlements must not notify Window queues');
  } finally { stop(); }
});

test('a detached Promise owner cannot notify its former queue', () => {
  let notifications = 0;
  const queue = compat.createMicrotaskQueue(() => { notifications++; });
  const context = compat.createContextHandle({ microtaskQueue: queue });
  const resolve = compat.runInContext(`
    let resolve;
    new Promise(fulfill => { resolve = fulfill; });
    resolve;
  `, context);
  context.detachGlobal();
  resolve('fulfilled');
  assert.equal(notifications, 0);
});

test('a checkpoint suppresses its completed work but preserves another queue\'s wake-up', () => {
  let firstNotifications = 0;
  let secondNotifications = 0;
  const first = compat.createMicrotaskQueue(() => { firstNotifications++; });
  const second = compat.createMicrotaskQueue(() => { secondNotifications++; });
  const firstContext = compat.createContextHandle({ microtaskQueue: first });
  const secondContext = compat.createContextHandle({ microtaskQueue: second });
  const state = compat.runInContext(`
    const state = { reactions: 0 };
    new Promise(resolve => { state.resolve = resolve; }).then(() => state.reactions++);
    state;
  `, secondContext);
  firstContext.globalProxy.resolveOther = state.resolve;
  compat.runInContext('Promise.resolve().then(() => resolveOther())', firstContext);
  assert.equal(firstNotifications, 1);
  assert.equal(secondNotifications, 0);
  first.runMicrotasks();
  assert.equal(firstNotifications, 1, 'drained reactions must not schedule another checkpoint');
  assert.equal(secondNotifications, 1, 'the other queue still needs its checkpoint');
  assert.equal(state.reactions, 0);
  second.runMicrotasks();
  assert.equal(state.reactions, 1);
  assert.equal(secondNotifications, 1);
});

test('an internal Atomics completion still wakes its owning queue', async () => {
  let notifications = 0;
  const queue = compat.createMicrotaskQueue(() => { notifications++; });
  const context = compat.createContextHandle({ microtaskQueue: queue });
  const state = compat.runInContext(`
    const state = { result: undefined };
    const wait = Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    wait.value.then(value => { state.result = value; });
    state;
  `, context);
  const deadline = performance.now() + 2000;
  while (notifications === 0 && performance.now() < deadline) await delay(10);
  assert.equal(notifications, 1);
  assert.equal(state.result, undefined, 'notification must leave author reactions queued');
  queue.runMicrotasks();
  assert.equal(state.result, 'timed-out');
  assert.equal(notifications, 1);
});

test('native cleanup notifies only its queue and coalesces until a checkpoint', { timeout: 15000 }, async () => {
  let notifications = 0;
  let unrelated = 0;
  const queue = compat.createMicrotaskQueue(() => { notifications++; });
  const other = compat.createMicrotaskQueue(() => { unrelated++; });
  const a = fixture(queue);
  const b = fixture(queue);
  const idle = fixture(other);
  // Unrelated work is present, but another queue's completion cannot drain it.
  compat.runInContext('Promise.resolve().then(() => state.reactions++)', idle.context);
  assert.equal(unrelated, 1, 'its own settlement requests a separate checkpoint');

  a.register(); b.register();
  await collectUntil(() => a.state.cleanups === 1 && b.state.cleanups === 1);
  assert.equal(notifications, 1, 'related contexts share one pending notification');
  assert.equal(unrelated, 1, 'cleanup in another queue adds no notification');
  assert.equal(a.state.reactions + b.state.reactions + idle.state.reactions, 0,
    'notification must not run the queue itself');
  queue.runMicrotasks();
  assert.equal(a.state.reactions, 1);
  assert.equal(b.state.reactions, 1);
  assert.equal(idle.state.reactions, 0);

  a.register();
  await collectUntil(() => a.state.cleanups === 2);
  assert.equal(notifications, 2, 'checkpoint re-arms notification');
  queue.runMicrotasks();
  await delay(30);
  assert.equal(notifications, 2, 'checkpoint must not notify itself');
  assert.equal(a.state.reactions, 2);
  other.runMicrotasks();
});

test('unregistered contexts and Node cleanup leave observed queues alone', { timeout: 15000 }, async () => {
  let notifications = 0;
  const queue = compat.createMicrotaskQueue(() => { notifications++; });
  const idle = fixture(queue);
  const unobserved = fixture(compat.createMicrotaskQueue());
  let hostCleanup = false;
  const registry = new FinalizationRegistry(() => { hostCleanup = true; });
  registry.register({}, 1);
  unobserved.register();
  await collectUntil(() => hostCleanup && unobserved.state.cleanups === 1);
  assert.equal(notifications, 0);
  assert.equal(unobserved.state.reactions, 0);
  assert.equal(idle.state.reactions, 0);
  unobserved.queue.runMicrotasks();
  assert.equal(unobserved.state.reactions, 1);
});

test('a retained context keeps its queue and notification alive', { timeout: 15000 }, async () => {
  let notifications = 0;
  const context = (() => {
    const queue = compat.createMicrotaskQueue(() => { notifications++; });
    return compat.createContextHandle({ microtaskQueue: queue });
  })();
  global.gc();
  const state = setup(context);
  compat.runInContext('registry.register({}, 1)', context);
  await collectUntil(() => state.cleanups === 1);
  assert.equal(notifications, 1);
});

test('notification cycles and contexts remain collectable', { timeout: 15000 }, async () => {
  function allocate() {
    let context;
    const callback = () => { void context; };
    const queue = compat.createMicrotaskQueue(callback);
    context = compat.createContextHandle({ microtaskQueue: queue });
    return { queue: new WeakRef(queue), context: new WeakRef(context), callback: new WeakRef(callback) };
  }
  await assertCollected(allocate());
  assert.throws(() => compat.createMicrotaskQueue({}), { code: 'ERR_INVALID_ARG_TYPE' });
});

test('worker notification registrations are removed during environment teardown', { timeout: 15000 }, async () => {
  for (let i = 0; i < 2; i++) {
    await new Promise((resolve, reject) => {
      const worker = new Worker(`
        const compat = require(${JSON.stringify(require.resolve('../addon/index.cjs'))});
        const queue = compat.createMicrotaskQueue(() => {});
        globalThis.context = compat.createContextHandle({ microtaskQueue: queue });
      `, { eval: true });
      worker.once('error', reject);
      worker.once('exit', code => code === 0 ? resolve() : reject(new Error('Worker exited ' + code)));
    });
  }
});

function fixture(queue) {
  const context = compat.createContextHandle({ microtaskQueue: queue });
  const state = setup(context);
  return { context, state, queue, register() { compat.runInContext('registry.register({}, 1)', context); } };
}

function setup(context) {
  return compat.runInContext(`
    globalThis.state = { cleanups: 0, reactions: 0 };
    globalThis.registry = new FinalizationRegistry(() => {
      state.cleanups++;
      Promise.resolve().then(() => state.reactions++);
    });
    state;
  `, context);
}

async function collectUntil(done) {
  const deadline = performance.now() + 5000;
  do {
    global.gc();
    await delay(10);
  } while (!done() && performance.now() < deadline);
  assert.ok(done(), 'GC must actually deliver all required cleanup callbacks');
}
