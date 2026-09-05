'use strict';

const assert = require('node:assert/strict');
const process = require('node:process');
const { test } = require('node:test');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { AsyncLocalStorage } = require('node:async_hooks');
const { Worker } = require('node:worker_threads');
const vm = require('node:vm');
const compat = require('../addon/index.cjs');

test('shared FIFO across realms, pending promises and host microtasks', () => {
  // Derived from Node commit a53496abb's shared-queue test. Window and
  // iframe reactions retain their distinct realm ownership.
  const queue = compat.createMicrotaskQueue();
  const window = compat.createContextHandle({ microtaskQueue: queue });
  const iframe = compat.createContextHandle({ microtaskQueue: queue });
  const trace = [];
  window.globalProxy.record = iframe.globalProxy.record = value => trace.push(value);
  compat.runInContext(`
    const pending = new Promise(resolve => { globalThis.resolve = resolve; });
    pending.then(() => {
      record('window');
      Promise.resolve().then(() => record('window follow-up'));
    });
  `, window);
  compat.runInContext(`
    const pending = new Promise(resolve => { globalThis.resolve = resolve; });
    pending.then(() => record('iframe'));
  `, iframe);
  window.globalProxy.resolveIframe = iframe.globalProxy.resolve;
  compat.runInContext('resolve(); resolveIframe();', window);
  queue.enqueueMicrotask(() => trace.push('host'));
  assert.deepEqual(trace, []);
  queue.runMicrotasks();
  assert.deepEqual(trace, ['window', 'iframe', 'host', 'window follow-up']);
});

test('separate queues and ambient Node work stay independent', async () => {
  const first = compat.createMicrotaskQueue();
  const second = compat.createMicrotaskQueue();
  const trace = [];
  first.enqueueMicrotask(() => trace.push('first'));
  second.enqueueMicrotask(() => trace.push('second'));
  process.nextTick(() => trace.push('tick'));
  Promise.resolve().then(() => trace.push('ambient'));
  first.runMicrotasks();
  assert.deepEqual(trace, ['first']);
  second.runMicrotasks();
  assert.deepEqual(trace, ['first', 'second']);
  await nextTurn();
  assert.equal(trace.includes('ambient'), true);
  assert.equal(trace.includes('tick'), true);
});

test('checkpoints work inside host microtasks and do not reenter themselves', async () => {
  await Promise.resolve();
  const queue = compat.createMicrotaskQueue();
  const trace = [];
  queue.enqueueMicrotask(() => {
    trace.push('first');
    queue.enqueueMicrotask(() => trace.push('second'));
    queue.runMicrotasks();
    trace.push('after nested checkpoint');
  });
  queue.runMicrotasks();
  assert.deepEqual(trace, ['first', 'after nested checkpoint', 'second']);
});

test('successive contexts reuse the proxy with fresh globals and intrinsics', () => {
  // Derived from Node commit ad6ce57a1's global-proxy reuse regression.
  const first = compat.createContextHandle();
  const proxy = first.globalProxy;
  const firstObject = compat.runInContext('Object', first);
  proxy.page = 'old';
  const oldClosure = compat.runInContext('const original = 42; () => original', first);
  assert.equal(compat.runInContext('globalThis', first), proxy);
  assert.throws(() => compat.createContextHandle({ reuseGlobalProxyFrom: first }),
    { code: 'ERR_INVALID_ARG_VALUE' });
  assert.equal(first.detachGlobal(), proxy);
  assert.equal(compat.isContext(first), false);
  assert.throws(() => compat.runInContext('1', first),
    { code: 'ERR_CONTEXT_NOT_INITIALIZED' });
  const second = compat.createContextHandle({ reuseGlobalProxyFrom: first });
  assert.equal(second.globalProxy, proxy);
  assert.equal(compat.runInContext('this', second), proxy);
  assert.equal(compat.runInContext('typeof page', second), 'undefined');
  assert.notEqual(compat.runInContext('Object', second), firstObject);
  assert.equal(oldClosure(), 42);
  assert.throws(() => compat.createContextHandle({ reuseGlobalProxyFrom: first }),
    { code: 'ERR_INVALID_ARG_VALUE' });
  assert.throws(() => first.detachGlobal(), { code: 'ERR_INVALID_STATE' });
  assert.equal(compat.isContext(second), true);
  assert.equal(compat.isContext(proxy), false);
  // Addon contexts are deliberately not passed off as Node Contextify objects.
  assert.equal(vm.isContext(second), false);

  // Retain the successive-reuse case from Node recovery checkpoint f0e5b199f.
  assert.equal(second.detachGlobal(), proxy);
  const third = compat.createContextHandle({ reuseGlobalProxyFrom: second });
  assert.equal(third.globalProxy, proxy);
  assert.equal(compat.runInContext('globalThis', third), proxy);
});

