'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const vm = require('node:vm');
const compat = require('../addon/index.cjs');
const { assertCollected } = require('./support/gc.cjs');

test('Script separates compilation from execution and can run in different contexts', () => {
  const first = compat.createContextHandle();
  const second = compat.createContextHandle();
  first.globalProxy.count = 0;
  second.globalProxy.count = 10;
  const script = new compat.Script('++count', { filename: 'retained.js' });
  assert.equal(first.globalProxy.count, 0);
  assert.equal(script.runInContext(first), 1);
  assert.equal(script.runInContext(second), 11);
  assert.throws(() => new compat.Script('let = ;'), SyntaxError);
  first.detachGlobal();
  assert.throws(() => script.runInContext(first), { code: 'ERR_CONTEXT_NOT_INITIALIZED' });
});

for (const backend of ['node', 'compat']) {
  test(`${backend}: module requests, linking, named synthetic exports and live bindings use the same API`, () => {
    const api = backend === 'node' ? vm : compat;
    const context = backend === 'node' ? vm.createContext({}) : compat.createContextHandle();
    let calls = 0;
    const value = {};
    const data = new api.SyntheticModule(['default', 'count'], function() {
      calls++;
      this.setExport('default', value);
      this.setExport('count', 1);
    }, { context, identifier: 'data' });
    const root = new api.SourceTextModule(
      'import value, { count } from "data" with { type: "json" }; export { value, count };',
      { context, identifier: 'root' },
    );
    assert.equal(root.context, context);
    assert.equal(root.identifier, 'root');
    assert.equal(root.status, 'unlinked');
    assert.equal(data.status, 'linked');
    assert.equal(data.namespace.default, undefined);
    assert.equal(root.moduleRequests[0].specifier, 'data');
    assert.equal(root.moduleRequests[0].attributes.type, 'json');
    assert.equal(root.moduleRequests[0].phase, 'evaluation');
    assert.equal(Object.isFrozen(root.moduleRequests), true);
    root.linkRequests([data]);
    assert.equal(root.status, 'unlinked');
    root.instantiate();
    assert.equal(root.status, 'linked');
    assert.equal(calls, 0);
    assert.equal(typeof root.evaluate().then, 'function');
    assert.equal(root.namespace.value, value);
    assert.equal(root.namespace.count, 1);
    assert.equal(calls, 1);
    data.setExport('count', 2);
    assert.equal(root.namespace.count, 2);
    root.evaluate();
    assert.equal(calls, 1);
    assert.throws(() => data.setExport('missing', 1), /export|Export/u);
  });
}

test('supplied cyclic modules instantiate together without running source', () => {
  const { context } = fixture();
  const first = new compat.SourceTextModule('import { read } from "b"; export let n = 1; export { read };', { context });
  const second = new compat.SourceTextModule('import { n } from "a"; export function read() { return n; }', { context });
  first.linkRequests([second]);
  second.linkRequests([first]);
  first.instantiate();
  assert.equal(first.status, 'linked');
  assert.equal(second.status, 'linked');
  first.evaluate();
  assert.equal(first.namespace.read(), 1);
});

test('evaluation preserves its engine Promise and leaves checkpoints under host control', () => {
  const { context, queue } = fixture();
  compat.runInContext('globalThis.gate = Promise.withResolvers()', context);
  const module = new compat.SourceTextModule('await gate.promise; export const result = {};', { context });
  module.linkRequests([]);
  module.instantiate();
  const promise = module.evaluate();
  assert.equal(Object.getPrototypeOf(promise), compat.runInContext('Promise.prototype', context));
  const result = observe(promise, context);
  queue.runMicrotasks();
  assert.equal(result.state, 'pending');
  compat.runInContext('gate.resolve()', context);
  assert.equal(result.state, 'pending');
  queue.runMicrotasks();
  assert.equal(result.state, 'fulfilled');
  assert.equal(Object.getPrototypeOf(module.namespace.result), compat.runInContext('Object.prototype', context));
});

test('synthetic evaluation exceptions become rejections and retain error identity', () => {
  const { context, queue } = fixture();
  const reason = {};
  const module = new compat.SyntheticModule([], () => { throw reason; }, { context });
  assert.throws(() => module.error, { code: 'ERR_VM_MODULE_STATUS' });
  const result = observe(module.evaluate(), context);
  queue.runMicrotasks();
  assert.deepEqual(result, { state: 'rejected', value: reason });
  assert.equal(module.status, 'errored');
  assert.equal(module.error, reason);
});

