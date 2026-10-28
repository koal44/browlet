'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { assertCollected } = require('./support/gc.cjs');
const native = require('../addon/index.cjs');
const compat = native;

function fixture() {
  const queue = compat.createMicrotaskQueue();
  const realm = compat.createContextHandle({ microtaskQueue: queue });
  const events = [];
  native.setPromiseRejectionTracker(realm, (promise, operation) => events.push({ promise, operation }));
  return { queue, realm, events, run: source => compat.runInContext(source, realm) };
}

test('rejection and handler notifications are synchronous and preserve promise/reason identity', () => {
  const f = fixture();
  const reason = {};
  const during = [];
  native.setPromiseRejectionTracker(f.realm, (promise, operation) => {
    f.events.push({ promise, operation });
    during.push([operation, native.isPromiseHandled(promise), native.getPromiseResult(promise)]);
  });
  f.realm.globalProxy.reason = reason;
  const promise = f.run('Promise.reject(reason)');
  assert.deepEqual(f.events, [{ promise, operation: 'reject' }]);
  assert.equal(native.isPromiseHandled(promise), false);
  assert.equal(native.getPromiseResult(promise), reason);
  f.realm.globalProxy.promise = promise;
  f.run('promise.catch(() => {})');
  assert.deepEqual(f.events, [{ promise, operation: 'reject' }, { promise, operation: 'handle' }]);
  assert.equal(native.isPromiseHandled(promise), true);
  assert.deepEqual(during, [['reject', false, reason], ['handle', false, reason]]);
  f.queue.runMicrotasks();
  assert.equal(f.events.length, 2);
});

test('promises handled before rejection do not report an unhandled rejection', () => {
  const f = fixture();
  const promise = f.run(`
    let reject;
    const promise = new Promise((_, r) => { reject = r; });
    promise.catch(() => {});
    reject('already handled');
    promise;
  `);
  assert.equal(native.isPromiseHandled(promise), true);
  assert.equal(native.getPromiseResult(promise), 'already handled');
  f.queue.runMicrotasks();
  assert.deepEqual(f.events, []);
});

test('then without an explicit rejection handler transfers the rejection to the derived promise', () => {
  const f = fixture();
  const pair = f.run('const first = Promise.reject(42); [first, first.then()];');
  assert.deepEqual(f.events, [
    { promise: pair[0], operation: 'reject' }, { promise: pair[0], operation: 'handle' },
  ]);
  assert.equal(native.isPromiseHandled(pair[0]), true);
  f.queue.runMicrotasks();
  assert.deepEqual(f.events[2], { promise: pair[1], operation: 'reject' });
  assert.equal(native.getPromiseResult(pair[1]), 42);
  assert.equal(native.isPromiseHandled(pair[1]), false);
});

test('async functions, thenable jobs and nested rejections use the notification boundary', () => {
  const f = fixture();
  const promises = f.run(`
    [
      (async () => { await 0; throw 'async'; })(),
      Promise.resolve({ then(resolve, reject) { reject('thenable'); } }),
      Promise.resolve().then(() => { throw 'reaction'; }),
    ];
  `);
  assert.equal(f.events.length, 0);
  f.queue.runMicrotasks();
  assert.equal(f.events.length, 3);
  for (const promise of promises) {
    assert.ok(f.events.some(event => event.promise === promise && event.operation === 'reject'));
    assert.equal(native.isPromiseHandled(promise), false);
  }
  assert.deepEqual(Array.from(promises, p => native.getPromiseResult(p)), ['async', 'thenable', 'reaction']);
});