test('a live reused proxy does not retain the previous realm', async () => {
  // Adapted from 07301f053's GC regression; keep the replacement alive.
  function replace() {
    const first = compat.createContextHandle();
    const oldHandle = new WeakRef(first);
    const oldIntrinsic = new WeakRef(compat.runInContext('Object', first));
    first.detachGlobal();
    const second = compat.createContextHandle({ reuseGlobalProxyFrom: first });
    assert.equal(second.globalProxy, first.globalProxy);
    return { second, oldHandle, oldIntrinsic };
  }
  const { second, oldHandle, oldIntrinsic } = replace();
  for (let i = 0; i < 6; i++) { await nextTurn(); global.gc(); }
  assert.equal(oldHandle.deref(), undefined, 'previous context handle is collectible');
  assert.equal(oldIntrinsic.deref(), undefined, 'previous realm intrinsic is collectible');
  assert.equal(compat.runInContext('globalThis', second), second.globalProxy);
});

test('indirect eval uses the replacement realm dynamic-import callback', async () => {
  // Adapted from 07301f053's import regression. The promise invokes realm-owned
  // eval, which creates the importing script in that realm.
  const calls = [];
  const first = compat.createContextHandle({
    importModuleDynamically() {
      calls.push('realm 1');
      throw new Error('realm 1');
    },
  });
  const source = `Promise.resolve("import('specifier')").then(eval)`;
  await assert.rejects(compat.runInContext(source, first), /realm 1/);
  first.detachGlobal();
  const second = compat.createContextHandle({
    reuseGlobalProxyFrom: first,
    importModuleDynamically() {
      calls.push('realm 2');
      throw new Error('realm 2');
    },
  });
  assert.equal(second.globalProxy, first.globalProxy);
  await assert.rejects(compat.runInContext(source, second), /realm 2/);
  assert.deepEqual(calls, ['realm 1', 'realm 2']);
});

test('realm-owned errors carry evaluation filename and line offset', () => {
  const handle = compat.createContextHandle();
  try {
    compat.runInContext('throw new Error("probe")', handle,
      { filename: 'page.js', lineOffset: 10 });
    assert.fail('Expected an exception');
  } catch (caught) {
    assert.equal(caught instanceof handle.globalProxy.Error, true);
    assert.match(caught.stack, /page\.js:11:/);
  }
});

test('native handles reject forged receivers and unsupported VM options', () => {
  const queue = compat.createMicrotaskQueue();
  const handle = compat.createContextHandle();
  assert.equal(compat.isContext(Object.create(handle)), false);
  assert.throws(() => compat.runInContext('1', Object.create(handle)),
    { code: 'ERR_INVALID_ARG_TYPE' });
  assert.throws(() => queue.runMicrotasks.call(Object.create(queue)),
    { code: 'ERR_INVALID_ARG_TYPE' });
  assert.throws(() => compat.createContextHandle({ microtaskQueue: handle }),
    { code: 'ERR_INVALID_ARG_TYPE' });
  assert.throws(() => compat.runInContext('1', handle, { timeout: 1 }),
    /Unsupported.*timeout/);
});

test('reusing a global rejects a different allocation layout without consuming the handle', () => {
  assert.throws(() => compat.createContextHandle({ globalPrototypeChain: [] }),
    /must not be empty/);
  assert.throws(() => compat.createContextHandle({ globalPrototypeChain: ['unknown'] }),
    /Unknown prototype kind/);
  const first = compat.createContextHandle({ globalPrototypeChain: ['immutable'] });
  const proxy = first.detachGlobal();
  assert.throws(() => compat.createContextHandle({ reuseGlobalProxyFrom: first }),
    /same global prototype layout/);
  const second = compat.createContextHandle({
    reuseGlobalProxyFrom: first, globalPrototypeChain: ['immutable'],
  });
  assert.equal(second.globalProxy, proxy);
  assert.throws(() => compat.setGlobalObject(second, {}), /allocated global object/);
  assert.throws(() => compat.setPropertyDelegate({}, {}), /no property delegation support/);
});

