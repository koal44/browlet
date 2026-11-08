'use strict';
/* global __filename, process, console */

const assert = require('node:assert/strict');
const { isMainThread } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');
const { performance } = require('node:perf_hooks');

process.env.TSX_DISABLE_CACHE = '1';
const { requireTypeScript } = require('../../support/typescript.cjs');
const { JSThread, JSThreadEndpoint } = requireTypeScript('../../../src/js-engine/threads.ts', __filename);
const { JSRealm } = requireTypeScript('../../../src/js-engine/realm.ts', __filename);
const { createMicrotaskQueue } = requireTypeScript('../../../src/js-engine/runtime.ts', __filename);
const { addon } = requireTypeScript('../../../src/js-engine/node-addons.ts', __filename);

JSThread.initialize(pathToFileURL(__filename).href, startThread);
if (isMainThread) {
  run(process.argv[2]).then(() => console.log('passed')).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

/** Exercise the engine owner without an HTML startup or task-policy substitute. */
async function run(mode) {
  // started, finish request, progress, finally, sibling, dependent, returned.
  const state = new Int32Array(new SharedArrayBuffer(7 * Int32Array.BYTES_PER_ELEMENT));
  const messages = [];
  const thread = new JSThread({ state, mode }, message => messages.push(message));
  try {
    if (!addon.createThreadControl) {
      // Stock Node retains ordinary startup, messaging, and termination. It
      // must reject a request it cannot implement, rather than pretend to pause.
      assert.throws(() => thread.suspend(), /requires the Node compatibility addon/);
      assert.throws(() => thread.resume(), /requires the Node compatibility addon/);
      await until(() => messages.includes('ready'));
      assert.equal(thread.suspended, false);
      return;
    }
    if (mode === 'before-entry' || mode === 'cancel-before-entry') {
      thread.suspend();
      if (mode === 'cancel-before-entry') thread.resume();
      else {
        await until(() => thread.suspended);
        await delay(40);
        assert.deepEqual(messages, []);
        assert.equal(Atomics.load(state, 0), 0);
        thread.resume();
      }
      await until(() => messages.includes('ready'));
      thread.send('close');
      assert.deepEqual(await thread.closed, { code: 0, error: undefined, terminated: false });
      assert.equal(thread.suspended, false);
      return;
    }
    await until(() => messages.includes('ready'));
    if (mode === 'clock') {
      const readClock = async () => {
        const count = messages.length;
        thread.send('clock');
        await until(() => messages.length > count);
        return messages.at(-1);
      };
      const before = await readClock();
      for (let cycle = 0; cycle < 2; cycle++) {
        thread.suspend();
        // The worker is idle. A host message supplies the next JavaScript entry
        // so the pending native interrupt can enter its wait.
        thread.send('ping');
        await until(() => thread.suspended);
        await delay(100);
        thread.resume();
        await until(() => messages.filter(message => message === 'pong').length === cycle + 1);
      }
      const after = await readClock();
      assert.ok(after.elapsed >= before.elapsed, 'elapsed time stays monotonic');
      assert.ok((after.now - before.now) - (after.elapsed - before.elapsed) >= 190,
        'the timer clock excludes both waits while the ordinary clock advances');
      await delay(60);
      const idle = await readClock();
      assert.ok(idle.elapsed - after.elapsed >= 50, 'unsuspended idle time counts');
      thread.send('close');
      assert.deepEqual(await thread.closed, { code: 0, error: undefined, terminated: false });
      return;
    }
    thread.send('run');
    await until(() => Atomics.load(state, 0) === 1);
    const nested = ['descendant', 'owner-error', 'owner-exit'].includes(mode);
    if (nested) {
      thread.send('suspend-child');
      await until(() => messages.includes('child-suspended'));
      const progress = Atomics.load(state, 2);
      await delay(50);
      assert.equal(Atomics.load(state, 2), progress);
    } else {
      for (let cycle = 0; cycle < 2; cycle++) {
        thread.suspend();
        await until(() => thread.suspended);
        const progress = Atomics.load(state, 2);
        thread.send('ping');
        const delivered = messages.length;
        await delay(60);
        assert.equal(Atomics.load(state, 2), progress);
        assert.deepEqual(Array.from(state).slice(3), [0, 0, 0, 0]);
        assert.equal(messages.length, delivered, 'host messages also wait');
        if (mode === 'terminate') break;
        thread.resume();
        await until(() => Atomics.load(state, 2) !== progress);
      }
    }
    if (mode === 'owner-error' || mode === 'owner-exit') {
      thread.send(mode);
      const result = await Promise.race([
        thread.closed,
        delay(1500, undefined, { ref: false }).then(() => { throw new Error('owner exit did not release its suspended descendant'); }),
      ]);
      assert.equal(result.code, mode === 'owner-error' ? 1 : 0);
      assert.equal(result.terminated, false);
      if (mode === 'owner-error') assert.equal(result.error?.message, 'owner failed');
      else assert.equal(result.error, undefined);
      assert.deepEqual(Array.from(state).slice(3), [0, 0, 0, 0]);
    } else if (mode === 'terminate' || mode === 'descendant') {
      const completion = thread.terminate();
      thread.resume(); // Cannot undo a stop or allow author finally to run.
      assert.equal(thread.terminate(), completion);
      assert.deepEqual(await completion, { code: 1, error: undefined, terminated: true });
      assert.deepEqual(Array.from(state).slice(3), [0, 0, 0, 0]);
      assert.equal(thread.suspended, false);
    } else {
      Atomics.store(state, 1, 1);
      await until(() => messages.some(message => Array.isArray(message)));
      assert.deepEqual(messages.find(Array.isArray), mode === 'reaction'
        ? ['finally', 'return', 'sibling', 'dependent'] : ['finally', 'return']);
      await until(() => messages.filter(message => message === 'pong').length === 2);
      thread.send('close');
      assert.deepEqual(await thread.closed, { code: 0, error: undefined, terminated: false });
    }
  } finally {
    Atomics.store(state, 1, 1);
    await thread.terminate();
  }
}

/** Real child entry; its realm owns the executing task or Promise reaction. */
function startThread() {
  const endpoint = new JSThreadEndpoint();
  const { state, mode } = endpoint.data;
  const queue = createMicrotaskQueue();
  const realm = new JSRealm(queue);
  const work = realm.evaluate(`(${authorWork.toString()})`, 'suspended-script.js');
  let child;
  endpoint.listen(message => {
    if (message === 'close') endpoint.disconnect();
    else if (message === 'clock') endpoint.send({ elapsed: endpoint.elapsedTime, now: performance.now() });
    else if (message === 'ping') endpoint.send('pong');
    else if (message === 'run') {
      if (['descendant', 'owner-error', 'owner-exit'].includes(mode)) {
        child = new JSThread({ state, mode: 'task' }, reply => {
          if (reply === 'ready') child.send('run');
        });
      } else {
        work(state, mode, result => endpoint.send(result));
        queue.performMicrotaskCheckpoint();
      }
    } else if (message === 'suspend-child') {
      child.suspend();
      until(() => child.suspended).then(() => endpoint.send('child-suspended'));
    } else if (message === 'owner-error') throw new Error('owner failed');
    else if (message === 'owner-exit') process.exit(0);
    else throw new Error(`Unexpected thread command: ${message}`);
  });
  endpoint.send('ready');
}

/** Compiled in the worker's realm; all observations use the supplied shared buffer. */
function authorWork(state, mode, report) {
  const order = [];
  function loop() {
    Atomics.store(state, 0, 1);
    try {
      while (Atomics.load(state, 1) === 0) Atomics.add(state, 2, 1);
    } finally {
      Atomics.store(state, 3, 1);
      order.push('finally');
    }
    Atomics.store(state, 6, 1);
    order.push('return');
  }
  if (mode === 'reaction') {
    const first = Promise.resolve().then(loop);
    Promise.resolve().then(() => { Atomics.store(state, 4, 1); order.push('sibling'); });
    first.then(() => { Atomics.store(state, 5, 1); order.push('dependent'); report(order); });
  } else {
    loop();
    report(order);
  }
}

/** Wait only on outside observations; the inner fixture has no polling control loop. */
async function until(predicate) {
  const deadline = Date.now() + 12_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'thread observation timed out');
    await delay(5);
  }
}