test('slot queries bypass author properties and do not mark the promise as handled', () => {
  const f = fixture();
  const poison = () => { throw new Error('author property read'); };
  const promise = f.run('let reject; const p = new Promise((_, r) => { reject = r; }); p;');
  Object.defineProperties(promise, { then: { get: poison }, constructor: { get: poison } });
  Object.freeze(promise);
  assert.equal(native.isPromiseHandled(promise), false);
  assert.throws(() => native.getPromiseResult(promise), { code: 'ERR_PROMISE_PENDING' });
  f.run('reject(42)');
  assert.equal(native.getPromiseResult(promise), 42);
  assert.equal(native.isPromiseHandled(promise), false);
  f.queue.runMicrotasks();
  assert.deepEqual(f.events, [{ promise, operation: 'reject' }]);
  const proxy = new Proxy(promise, { get: poison, getPrototypeOf: poison });
  assert.throws(() => native.isPromiseHandled(proxy), { code: 'ERR_INVALID_ARG_TYPE' });
  assert.throws(() => native.getPromiseResult({ then() {} }), { code: 'ERR_INVALID_ARG_TYPE' });
  const value = {};
  assert.equal(native.getPromiseResult(Promise.resolve(value)), value);
});

test('notification selection follows the executing realm, not the promise creation realm', () => {
  const a = fixture();
  const b = fixture();
  const promise = a.run('Promise.reject(42)');
  b.realm.globalProxy.promise = promise;
  b.run('Promise.prototype.then.call(promise, undefined, () => {})');
  assert.deepEqual(a.events, [{ promise, operation: 'reject' }]);
  assert.deepEqual(b.events, [{ promise, operation: 'handle' }]);
  assert.equal(native.isPromiseHandled(promise), true);
  a.queue.runMicrotasks();
  b.queue.runMicrotasks();
});

test('independent queues remain under host control', () => {
  const a = fixture();
  const b = fixture();
  const ap = a.run('Promise.resolve().then(() => { throw "a"; })');
  const bp = b.run('Promise.resolve().then(() => { throw "b"; })');
  a.queue.runMicrotasks();
  assert.deepEqual(a.events, [{ promise: ap, operation: 'reject' }]);
  assert.deepEqual(b.events, []);
  b.queue.runMicrotasks();
  assert.deepEqual(b.events, [{ promise: bp, operation: 'reject' }]);
});

test('a host tracker can be replaced and invalid registration leaves it intact', () => {
  const f = fixture();
  const events = [];
  native.setPromiseRejectionTracker(f.realm, (promise, operation) => events.push({ promise, operation }));
  assert.throws(() => native.setPromiseRejectionTracker(f.realm, {}), { code: 'ERR_INVALID_ARG_TYPE' });
  const promise = f.run('Promise.reject(42)');
  assert.deepEqual(events, [{ promise, operation: 'reject' }]);
  assert.deepEqual(f.events, []);
});

test('reusing the global proxy does not transfer the old realm tracker', () => {
  const f = fixture();
  const rejectOld = f.run('() => Promise.reject(42)');
  f.realm.detachGlobal();
  const next = compat.createContextHandle({ microtaskQueue: f.queue, reuseGlobalProxyFrom: f.realm });
  const events = [];
  native.setPromiseRejectionTracker(next, (promise, operation) => events.push({ promise, operation }));
  const oldPromise = rejectOld();
  const nextPromise = compat.runInContext('Promise.reject(43)', next);
  assert.deepEqual(f.events, [{ promise: oldPromise, operation: 'reject' }]);
  assert.deepEqual(events, [{ promise: nextPromise, operation: 'reject' }]);
});

const childSetup = `
  const assert = require('node:assert/strict');
  const native = require(${JSON.stringify(require.resolve('../addon/index.cjs'))});
  const queue = native.createMicrotaskQueue();
  const realm = native.createContextHandle({ microtaskQueue: queue });
  const run = source => native.runInContext(source, realm, { filename: 'rejections.js' });
  const host = [];
  native.setPromiseRejectionTracker(realm, (p, op) => host.push({ p, op }));
`;

