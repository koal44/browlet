'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { Worker } = require('node:worker_threads');
const { assertCollected } = require('./support/gc.cjs');
const compat = require('../addon/index.cjs');
const native = require('./support/native-vm.cjs');
const compile = (source, realm, filename = 'retained.js', lineOffset = 0) =>
  native.compileScript(source, realm, filename, lineOffset);
const run = (script, realm) => native.runScript(script, realm);
const evaluate = (source, realm) => compat.runInContext(source, realm);

test('compile has no side effects and retained code runs repeatedly in the existing realm', () => {
  const realm = compat.createContextHandle();
  realm.globalProxy.count = 0;
  const script = compile('++count', realm);
  assert.equal(realm.globalProxy.count, 0);
  assert.equal(run(script, realm), 1);
  assert.equal(run(script, realm), 2);
  assert.equal(realm.globalProxy.count, 2);
});

test('one unbound script can execute against different realm globals', () => {
  const first = compat.createContextHandle();
  const second = compat.createContextHandle();
  first.globalProxy.name = 'first';
  second.globalProxy.name = 'second';
  const script = compile('({ name, global: globalThis })', first);
  const a = run(script, first);
  const b = run(script, second);
  assert.equal(a.name, 'first');
  assert.equal(b.name, 'second');
  assert.equal(a.global, first.globalProxy);
  assert.equal(b.global, second.globalProxy);
  assert.equal(Object.getPrototypeOf(a), evaluate('Object.prototype', first));
  assert.equal(Object.getPrototypeOf(b), evaluate('Object.prototype', second));
});

test('script lexical declarations persist in the realm', () => {
  const realm = compat.createContextHandle();
  const script = compile('let retainedValue = 40; retainedValue + 2', realm);
  assert.equal(run(script, realm), 42);
  assert.equal(evaluate('retainedValue', realm), 40);
  assert.throws(() => run(script, realm), error =>
    Object.getPrototypeOf(error) === evaluate('SyntaxError.prototype', realm));
});

test('syntax failures belong to the compilation realm and do not execute source', () => {
  const realm = compat.createContextHandle();
  realm.globalProxy.touched = false;
  assert.throws(() => compile('touched = true; let = ;', realm), error =>
    Object.getPrototypeOf(error) === evaluate('SyntaxError.prototype', realm));
  assert.equal(realm.globalProxy.touched, false);
});

test('execution preserves thrown identity, error realm, and source location', () => {
  const realm = compat.createContextHandle();
  const sentinel = {};
  realm.globalProxy.sentinel = sentinel;
  assert.throws(() => run(compile('throw sentinel', realm), realm), error => error === sentinel);
  const failure = compile('throw new Error("retained failure")', realm, 'retained-origin.js', 6);
  assert.throws(() => run(failure, realm), error => {
    assert.equal(Object.getPrototypeOf(error), evaluate('Error.prototype', realm));
    assert.match(error.stack, /retained-origin\.js:7:/u);
    return true;
  });
  assert.equal(run(compile('21 * 2', realm), realm), 42);
});

test('retained execution leaves each explicit microtask queue under host control', () => {
  const queue = compat.createMicrotaskQueue();
  const otherQueue = compat.createMicrotaskQueue();
  const realm = compat.createContextHandle({ microtaskQueue: queue });
  const other = compat.createContextHandle({ microtaskQueue: otherQueue });
  const trace = [];
  realm.globalProxy.record = value => trace.push(value);
  other.globalProxy.record = value => trace.push(`other:${value}`);
  const script = compile('Promise.resolve().then(() => record(1)).then(() => record(2)); 42', realm);
  assert.equal(run(script, realm), 42);
  assert.equal(run(script, other), 42);
  assert.deepEqual(trace, []);
  queue.runMicrotasks();
  assert.deepEqual(trace, [1, 2]);
  otherQueue.runMicrotasks();
  assert.deepEqual(trace, [1, 2, 'other:1', 'other:2']);
});

test('nested execution restores the outer realm', () => {
  const outer = compat.createContextHandle();
  const inner = compat.createContextHandle();
  const nested = compile('({ global: globalThis })', inner);
  outer.globalProxy.nested = () => run(nested, inner);
  const result = run(compile('({ nested: nested(), global: globalThis })', outer), outer);
  assert.equal(result.nested.global, inner.globalProxy);
  assert.equal(result.global, outer.globalProxy);
  assert.equal(vm.runInThisContext('globalThis'), globalThis);
});

test('foreign script objects, forged handles, and detached contexts fail explicitly', () => {
  const realm = compat.createContextHandle();
  const script = compile('42', realm);
  for (const invalid of [undefined, {}, new vm.Script('42'), Object.create(script), new Proxy(script, {})]) {
    assert.throws(() => run(invalid, realm), { code: 'ERR_INVALID_ARG_TYPE' });
  }
  assert.throws(() => run(script, {}), { code: 'ERR_INVALID_ARG_TYPE' });
  assert.throws(() => compile(42, realm), { code: 'ERR_INVALID_ARG_TYPE' });
  realm.detachGlobal();
  assert.throws(() => run(script, realm), { code: 'ERR_CONTEXT_NOT_INITIALIZED' });
});

test('a retained unbound script does not retain its compilation realm', async () => {
  function allocate() {
    const realm = compat.createContextHandle({ microtaskQueue: compat.createMicrotaskQueue() });
    const script = compile('({ answer: 42 })', realm);
    return { script, references: { realm: new WeakRef(realm), global: new WeakRef(realm.globalProxy) } };
  }
  const { script, references } = allocate();
  await assertCollected(references);
  const replacement = compat.createContextHandle();
  assert.equal(run(script, replacement).answer, 42);
});

test('a function returned by execution survives collection of the script handle', async () => {
  const realm = compat.createContextHandle();
  realm.globalProxy.answer = 42;
  function allocate() {
    const script = compile('(function () { return answer; })', realm);
    return { callable: run(script, realm), reference: new WeakRef(script) };
  }
  const { callable, reference } = allocate();
  await assertCollected({ script: reference });
  assert.equal(callable(), 42);
});

test('ordinary Node VM execution and disabled eval policy remain intact', () => {
  const context = vm.createContext({}, { codeGeneration: { strings: false } });
  assert.equal(new vm.Script('21 * 2').runInContext(context), 42);
  assert.throws(() => vm.runInContext('eval("42")', context), /Code generation from strings disallowed/u);
});

test('workers release live and collected script handles during teardown', { timeout: 15000 }, async () => {
  const source = `
    const compat = require(require('node:worker_threads').workerData);
    const realm = compat.createContextHandle();
    for (let i = 0; i < 100; i++) {
      const script = new compat.Script('({ answer: 42 })', { filename: 'worker.js' });
      if (script.runInContext(realm).answer !== 42) throw new Error('Wrong result');
    }
    global.gc();
    globalThis.retained = new compat.Script('42', { filename: 'live.js' });
  `;
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve, reject) => {
      const worker = new Worker(source, { eval: true, workerData: require.resolve('../addon/index.cjs') });
      worker.once('error', reject);
      worker.once('exit', code => code === 0 ? resolve() : reject(new Error(`Worker exited ${code}`)));
    });
  }
});