test('allocated globals and their property delegates do not retain dead contexts', async () => {
  function allocate() {
    const queue = compat.createMicrotaskQueue();
    const handle = compat.createContextHandle({
      microtaskQueue: queue, globalPrototypeChain: ['immutable', 'delegated'],
    });
    Object.defineProperties(handle.globalObject, Object.getOwnPropertyDescriptors(handle.globalProxy));
    compat.setPropertyDelegate(handle.prototypeChain[1], {});
    compat.setGlobalObject(handle, handle.globalObject);
    return [handle, handle.globalObject, handle.prototypeChain[0], queue]
      .map(object => new WeakRef(object));
  }
  const references = allocate();
  for (let i = 0; i < 6; i++) { await nextTurn(); global.gc(); }
  assert.equal(references.every(reference => reference.deref() === undefined), true);
});

test('Promise hooks enabled after context creation still observe its jobs', () => {
  const { promiseHooks } = require('node:v8');
  const queue = compat.createMicrotaskQueue();
  const handle = compat.createContextHandle({ microtaskQueue: queue });
  let target;
  let observed = 0;
  const stop = promiseHooks.onBefore(promise => { if (promise === target) observed++; });
  try {
    target = compat.runInContext('Promise.resolve().then(() => 42)', handle);
    queue.runMicrotasks();
    assert.equal(observed, 1);
  } finally { stop(); }
});

test('Node ALS survives native realm Promise and thenable jobs', () => {
  const storage = new AsyncLocalStorage();
  const queue = compat.createMicrotaskQueue();
  const handle = compat.createContextHandle({ microtaskQueue: queue });
  const trace = [];
  handle.globalProxy.record = () => trace.push(storage.getStore());
  storage.run('registered', () => compat.runInContext(`
    Promise.resolve().then(() => record());
    Promise.resolve({ then(resolve) { record(); resolve(); } });
  `, handle));
  queue.runMicrotasks();
  assert.deepEqual(trace, ['registered', 'registered']);
  assert.equal(storage.getStore(), undefined);
});

test('retained Promise keeps its context handle and queue alive', async () => {
  // Preserves 1ce916938's lifetime regression without relying on afterEvaluate.
  let queue = compat.createMicrotaskQueue();
  let handle = compat.createContextHandle({ microtaskQueue: queue });
  const reference = new WeakRef(handle);
  const { promise, resolve } = compat.runInContext('Promise.withResolvers()', handle);
  handle.globalProxy.promise = promise;
  compat.runInContext('promise.then(value => { globalThis.answer = value; })', handle);
  handle = null;
  for (let i = 0; i < 3; i++) { await nextTurn(); global.gc(); }
  assert.notEqual(reference.deref(), undefined);
  resolve(42);
  queue.runMicrotasks();
  assert.equal(reference.deref().globalProxy.answer, 42);
  queue = null;
});

test('unreachable contexts and queue wrappers are collectible', async () => {
  function createReferences() {
    const queue = compat.createMicrotaskQueue();
    const handle = compat.createContextHandle({ microtaskQueue: queue });
    return [new WeakRef(handle), new WeakRef(queue)];
  }
  const references = createReferences();
  for (let i = 0; i < 6; i++) { await nextTurn(); global.gc(); }
  assert.equal(references[0].deref(), undefined);
  assert.equal(references[1].deref(), undefined);
});

test('independent worker initialization and environment cleanup', async () => {
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    const compat = require(${JSON.stringify(require.resolve('../addon/index.cjs'))});
    const queue = compat.createMicrotaskQueue();
    const context = compat.createContextHandle({ microtaskQueue: queue });
    context.globalProxy.report = value => parentPort.postMessage(value);
    compat.runInContext('Promise.resolve().then(() => report(42))', context);
    queue.runMicrotasks();
  `, { eval: true });
  const messages = [];
  worker.on('message', value => messages.push(value));
  await new Promise((resolve, reject) => {
    worker.on('error', reject);
    worker.on('exit', code => code === 0 ? resolve() : reject(new Error(`Exit ${code}`)));
  });
  assert.deepEqual(messages, [42]);
});
