'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { Worker } = require('node:worker_threads');
const vm = require('node:vm');
const { assertCollected } = require('./support/gc.cjs');
const { itPassesWith } = require('./support/test-runtime.cjs');
const compat = require('../addon/index.cjs');
const testMeta = itPassesWith('importMeta');

test('modules without an initializer expose an empty, stable import.meta', () => {
  const f = fixture();
  const module = moduleFor(f);
  evaluate(f, module);
  const meta = module.namespace.readMeta();
  assert.equal(Object.getPrototypeOf(meta), null);
  assert.deepEqual(Reflect.ownKeys(meta), []);
  assert.equal(module.namespace.readMeta(), meta);
});

test('initializeImportMeta rejects non-functions before compilation', () => {
  const f = fixture();
  for (const initializeImportMeta of [null, false, 0, 'callback', {}]) {
    assert.throws(() => new compat.SourceTextModule('invalid syntax!', {
      context: f.context, initializeImportMeta,
    }), { name: 'TypeError', message: 'Expected initializeImportMeta to be a function' });
  }
});

testMeta('initialization is lazy, receives Node callback arguments, and does not checkpoint', () => {
  const f = fixture();
  const other = fixture();
  let calls = 0, reactions = 0;
  const module = moduleFor(f, {
    initializeImportMeta(meta, referrer) {
      assert.equal(this, undefined);
      assert.equal(arguments.length, 2);
      assert.equal(referrer, module);
      calls++;
      meta.value = 42;
      f.queue.enqueueMicrotask(() => { reactions++; });
      return { get then() { throw new Error('The return value must be ignored'); } };
    },
  });
  assert.equal(calls, 0);
  evaluate(f, module);
  assert.equal(calls, 0);
  const readFromOtherRealm = compat.runInContext('read => read()', other.context);
  const meta = readFromOtherRealm(module.namespace.readMeta);
  assert.equal(meta.value, 42);
  assert.equal(Object.getPrototypeOf(meta), null);
  assert.equal(module.namespace.readMeta(), meta);
  assert.equal(calls, 1);
  assert.equal(reactions, 0);
  other.queue.runMicrotasks();
  assert.equal(reactions, 0);
  f.queue.runMicrotasks();
  assert.equal(reactions, 1);
});

testMeta('instantiating a cyclic graph registers every module initializer independently', () => {
  const f = fixture();
  const calls = [];
  const initializeImportMeta = (meta, module) => { calls.push(module); meta.module = module; };
  const a = new compat.SourceTextModule('import { readB } from "b"; export { readB }; export function readA() { return import.meta; }', {
    context: f.context, identifier: 'same.js', initializeImportMeta,
  });
  const b = new compat.SourceTextModule('import { readA } from "a"; export function readB() { return import.meta; }', {
    context: f.context, identifier: 'same.js', initializeImportMeta,
  });
  a.linkRequests([b]);
  b.linkRequests([a]);
  a.instantiate();
  evaluate(f, a);
  assert.deepEqual(calls, []);
  assert.equal(a.namespace.readA().module, a);
  assert.equal(a.namespace.readB().module, b);
  assert.deepEqual(calls, [a, b]);
});

testMeta('initializers keep their function realm when metadata is accessed elsewhere', () => {
  const f = fixture();
  const other = fixture();
  const initializeImportMeta = compat.runInContext('(meta, module) => { meta.array = []; meta.module = module; }', other.context);
  const module = moduleFor(f, { initializeImportMeta });
  evaluate(f, module);
  const meta = module.namespace.readMeta();
  assert.equal(Object.getPrototypeOf(meta.array), other.context.globalProxy.Array.prototype);
  assert.equal(meta.module, module);
});

