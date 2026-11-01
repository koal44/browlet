'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { Worker } = require('node:worker_threads');
const compat = require('../addon/index.cjs');
const { assertCollected } = require('./support/gc.cjs');

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

  a.register(); b.register();
  await collectUntil(() => a.state.cleanups === 1 && b.state.cleanups === 1);
  assert.equal(notifications, 1, 'related contexts share one pending notification');
  assert.equal(unrelated, 0);
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
