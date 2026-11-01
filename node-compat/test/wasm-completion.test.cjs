'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { Worker } = require('node:worker_threads');
const compat = require('../addon/index.cjs');
const { assertCollected } = require('./support/gc.cjs');

for (const valid of [true, false]) {
  test(`Wasm ${valid ? 'success' : 'failure'} waits for the owning host and its checkpoint`, { timeout: 5000 }, async () => {
    const queue = compat.createMicrotaskQueue();
    const context = compat.createContextHandle({ microtaskQueue: queue });
    const scheduled = Promise.withResolvers();
    compat.setWasmAsyncCompletionCallback(context, scheduled.resolve);
    const promise = compat.runInContext(`WebAssembly.compile(new Uint8Array(${valid ? emptyModule : '[0]'}))`, context);
    const outcomes = [];
    compat.observePromise(promise, context.globalProxy.Promise,
      value => outcomes.push({ value }), error => outcomes.push({ error }));

    const complete = await scheduled.promise;
    queue.runMicrotasks();
    assert.deepEqual(outcomes, []);
    complete();
    complete();
    assert.deepEqual(outcomes, []);
    queue.runMicrotasks();
    assert.equal(outcomes.length, 1);
    if (valid) assert.ok(outcomes[0].value instanceof context.globalProxy.WebAssembly.Module);
    else assert.ok(outcomes[0].error instanceof context.globalProxy.WebAssembly.CompileError);
  });
}

test('module then lookup waits for completion and assimilation uses the original queue', { timeout: 5000 }, async () => {
  const queue = compat.createMicrotaskQueue();
  const context = compat.createContextHandle({ microtaskQueue: queue });
  const scheduled = Promise.withResolvers();
  const trace = [];
  context.globalProxy.record = value => trace.push(value);
  compat.setWasmAsyncCompletionCallback(context, scheduled.resolve);
  const promise = compat.runInContext(`
    Object.defineProperty(WebAssembly.Module.prototype, 'then', {
      get() { record('get'); return resolve => { record('call'); resolve(5); }; }
    });
    WebAssembly.compile(new Uint8Array(${emptyModule}));
  `, context);
  compat.observePromise(promise, context.globalProxy.Promise, value => trace.push(value));

  const complete = await scheduled.promise;
  assert.deepEqual(trace, []);
  complete();
  complete();
  assert.deepEqual(trace, ['get']);
  queue.runMicrotasks();
  assert.deepEqual(trace, ['get', 'call', 5]);
});

test('independent contexts select their own completion scheduler', { timeout: 5000 }, async () => {
  const first = compat.createContextHandle();
  const second = compat.createContextHandle();
  const a = Promise.withResolvers();
  const b = Promise.withResolvers();
  compat.setWasmAsyncCompletionCallback(first, a.resolve);
  compat.setWasmAsyncCompletionCallback(second, b.resolve);
  const pa = compat.runInContext(`WebAssembly.compile(new Uint8Array(${emptyModule}))`, first);
  const pb = compat.runInContext(`WebAssembly.compile(new Uint8Array(${emptyModule}))`, second);
  const [completeA, completeB] = await Promise.all([a.promise, b.promise]);
  completeB();
  assert.ok(await pb instanceof second.globalProxy.WebAssembly.Module);
  completeA();
  assert.ok(await pa instanceof first.globalProxy.WebAssembly.Module);
});

test('ordinary Node, vm, and unregistered addon contexts retain native completion', { timeout: 5000 }, async () => {
  const context = compat.createContextHandle();
  compat.setWasmAsyncCompletionCallback(context, () => assert.fail('removed callback ran'));
  assert.throws(() => compat.setWasmAsyncCompletionCallback(context, {}), TypeError);
  compat.setWasmAsyncCompletionCallback(context, undefined);
  assert.ok(await WebAssembly.compile(new Uint8Array(JSON.parse(emptyModule))) instanceof WebAssembly.Module);
  await assert.rejects(WebAssembly.compile(new Uint8Array([0])), WebAssembly.CompileError);
  const other = vm.createContext({});
  const module = await vm.runInContext(`WebAssembly.compile(new Uint8Array(${emptyModule}))`, other);
  assert.ok(module instanceof vm.runInContext('WebAssembly.Module', other));
  assert.ok(await compat.runInContext(`WebAssembly.compile(new Uint8Array(${emptyModule}))`, context)
    instanceof context.globalProxy.WebAssembly.Module);
});

test('a retained completion does not resolve through a detached or replacement global', { timeout: 5000 }, async () => {
  const queue = compat.createMicrotaskQueue();
  const context = compat.createContextHandle({ microtaskQueue: queue });
  const scheduled = Promise.withResolvers();
  let getterCalls = 0;
  context.globalProxy.record = () => { getterCalls++; };
  compat.setWasmAsyncCompletionCallback(context, scheduled.resolve);
  compat.runInContext(`
    Object.defineProperty(WebAssembly.Module.prototype, 'then', { get() { record(); } });
    WebAssembly.compile(new Uint8Array(${emptyModule}));
  `, context);
  const complete = await scheduled.promise;
  const proxy = context.detachGlobal();
  const replacement = compat.createContextHandle({ microtaskQueue: queue, reuseGlobalProxyFrom: context });
  assert.equal(replacement.globalProxy, proxy);
  replacement.globalProxy.record = () => assert.fail('replacement received old completion');
  complete();
  queue.runMicrotasks();
  assert.equal(getterCalls, 0);
});

test('discarded pending completions and their contexts are collectable', { timeout: 15000 }, async () => {
  async function allocate() {
    const context = compat.createContextHandle({ microtaskQueue: compat.createMicrotaskQueue() });
    const scheduled = Promise.withResolvers();
    const callback = complete => scheduled.resolve(complete);
    compat.setWasmAsyncCompletionCallback(context, callback);
    const promise = compat.runInContext(`WebAssembly.compile(new Uint8Array(${emptyModule}))`, context);
    const complete = await scheduled.promise;
    return { context: new WeakRef(context), callback: new WeakRef(callback),
      promise: new WeakRef(promise), complete: new WeakRef(complete) };
  }
  await assertCollected(await allocate());
});

test('worker isolates can install and tear down completion hooks', { timeout: 15000 }, async () => {
  for (let i = 0; i < 2; i++) {
    await new Promise((resolve, reject) => {
      const worker = new Worker(`
        const compat = require(${JSON.stringify(require.resolve('../addon/index.cjs'))});
        const queue = compat.createMicrotaskQueue();
        const context = compat.createContextHandle({ microtaskQueue: queue });
        let completed = false;
        process.on('beforeExit', () => require('node:assert/strict').ok(completed));
        compat.setWasmAsyncCompletionCallback(context, complete => {
          setImmediate(() => { complete(); queue.runMicrotasks(); });
        });
        const promise = compat.runInContext('WebAssembly.compile(new Uint8Array(${emptyModule}))', context);
        compat.observePromise(promise, context.globalProxy.Promise, value => {
          require('node:assert/strict').ok(value instanceof context.globalProxy.WebAssembly.Module);
          completed = true;
        });
      `, { eval: true });
      worker.once('error', reject);
      worker.once('exit', code => code === 0 ? resolve() : reject(new Error(`Worker exited ${code}`)));
    });
  }
});

const emptyModule = '[0,97,115,109,1,0,0,0]';