testMeta('initializer failures preserve identity and retry with a fresh object', () => {
  const f = fixture();
  const sentinel = {};
  let calls = 0, failedMeta;
  const module = moduleFor(f, {
    initializeImportMeta(meta) {
      if (++calls === 1) { failedMeta = meta; throw sentinel; }
      meta.value = 42;
    },
  });
  evaluate(f, module);
  assert.throws(module.namespace.readMeta, error => error === sentinel);
  const meta = module.namespace.readMeta();
  assert.notEqual(meta, failedMeta);
  assert.equal(meta.value, 42);
  assert.equal(calls, 2);
  assert.equal(module.namespace.readMeta(), meta);

  const failure = moduleFor(f, { initializeImportMeta() { throw sentinel; } }, 'export const meta = import.meta;');
  const result = observe(f, failure.evaluate());
  f.queue.runMicrotasks();
  assert.equal(result.error, sentinel);
  assert.equal(failure.status, 'errored');
  assert.equal(failure.error, sentinel);
});

test('ordinary Node file/data metadata and VM initializers keep working', async () => {
  const url = 'data:text/javascript,export default import.meta;';
  const { default: meta } = await import(url);
  assert.equal(meta.url, url);
  assert.equal(meta.resolve('node:fs'), 'node:fs');
  const file = join(__dirname, 'support/import-meta.fixture.mjs');
  const { default: fileMeta } = await import(pathToFileURL(file).href);
  assert.equal(fileMeta.url, pathToFileURL(file).href);
  assert.equal(fileMeta.filename, file);
  assert.equal(fileMeta.dirname, join(__dirname, 'support'));
  assert.equal(fileMeta.resolve('./dependency.js'), new URL('./dependency.js', fileMeta.url).href);

  let calls = 0;
  const module = new vm.SourceTextModule('export const meta = import.meta;', {
    initializeImportMeta(value, referrer) {
      assert.equal(referrer, module);
      calls++;
      value.marker = 42;
    },
  });
  await module.link(() => assert.fail('Unexpected import'));
  await module.evaluate();
  assert.equal(module.namespace.meta.marker, 42);
  assert.equal(calls, 1);
});

test('forwarding preserves values thrown by Node VM initializers', async () => {
  const sentinel = {};
  const module = new vm.SourceTextModule('export const meta = import.meta;', {
    initializeImportMeta() { throw sentinel; },
  });
  await module.link(() => assert.fail('Unexpected import'));
  await assert.rejects(module.evaluate(), error => error === sentinel);
});

testMeta('an addon initializer can enter Node and forward a nested metadata request', async () => {
  const control = new vm.SourceTextModule('export const meta = import.meta;', {
    initializeImportMeta(meta) { meta.marker = 42; },
  });
  await control.link(() => assert.fail('Unexpected import'));
  const f = fixture();
  let completion;
  const module = moduleFor(f, {
    initializeImportMeta(meta) {
      completion = control.evaluate();
      meta.nested = control.namespace.meta;
    },
  }, 'export const meta = import.meta;');
  evaluate(f, module);
  assert.equal(module.namespace.meta.nested.marker, 42);
  await completion;
});

itPassesWith('importMeta', 'dynamicImport')('import.meta and dynamic import retain independent callbacks on the same module', () => {
  const f = fixture();
  const target = new compat.SyntheticModule(['value'], function() { this.setExport('value', 42); }, { context: f.context });
  evaluate(f, target);
  const module = moduleFor(f, {
    initializeImportMeta(meta, referrer) { assert.equal(referrer, module); meta.name = 'value'; },
    importModuleDynamically(name, referrer) {
      assert.equal(referrer, module);
      assert.equal(name, 'value');
      return target;
    },
  }, 'export const loaded = import(import.meta.name);');
  evaluate(f, module);
  const result = observe(f, module.namespace.loaded);
  f.queue.runMicrotasks();
  assert.equal(result.value, target.namespace);
  assert.equal(result.value.value, 42);
});