test('evaluation admission errors reject, including detached contexts', async () => {
  const { context } = fixture();
  const source = new compat.SourceTextModule('', { context });
  await assert.rejects(source.evaluate(), { code: 'ERR_VM_MODULE_STATUS' });
  const synthetic = new compat.SyntheticModule([], () => {}, { context });
  context.detachGlobal();
  await assert.rejects(synthetic.evaluate(), { code: 'ERR_CONTEXT_NOT_INITIALIZED' });
});

test('reentrant evaluation rejects without reaching an invalid V8 module state', () => {
  // Isolate a potential V8 assertion from the test runner itself.
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '-e', `
    const assert = require('node:assert/strict');
    const compat = require(process.argv[1]);
    const context = compat.createContextHandle();
    const module = new compat.SourceTextModule('reenter(); export const value = 42;', { context });
    let nested;
    context.globalProxy.reenter = () => { nested = module.evaluate(); };
    module.linkRequests([]);
    module.instantiate();
    module.evaluate();
    assert.equal(module.namespace.value, 42);
    assert.rejects(nested, { code: 'ERR_VM_MODULE_STATUS' }).catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
  `, require.resolve('../addon/index.cjs')], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
});

test('unsupported options and foreign dependencies fail explicitly', async () => {
  const { context } = fixture();
  assert.throws(() => new compat.Script('', { cachedData: Buffer.alloc(0) }), /Unsupported/u);
  assert.throws(() => new compat.SourceTextModule('', { context, importModuleDynamically() {} }), /Unsupported/u);
  assert.throws(() => new compat.SyntheticModule(['a', 'a'], () => {}, { context }), /unique/u);
  const root = new compat.SourceTextModule('import "other";', { context });
  const foreign = new compat.SyntheticModule([], () => {}, { context: fixture().context });
  assert.throws(() => root.linkRequests([foreign]), /same context/u);
  await assert.rejects(foreign.evaluate({ timeout: 1 }), /Unsupported/u);
});

test('module objects and synthetic callback cycles collect at every lifecycle stage', async () => {
  function allocate(stage) {
    const { context, queue } = fixture();
    const value = {};
    const synthetic = new compat.SyntheticModule(['default'], function() {
      this.setExport('default', value);
    }, { context });
    const source = new compat.SourceTextModule('export { default } from "data";', { context });
    value.source = source;
    value.synthetic = synthetic;
    source.linkRequests([synthetic]);
    if (stage !== 'created') source.instantiate();
    if (stage === 'evaluated') {
      source.evaluate();
      queue.runMicrotasks();
    }
    return { source: new WeakRef(source), synthetic: new WeakRef(synthetic), value: new WeakRef(value),
      context: new WeakRef(context), queue: new WeakRef(queue) };
  }
  for (const stage of ['created', 'linked', 'evaluated']) await assertCollected(allocate(stage));
});

test('evaluated graphs release synthetic callbacks and their module objects while exports remain live', async () => {
  const { context, queue } = fixture();
  function allocate() {
    const value = {};
    const callback = function() { this.setExport('default', value); };
    const dependency = new compat.SyntheticModule(['default'], callback, { context });
    const root = new compat.SourceTextModule('export { default } from "data";', { context });
    root.linkRequests([dependency]);
    root.instantiate();
    root.evaluate();
    queue.runMicrotasks();
    return { root, value, callback: new WeakRef(callback), dependency: new WeakRef(dependency) };
  }
  const { root, value, callback, dependency } = allocate();
  await assertCollected({ callback, dependency });
  assert.equal(root.namespace.default, value);
});

function fixture() {
  const queue = compat.createMicrotaskQueue();
  return { context: compat.createContextHandle({ microtaskQueue: queue }), queue };
}

function observe(promise, context) {
  const result = { state: 'pending' };
  const attach = compat.runInContext('(p, done) => p.then(v => done("fulfilled", v), e => done("rejected", e))', context);
  attach(promise, (state, value) => Object.assign(result, { state, value }));
  return result;
}
