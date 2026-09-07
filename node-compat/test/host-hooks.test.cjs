'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { AsyncLocalStorage } = require('node:async_hooks');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { spawnSync } = require('node:child_process');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { once } = require('node:events');
const vm = require('node:vm');
const compat = require('../addon/index.cjs');

if (compat.supportsHostHooks === false) {
  testInWorker('host hooks report an unsupported engine without changing existing facilities', () => {
    assert.throws(() => compat.setHostHooks({}), { code: 'ERR_HOST_HOOKS_UNAVAILABLE' });
    const handle = compat.createContextHandle();
    assert.equal(compat.runInContext('1 + 1', handle), 2);
  });
} else {
  testInWorker('declined Promise jobs stay on their original explicit queue', () => {
    const queue = compat.createMicrotaskQueue();
    const handle = compat.createContextHandle({ microtaskQueue: queue });
    const calls = [];
    handle.globalProxy.record = value => calls.push(value);
    compat.setHostHooks({
      enqueuePromiseJob(job) {
        if (compat.getRealm(job) === handle.realm) return false;
        queueMicrotask(job);
      },
    });
    compat.runInContext('Promise.resolve().then(() => record(1)).then().then(() => record(2))', handle);
    assert.deepEqual(calls, []);
    queue.enqueueMicrotask(() => calls.push('host'));
    queue.runMicrotasks();
    assert.deepEqual(calls, [1, 'host', 2]);
  });

  testInWorker('host hook installation returns nothing and cannot be replaced', () => {
    assert.equal(compat.supportsHostHooks, true);
    assert.throws(() => compat.setHostHooks({ unknown() {} }), /Unknown host hook/);
    assert.throws(() => compat.setHostHooks({ enqueuePromiseJob: 1 }), /must be a function/);
    assert.equal(compat.setHostHooks({}), undefined);
    assert.throws(() => compat.setHostHooks({}), { code: 'ERR_HOST_HOOKS_INSTALLED' });
    assert.throws(() => compat.setHostHooks(null), /Expected host hooks/);
  });

  testInWorker('each fulfillment and rejection registration retains its own make result and application ALS', async () => {
    const made = [];
    const called = [];
    const storage = new AsyncLocalStorage();
    const callback = value => { assert.equal(storage.getStore(), 'registered'); return value; };
    compat.setHostHooks({
      makeJobCallback(callback) {
        const record = { callback, hostDefined: {} };
        made.push(record);
        return record;
      },
      callJobCallback(record, receiver, args) {
        if (record.callback === callback) called.push(record);
        return Reflect.apply(record.callback, receiver, args);
      },
    });
    for (const pending of [false, true]) {
      for (const rejected of [false, true]) {
        let settle;
        const promise = pending
          ? new Promise((resolve, reject) => { settle = rejected ? reject : resolve; })
          : rejected ? Promise.reject(17) : Promise.resolve(17);
        const start = made.length;
        const result = storage.run('registered', () => promise.then(callback, callback));
        assert.equal(made.length - start, 2);
        assert.notEqual(made[start], made[start + 1]);
        settle?.(17);
        assert.equal(await result, 17);
        assert.equal(called.at(-1), made[start + Number(rejected)]);
      }
    }
  });

  testInWorker('ordinary-object species do not merge registrations or move capture before validation', async () => {
    const made = [];
    const called = [];
    const callback = value => value;
    compat.setHostHooks({
      makeJobCallback(callback) {
        const record = { callback, hostDefined: {} };
        made.push(record);
        return record;
      },
      callJobCallback(record, receiver, args) {
        if (record.callback === callback) called.push(record);
        return Reflect.apply(record.callback, receiver, args);
      },
    });
    let settle;
    const promise = new Promise(resolve => { settle = resolve; });
    const capability = {};
    promise.constructor = { [Symbol.species]: function(executor) {
      executor(() => {}, () => {});
      return capability;
    } };
    const start = made.length;
    assert.equal(promise.then(callback), capability);
    assert.equal(promise.then(callback), capability);
    const expected = made.slice(start);
    assert.equal(expected.length, 2);
    assert.notEqual(expected[0], expected[1]);
    settle(21);
    await nextTurn();
    assert.deepEqual(called, expected);
    const before = made.length;
    promise.then(1, {});
    assert.equal(made.length, before);
    promise.constructor = { get [Symbol.species]() { throw new Error('species'); } };
    assert.throws(() => promise.then(callback), /species/);
    assert.equal(made.length, before);
  });

  testInWorker('thenable invocation preserves receiver, arguments, thrown value and finally cleanup', async () => {
    const events = [];
    const failure = {};
    const thenable = { then(resolve, reject) {
      assert.equal(this, thenable);
      assert.equal(typeof resolve, 'function');
      assert.equal(typeof reject, 'function');
      events.push('callback');
      throw failure;
    } };
    let made;
    compat.setHostHooks({
      makeJobCallback(callback) {
        const record = { callback, hostDefined: {} };
        if (callback === thenable.then) made = record;
        return record;
      },
      callJobCallback(record, receiver, args) {
        if (record.callback !== thenable.then) return Reflect.apply(record.callback, receiver, args);
        assert.equal(record, made);
        try { return Reflect.apply(record.callback, receiver, args); }
        finally { events.push('cleanup'); }
      },
    });
    await assert.rejects(Promise.resolve(thenable), error => {
      events.push('rejected');
      return error === failure;
    });
    assert.deepEqual(events, ['callback', 'cleanup', 'rejected']);
  });

  testInWorker('registration snapshots identify successive realms sharing one global proxy', () => {
    const snapshots = [];
    const first = compat.createContextHandle();
    compat.setHostHooks({
      makeJobCallback(callback, registration) {
        snapshots.push(registration);
        return { callback, hostDefined: registration };
      },
    });
    compat.runInContext('new Promise(() => {}).then(() => {})', first);
    assert.equal(snapshots[0].incumbent, first.realm);
    assert.equal(compat.getRealm(first.globalProxy), first.realm);
    const proxy = first.detachGlobal();
    const second = compat.createContextHandle({ reuseGlobalProxyFrom: first });
    compat.runInContext('new Promise(() => {}).then(() => {})', second);
    assert.equal(second.globalProxy, proxy);
    assert.notEqual(second.realm, first.realm);
    assert.equal(snapshots[1].incumbent, second.realm);
    assert.equal(snapshots[0].incumbent, first.realm);
    assert.equal(first.realm.global, proxy);
  });

  testInWorker('make works with the default call implementation', async () => {
    const callback = value => value;
    let made = 0;
    compat.setHostHooks({
      makeJobCallback(fn) {
        if (fn === callback) made++;
        return { callback: fn, hostDefined: 9 };
      },
    });
    assert.equal(await Promise.resolve(12).then(callback), 12);
    assert.equal(made, 1);
  });

  testInWorker('call works with the default make implementation', async () => {
    const callback = value => value;
    let called = 0;
    compat.setHostHooks({
      callJobCallback(record, receiver, args) {
        if (record.callback === callback) {
          called++;
          assert.equal(record.hostDefined, undefined);
        }
        return Reflect.apply(record.callback, receiver, args);
      },
    });
    assert.equal(await Promise.resolve(13).then(callback), 13);
    assert.equal(called, 1);
  });

  testInWorker('registration captures the caller realm and script metadata before entering host JavaScript', () => {
    const snapshots = [];
    const callback = () => {};
    const source = new Promise(() => {});
    const sandbox = vm.createContext({ callback, source });
    const realm = compat.getRealm(vm.runInContext('globalThis', sandbox));
    const a = new vm.Script('source.then(callback)', { importModuleDynamically() {} });
    const b = new vm.Script('source.then(callback)', { importModuleDynamically() {} });
    compat.setHostHooks({
      makeJobCallback(fn, registration) {
        if (fn === callback) snapshots.push(registration);
        return { callback: fn, hostDefined: registration };
      },
    });
    for (const script of [a, b, a]) script.runInContext(sandbox);
    assert.equal(snapshots.length, 3);
    for (const snapshot of snapshots) {
      assert.equal(snapshot.current, compat.getRealm(source));
      assert.equal(snapshot.incumbent, realm);
    }
    const ids = snapshots.map(snapshot => snapshot.hostDefinedOptions.find(value => typeof value === 'symbol'));
    assert.ok(ids.every(id => typeof id === 'symbol'));
    assert.notEqual(ids[0], ids[1]);
    assert.equal(ids[0], ids[2]);
  });

  testInWorker('FinalizationRegistry retains its construction record for every cleanup invocation', async () => {
    const made = [];
    const called = [];
    const received = [];
    let active = false;
    function cleanup(value) {
      assert.equal(this, undefined);
      assert.equal(arguments.length, 1);
      assert.equal(active, true);
      received.push(value);
      return { get then() { return assert.fail('cleanup return must not be assimilated'); } };
    }
    compat.setHostHooks({
      makeJobCallback(callback) {
        const record = { callback, hostDefined: {} };
        if (callback === cleanup) made.push(new WeakRef(record));
        return record;
      },
      callJobCallback(record, receiver, args) {
        if (record.callback !== cleanup) return Reflect.apply(record.callback, receiver, args);
        called.push(record);
        active = true;
        try { return Reflect.apply(record.callback, receiver, args); }
        finally { active = false; }
      },
    });
    const registry = new FinalizationRegistry(cleanup);
    registry.register({}, 1);
    registry.register({}, 2);
    assert.equal(made.length, 1);
    const deadline = performance.now() + 5000;
    while (received.length < 2 && performance.now() < deadline) {
      await nextTurn();
      global.gc();
    }
    assert.deepEqual(received.sort(), [1, 2]);
    assert.equal(called[0], made[0].deref());
    assert.equal(called[1], made[0].deref());
    assert.equal(active, false);
    assert.ok(registry); // Keep the registry alive through cleanup.
  });

  testInWorker('nested host work and registrations predating installation keep their own callbacks', async () => {
    let helperCalls = 0;
    let outerCalls = 0;
    const helper = () => { helperCalls++; };
    const preexisting = Promise.resolve().then(helper);
    const then = resolve => resolve(23);
    const outer = () => { outerCalls++; return { then }; };
    const hooks = {
      makeJobCallback(callback) {
        if (callback === then) Promise.resolve().then(helper);
        return { callback, hostDefined: {} };
      },
      callJobCallback: (record, receiver, args) => Reflect.apply(record.callback, receiver, args),
    };
    compat.setHostHooks(hooks);
    await preexisting;
    assert.equal(helperCalls, 1, 'uncaptured work still invokes its original callback');
    assert.equal(await Promise.resolve().then(outer), 23);
    await nextTurn();
    assert.equal(helperCalls, 2);
    assert.equal(outerCalls, 1);
  });

  testInWorker('invalid make results and throwing make/enqueue hooks report uncaught host errors', () => {
    for (const [hooks, message] of [
      ['{ makeJobCallback() { return {}; } }', /must return a record containing the original callback/],
      ['{ makeJobCallback() { throw new Error("capture failed"); } }', /capture failed/],
      ['{ enqueuePromiseJob() { throw new Error("enqueue failed"); } }', /enqueue failed/],
    ]) {
      const child = spawnSync(process.execPath, ['-e',
        `require(${JSON.stringify(require.resolve('../addon/index.cjs'))}).setHostHooks(${hooks});
         Promise.resolve().then(() => {});`], { encoding: 'utf8', timeout: 5000 });
      assert.equal(child.error, undefined);
      assert.equal(child.signal, null);
      assert.equal(child.status, 1, child.stderr);
      assert.match(child.stderr, message);
    }
  });

  testInWorker('worker teardown releases installed hooks and retained jobs', async () => {
    const worker = new Worker(`
      const { parentPort } = require('node:worker_threads');
      const compat = require(${JSON.stringify(require.resolve('../addon/index.cjs'))});
      const jobs = [];
      compat.setHostHooks({
        makeJobCallback: callback => ({ callback, hostDefined: {} }),
        enqueuePromiseJob: job => jobs.push(job),
        enqueueGenericJob: job => jobs.push(job),
        enqueueTimeoutJob: job => jobs.push(job),
      });
      const handle = compat.createContextHandle({ microtaskQueue: compat.createMicrotaskQueue() });
      handle.globalProxy.buffer = new SharedArrayBuffer(4);
      compat.runInContext('Promise.resolve().then(() => {}); Atomics.waitAsync(new Int32Array(buffer), 0, 0, 1000)', handle);
      parentPort.on('message', () => {});
      parentPort.postMessage(jobs.length);
    `, { eval: true });
    try { assert.deepEqual(await once(worker, 'message'), [2]); }
    finally { assert.equal(await worker.terminate(), 1); }
  });

  testInWorker('Promise enqueue hands scheduling to the host, including null realms and retained jobs', async () => {
    const queue = compat.createMicrotaskQueue();
    const handle = compat.createContextHandle({ microtaskQueue: queue });
    const jobs = [];
    const trace = [];
    handle.globalProxy.record = value => trace.push(value);
    compat.setHostHooks({
      enqueuePromiseJob(job, realm, enqueue) {
        if (enqueue.current === handle.realm) jobs.push({ job, realm, enqueue });
        else queueMicrotask(job);
      },
    });
    compat.runInContext('Promise.resolve().then(() => record(1)); Promise.resolve().then()', handle);
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].realm, handle.realm);
    assert.equal(jobs[1].realm, null);
    queue.runMicrotasks();
    assert.deepEqual(trace, []);
    await nextTurn();
    global.gc();
    queue.enqueueMicrotask(jobs[0].job);
    queue.enqueueMicrotask(() => trace.push('host'));
    queue.enqueueMicrotask(jobs[1].job);
    queue.runMicrotasks();
    assert.deepEqual(trace, [1, 'host']);
    assert.throws(() => jobs[0].job(), /already run/);
    assert.throws(() => Reflect.construct(jobs[1].job, []), /not a constructor/);
  });

  testInWorker('generic notification, timeout scheduling and Promise reactions remain separate handoffs', async () => {
    const queue = compat.createMicrotaskQueue();
    const handle = compat.createContextHandle({ microtaskQueue: queue });
    const buffer = new SharedArrayBuffer(8);
    const array = new Int32Array(buffer);
    handle.globalProxy.buffer = buffer;
    const generic = [];
    const timeouts = [];
    const reactions = [];
    const outcomes = [];
    const invoked = [];
    handle.globalProxy.record = value => outcomes.push(value);
    compat.setHostHooks({
      makeJobCallback(callback, registration) {
        return { callback, hostDefined: registration };
      },
      callJobCallback(record, receiver, args) {
        if (record.hostDefined.incumbent === handle.realm) invoked.push(args[0]);
        return Reflect.apply(record.callback, receiver, args);
      },
      // These void hooks transfer ownership even if JavaScript returns false.
      enqueueGenericJob(job, realm) { generic.push({ job, realm }); return false; },
      enqueueTimeoutJob(job, realm, milliseconds) { timeouts.push({ job, realm, milliseconds }); return false; },
      enqueuePromiseJob(job, realm) {
        if (realm === handle.realm) reactions.push(job);
        else queueMicrotask(job);
      },
    });
    compat.runInContext('Atomics.waitAsync(new Int32Array(buffer), 0, 0, 1).value.then(value => record(value))', handle);
    compat.runInContext('Atomics.waitAsync(new Int32Array(buffer), 1, 0, 1).value.then(value => record(value))', handle);
    assert.equal(timeouts.length, 2);
    assert.ok(timeouts.every(item => item.realm === handle.realm && item.milliseconds >= 0 && item.milliseconds <= 1));
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(outcomes, []);
    assert.equal(reactions.length, 0);
    assert.equal(Atomics.notify(array, 0), 1);
    const deadline = performance.now() + 5000;
    while (generic.length === 0 && performance.now() < deadline) await nextTurn();
    assert.equal(generic.length, 1, 'notification must reach the host');
    assert.equal(generic[0].realm, handle.realm);
    assert.equal(reactions.length, 0);
    generic[0].job();
    assert.equal(reactions.length, 1);
    timeouts[0].job(); // Notification cancelled this timeout.
    assert.equal(reactions.length, 1);
    timeouts[1].job();
    assert.equal(reactions.length, 2);
    for (const job of reactions) queue.enqueueMicrotask(job);
    queue.runMicrotasks();
    assert.deepEqual(outcomes, ['ok', 'timed-out']);
    assert.deepEqual(invoked, outcomes, 'make/call records survive all three enqueue handoffs');
    assert.throws(() => generic[0].job(), /already run/);
    assert.throws(() => timeouts[1].job(), /already run/);
  });
}

// Hook configuration lasts for the isolate; each test gets a fresh one.
function testInWorker(name, run) {
  if (isMainThread) {
    test(name, { timeout: 10000 }, async context => {
      const worker = new Worker(__filename, { workerData: name });
      context.after(() => worker.terminate());
      let completed = false;
      worker.once('message', () => { completed = true; });
      const [code] = await once(worker, 'exit');
      assert.equal(code, 0);
      assert.equal(completed, true, 'worker must finish the test before exiting');
    });
  } else if (workerData === name) {
    Promise.resolve().then(run).then(() => parentPort.postMessage('complete'));
  }
}