testMeta('an exported function retains its initializer and public module referrer', async () => {
  function allocate() {
    const f = fixture();
    const record = { marker: 42 };
    const module = moduleFor(f, { initializeImportMeta: initializerFor(record) });
    evaluate(f, module);
    return { readMeta: module.namespace.readMeta, module: new WeakRef(module), record: new WeakRef(record) };
  }
  const retained = allocate();
  await nextTurn();
  await global.gc({ type: 'major', execution: 'async', flavor: 'last-resort' });
  assert.ok(retained.module.deref(), 'The callback contract retains its public module referrer');
  assert.ok(retained.record.deref());
  const meta = retained.readMeta();
  assert.equal(meta.module, retained.module.deref());
  assert.equal(meta.record, retained.record.deref());
  assert.equal(meta.record.marker, 42);
});

testMeta('discarded initializer cycles release their modules and contexts at every stage', async () => {
  function allocate(stage) {
    const f = fixture();
    const record = { f };
    const initializeImportMeta = initializerFor(record);
    const module = new compat.SourceTextModule('export function readMeta() { return import.meta; }', {
      context: f.context, initializeImportMeta,
    });
    record.module = module;
    if (stage > 0) { module.linkRequests([]); module.instantiate(); }
    if (stage > 1) evaluate(f, module);
    if (stage > 2) module.namespace.readMeta();
    return { module: new WeakRef(module), context: new WeakRef(f.context), global: new WeakRef(f.context.globalProxy),
      record: new WeakRef(record), initializer: new WeakRef(initializeImportMeta) };
  }
  for (let stage = 0; stage < 4; stage++) await assertCollected(allocate(stage));
});

testMeta('worker teardown preserves Node metadata and addon routing', { timeout: 15000 }, async testContext => {
  const source = `
    const { workerData, parentPort } = require('node:worker_threads');
    const compat = require(workerData);
    const queue = compat.createMicrotaskQueue();
    const context = compat.createContextHandle({ microtaskQueue: queue });
    function read(value) {
      const module = new compat.SourceTextModule('export const value = import.meta.value;', {
        context, initializeImportMeta(meta) { meta.value = value; }
      });
      module.linkRequests([]);
      module.instantiate();
      module.evaluate();
      queue.runMicrotasks();
      if (module.namespace.value !== value) throw new Error('Wrong metadata');
      return module;
    }
    for (let i = 0; i < 20; i++) read(i);
    global.gc();
    import('data:text/javascript,export default import.meta').then(({ default: meta }) => {
      if (meta.url !== 'data:text/javascript,export default import.meta' || typeof meta.resolve !== 'function') {
        throw new Error('Node metadata was not preserved');
      }
      globalThis.retained = read(context);
      parentPort.postMessage(42);
    });
  `;
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve, reject) => {
      const worker = new Worker(source, { eval: true, workerData: require.resolve('../addon/index.cjs') });
      testContext.after(() => worker.terminate());
      let value;
      worker.once('message', message => { value = message; });
      worker.once('error', reject);
      worker.once('exit', code => code === 0 && value === 42 ? resolve() : reject(new Error(`Worker exited ${code} with value ${value}`)));
    });
  }
});

function fixture() {
  const queue = compat.createMicrotaskQueue();
  return { queue, context: compat.createContextHandle({ microtaskQueue: queue }) };
}

function moduleFor(f, options = {}, source = 'export function readMeta() { return import.meta; }') {
  const module = new compat.SourceTextModule(source, { context: f.context, ...options });
  module.linkRequests([]);
  module.instantiate();
  return module;
}

function observe(f, promise) {
  const result = { settled: false };
  compat.runInContext('(promise, result) => promise.then(value => { result.settled = true; result.value = value; }, error => { result.settled = true; result.error = error; })', f.context)(promise, result);
  return result;
}

function evaluate(f, module) {
  const result = observe(f, module.evaluate());
  f.queue.runMicrotasks();
  assert.deepEqual(result, { settled: true, value: undefined });
}

function initializerFor(record) {
  return (meta, module) => { meta.record = record; meta.module = module; };
}