function child(source, args = []) {
  return spawnSync(process.execPath, [...args, '-e', childSetup + source], {
    env: process.env, encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
}

function childPass(source) {
  const result = child(source);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

test('Node and unrelated vm rejections retain unhandled and late-handled process events', () => {
  childPass(`
    const unhandled = [], handled = [];
    process.on('unhandledRejection', (reason, p) => unhandled.push({ reason, p }));
    process.on('rejectionHandled', p => handled.push(p));
    const p = Promise.reject('node');
    const v = require('node:vm').runInNewContext('Promise.reject("vm")');
    const h = run('Promise.reject("host")');
    setImmediate(() => {
      assert.deepEqual(unhandled, [{ reason: 'node', p }, { reason: 'vm', p: v }]);
      assert.deepEqual(host, [{ p: h, op: 'reject' }]);
      p.catch(() => {}); v.catch(() => {});
      setImmediate(() => assert.deepEqual(handled, [p, v]));
    });
  `);
});

test('Node rejection policy still terminates unhandled Node promises but not host promises', () => {
  childPass(`run('Promise.reject(new Error("host-only"))');`);
  const result = child('Promise.reject(new Error("node-still-fatal"));', ['--unhandled-rejections=strict']);
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /node-still-fatal/u);
});

test('cross-boundary handlers clear Node reporting and do not create Node events for host promises', () => {
  childPass(`
    const unhandled = [], handled = [];
    process.on('unhandledRejection', (reason, p) => unhandled.push(p));
    process.on('rejectionHandled', p => handled.push(p));
    const nodePromise = Promise.reject('node');
    const hostPromise = run('Promise.reject("host")');
    setImmediate(() => {
      assert.deepEqual(unhandled, [nodePromise]);
      realm.globalProxy.p = nodePromise;
      run('Promise.prototype.then.call(p, undefined, () => {})');
      Promise.prototype.then.call(hostPromise, undefined, () => {});
      queue.runMicrotasks();
      setImmediate(() => {
        assert.deepEqual(handled, [nodePromise]);
        assert.deepEqual(host, [{ p: hostPromise, op: 'reject' }, { p: nodePromise, op: 'handle' }]);
      });
    });
  `);
});

test('clearing a realm tracker restores Node reporting for later rejections', () => {
  childPass(`
    const reported = [];
    process.on('unhandledRejection', (reason, p) => reported.push({ reason, p }));
    const old = run('Promise.reject("old host")');
    native.setPromiseRejectionTracker(realm, undefined);
    realm.globalProxy.old = old;
    run('old.catch(() => {})');
    const p = run('Promise.reject("new node")');
    queue.runMicrotasks();
    setImmediate(() => {
      assert.deepEqual(reported, [{ reason: 'new node', p }]);
      assert.deepEqual(host, [{ p: old, op: 'reject' }]);
    });
  `);
});

test('tracker exceptions are reported as host failures without escaping through V8 notification code', () => {
  const result = child(`
    native.setPromiseRejectionTracker(realm, () => { throw new Error('tracker-failed'); });
    run('Promise.reject(42)');
  `);
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /tracker-failed/u);
});

test('unreachable contexts, tracker closures and rejected promises are collectable', async () => {
  function allocate() {
    const f = fixture();
    const record = { realm: f.realm, promises: [] };
    const tracker = (promise, operation) => { if (operation === 'reject') record.promises.push(promise); };
    native.setPromiseRejectionTracker(f.realm, tracker);
    const promise = f.run('Promise.reject(42)');
    return { realm: new WeakRef(f.realm), tracker: new WeakRef(tracker), promise: new WeakRef(promise) };
  }
  const refs = allocate();
  await nextTurn();
  await global.gc({ type: 'major', execution: 'async', flavor: 'last-resort' });
  await assertCollected(refs);
});

test('worker isolates install and clean up independent trackers', { timeout: 15000 }, async () => {
  const source = childSetup + `
    const p = run('Promise.reject(42)');
    assert.deepEqual(host, [{ p, op: 'reject' }]);
    const reported = [];
    process.on('unhandledRejection', reason => reported.push(reason));
    Promise.reject('worker node');
    setImmediate(() => assert.deepEqual(reported, ['worker node']));
  `;
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve, reject) => {
      const worker = new Worker(source, { eval: true });
      worker.once('error', reject);
      worker.once('exit', code => code === 0 ? resolve() : reject(new Error(`Worker exited ${code}`)));
    });
  }
});
