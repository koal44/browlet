'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { types } = require('node:util');
const vm = require('node:vm');
const { Worker } = require('node:worker_threads');
const { assertCollected } = require('./support/gc.cjs');
const native = require('./support/native-vm.cjs');
const compat = require('../addon/index.cjs');
const compile = (source, realm, filename = 'module.js', offset = 0) =>
  native.compileModule(source, realm, filename, offset);
const evaluate = (source, realm) => compat.runInContext(source, realm);
const link = (root, entries = []) => native.linkModule(root, new Map(entries));

function fixture() {
  const queue = compat.createMicrotaskQueue();
  return { queue, realm: compat.createContextHandle({ microtaskQueue: queue }) };
}

function observe(promise, realm) {
  const result = { state: 'pending' };
  const attach = evaluate('(promise, done) => promise.then(' +
    'value => done("fulfilled", value), reason => done("rejected", reason))', realm);
  attach(promise, (state, value) => Object.assign(result, { state, value }));
  return result;
}

test('compile and inspect expose import requests without executing source', () => {
  const { realm } = fixture();
  realm.globalProxy.touched = false;
  const root = compile([
    'import value from "./data" with { type: "json" };',
    'export { named } from "./dependency";',
    'touched = true;',
    'export default value;',
  ].join('\n'), realm);
  assert.equal(realm.globalProxy.touched, false);
  assert.deepEqual(native.moduleRequests(root), [
    { specifier: './data', attributes: [{ key: 'type', value: 'json' }], phase: 'evaluation' },
    { specifier: './dependency', attributes: [], phase: 'evaluation' },
  ]);
  const requests = native.moduleRequests(root);
  requests[0].specifier = 'changed';
  requests[0].attributes[0].value = 'changed';
  assert.equal(native.moduleRequests(root)[0].specifier, './data');
  assert.equal(native.moduleRequests(root)[0].attributes[0].value, 'json');
});

test('source-phase requests require supplied Wasm sources, not evaluation handles', () => {
  const { realm } = fixture();
  const root = compile('import source item from "./item.wasm";', realm);
  assert.deepEqual(native.moduleRequests(root), [
    { specifier: './item.wasm', attributes: [], phase: 'source' },
  ]);
  assert.throws(() => link(root), { code: 'ERR_MODULE_DEPENDENCY_MISSING' });
  const ordinaryModule = compile('', realm);
  assert.throws(() => link(root, [[root, [ordinaryModule]]]), { code: 'ERR_INVALID_ARG_TYPE' });
});

test('supplied dependencies distinguish import attributes on the same specifier', () => {
  const { realm, queue } = fixture();
  const root = compile([
    'import a from "./same" with { type: "json" };',
    'import b from "./same" with { type: "text" };',
    'export const result = [a, b];',
  ].join('\n'), realm);
  // The host determines the module type; these source modules isolate linking.
  const a = compile('export default 10', realm);
  const b = compile('export default 20', realm);
  link(root, [[root, [a, b]]]);
  const result = observe(native.evaluateModule(root), realm);
  queue.runMicrotasks();
  assert.equal(result.state, 'fulfilled');
  assert.deepEqual(Array.from(native.moduleNamespace(root).result), [10, 20]);
});

test('a synthetic default export is assigned during evaluation without inspecting its value', () => {
  const { realm, queue } = fixture();
  const value = new Proxy({}, {
    get() { assert.fail('The export must not be read or assimilated as a thenable'); },
    ownKeys() { assert.fail('The export must not be serialized'); },
    getPrototypeOf() { assert.fail('The export must not be rewrapped'); },
  });
  const module = native.createDefaultExportModule(value, realm);
  assert.deepEqual(native.moduleRequests(module), []);
  assert.throws(() => native.moduleNamespace(module), { code: 'ERR_MODULE_NOT_LINKED' });
  assert.throws(() => native.evaluateModule(module), { code: 'ERR_MODULE_NOT_LINKED' });
  link(module);
  const namespace = native.moduleNamespace(module);
  assert.equal(namespace.default, undefined);
  assert.deepEqual(Reflect.ownKeys(namespace), ['default', Symbol.toStringTag]);
  assert.equal(Object.isExtensible(namespace), false);
  const promise = native.evaluateModule(module);
  assert.equal(Object.getPrototypeOf(promise), evaluate('Promise.prototype', realm));
  const result = observe(promise, realm);
  assert.equal(namespace.default, value);
  assert.equal(result.state, 'pending');
  queue.runMicrotasks();
  assert.deepEqual(result, { state: 'fulfilled', value: undefined });
  link(module);
  native.evaluateModule(module);
  assert.equal(namespace.default, value);
});

test('ordinary source modules import supplied JSON and text values through synthetic dependencies', () => {
  const { realm, queue } = fixture();
  const value = evaluate('JSON.parse(\'{"answer":42}\')', realm);
  const data = native.createDefaultExportModule(value, realm);
  const text = native.createDefaultExportModule('body { color: green; }', realm);
  const root = compile([
    'import data from "./resource" with { type: "json" };',
    'import text from "./resource" with { type: "text" };',
    'await 0;',
    'data.answer++;',
    'export { data, text };',
  ].join('\n'), realm);
  link(root, [[root, [data, text]]]);
  assert.equal(native.moduleNamespace(data).default, undefined);
  const result = observe(native.evaluateModule(root), realm);
  assert.equal(value.answer, 42);
  queue.runMicrotasks();
  assert.equal(result.state, 'fulfilled');
  assert.equal(native.moduleNamespace(root).data, value);
  assert.equal(value.answer, 43);
  assert.equal(native.moduleNamespace(root).text, 'body { color: green; }');
});

test('synthetic exports preserve primitive, object, function, and Promise identity', () => {
  const { realm, queue } = fixture();
  const values = [undefined, null, false, 0, -0, NaN, 42n, 'text', Symbol('value'),
    Object.freeze({ answer: 42 }), evaluate('(value => value)', realm),
    evaluate('new Promise(() => {})', realm)];
  for (const value of values) {
    const module = native.createDefaultExportModule(value, realm);
    link(module);
    const result = observe(native.evaluateModule(module), realm);
    queue.runMicrotasks();
    assert.deepEqual(result, { state: 'fulfilled', value: undefined });
    assert.equal(native.moduleNamespace(module).default, value);
  }
});

test('synthetic dependencies survive failed linking and can be shared by multiple imports', () => {
  const { realm, queue } = fixture();
  const value = { answer: 42 };
  const dependency = native.createDefaultExportModule(value, realm);
  const invalid = compile('import { absent } from "data";', realm);
  assert.throws(() => link(invalid, [[invalid, [dependency]]]), error => {
    assert.equal(Object.getPrototypeOf(error), evaluate('SyntaxError.prototype', realm));
    assert.match(error.message, /absent/u);
    return true;
  });
  assert.equal(native.moduleNamespace(dependency).default, undefined);
  const root = compile([
    'import a from "first";',
    'import b from "second";',
    'export { a, b };',
  ].join('\n'), realm);
  link(root, [[root, [dependency, dependency]], [dependency, []]]);
  const result = observe(native.evaluateModule(root), realm);
  queue.runMicrotasks();
  assert.equal(result.state, 'fulfilled');
  assert.equal(native.moduleNamespace(root).a, value);
  assert.equal(native.moduleNamespace(root).b, value);
});

test('synthetic modules validate their context and keep completion on its queue', () => {
  const { realm, queue } = fixture();
  const other = fixture();
  const module = native.createDefaultExportModule(42, realm);
  const separate = native.createDefaultExportModule(43, other.realm);
  const root = compile('import value from "foreign";', realm);
  assert.throws(() => link(root, [[root, [separate]]]), { code: 'ERR_MODULE_CONTEXT_MISMATCH' });
  for (const invalid of [undefined, {}, Object.create(realm), new Proxy(realm, {})]) {
    assert.throws(() => native.createDefaultExportModule(42, invalid), { code: 'ERR_INVALID_ARG_TYPE' });
  }
  link(module);
  link(separate);
  const result = observe(native.evaluateModule(module), realm);
  const separateResult = observe(native.evaluateModule(separate), other.realm);
  queue.runMicrotasks();
  assert.equal(result.state, 'fulfilled');
  assert.equal(separateResult.state, 'pending');
  other.queue.runMicrotasks();
  assert.equal(separateResult.state, 'fulfilled');
  realm.detachGlobal();
  assert.throws(() => native.createDefaultExportModule(44, realm), { code: 'ERR_CONTEXT_NOT_INITIALIZED' });
  assert.throws(() => native.evaluateModule(module), { code: 'ERR_CONTEXT_NOT_INITIALIZED' });
});

test('an evaluated synthetic dependency retains its value after its handle is collected', async () => {
  const { realm, queue } = fixture();
  function allocate() {
    const value = evaluate('({ answer: 42 })', realm);
    const dependency = native.createDefaultExportModule(value, realm);
    const root = compile('export { default as value } from "data";', realm);
    link(root, [[root, [dependency]]]);
    return { root, reference: new WeakRef(dependency), value: new WeakRef(value) };
  }
  const { root, reference, value } = allocate();
  assert.notEqual(value.deref(), undefined);
  const result = observe(native.evaluateModule(root), realm);
  queue.runMicrotasks();
  assert.equal(result.state, 'fulfilled');
  // The evaluation callback needs its handle until it assigns the export.
  await assertCollected({ dependency: reference });
  assert.equal(native.moduleNamespace(root).value, value.deref());
  assert.equal(native.moduleNamespace(root).value.answer, 42);
});

test('discarded synthetic graphs release their exports and realms at every lifecycle stage', async () => {
  function allocate(stage) {
    const { realm, queue } = fixture();
    const value = evaluate('({})', realm);
    const dependency = native.createDefaultExportModule(value, realm);
    const root = compile('export { default } from "data";', realm);
    value.root = root;
    value.dependency = dependency;
    if (stage !== 'created') link(root, [[root, [dependency]]]);
    if (stage === 'evaluated') {
      native.evaluateModule(root);
      queue.runMicrotasks();
    }
    return { root: new WeakRef(root), dependency: new WeakRef(dependency),
      value: new WeakRef(value), realm: new WeakRef(realm), global: new WeakRef(realm.globalProxy) };
  }
  for (const stage of ['created', 'linked', 'evaluated']) await assertCollected(allocate(stage));
});

test('V8 evaluates dependencies once and preserves live bindings and module scope', () => {
  const { realm, queue } = fixture();
  const trace = [];
  realm.globalProxy.record = value => trace.push(value);
  const leaf = compile('record("leaf"); export let value = 1; export function bump() { value++; }', realm);
  const left = compile('export { value, bump } from "leaf"; record("left");', realm);
  const right = compile('import { value } from "leaf"; export function read() { return value; } record("right");', realm);
  const root = compile([
    'import { value, bump } from "left";',
    'import { read } from "right";',
    'record("root"); const moduleLocal = 42;',
    'export { value, bump, read, moduleLocal };',
  ].join('\n'), realm);
  link(root, [[root, [left, right]], [left, [leaf]], [right, [leaf]]]);
  assert.deepEqual(trace, []);
  const promise = native.evaluateModule(root);
  const result = observe(promise, realm);
  queue.runMicrotasks();
  assert.deepEqual(trace, ['leaf', 'left', 'right', 'root']);
  assert.equal(result.state, 'fulfilled');
  const namespace = native.moduleNamespace(root);
  assert.equal(namespace.value, 1);
  namespace.bump();
  assert.equal(namespace.value, 2);
  assert.equal(namespace.read(), 2);
  assert.equal(namespace.moduleLocal, 42);
  assert.equal(evaluate('typeof moduleLocal', realm), 'undefined');
  const again = observe(native.evaluateModule(root), realm);
  queue.runMicrotasks();
  assert.equal(again.state, 'fulfilled');
  assert.deepEqual(trace, ['leaf', 'left', 'right', 'root']);
});

test('cycles are linked by V8 and exported functions see current bindings', () => {
  const { realm, queue } = fixture();
  const a = compile('import { readA } from "b"; export let value = 1; export { readA }; export function bump() { value++; }', realm);
  const b = compile('import { value } from "a"; export function readA() { return value; }', realm);
  link(a, [[a, [b]], [b, [a]]]);
  const result = observe(native.evaluateModule(a), realm);
  queue.runMicrotasks();
  assert.equal(result.state, 'fulfilled');
  const namespace = native.moduleNamespace(a);
  assert.equal(namespace.readA(), 1);
  namespace.bump();
  assert.equal(namespace.readA(), 2);
});

test('top-level await returns a realm Promise and keeps each queue under host control', () => {
  const { realm, queue } = fixture();
  const other = fixture();
  const trace = [];
  realm.globalProxy.record = value => trace.push(value);
  other.realm.globalProxy.record = value => trace.push(value);
  evaluate('globalThis.ready = new Promise(resolve => globalThis.release = resolve)', realm);
  const dependency = compile('record("dependency:start"); await ready; record("dependency:end"); export const value = 42;', realm);
  const root = compile('import { value } from "dependency"; record("root"); export { value };', realm);
  const separate = compile('await 0; record("other");', other.realm);
  link(root, [[root, [dependency]]]);
  link(separate);
  const promise = native.evaluateModule(root);
  assert.equal(types.isPromise(promise), true);
  assert.equal(Object.getPrototypeOf(promise), evaluate('Promise.prototype', realm));
  const result = observe(promise, realm);
  const separateResult = observe(native.evaluateModule(separate), other.realm);
  assert.deepEqual(trace, ['dependency:start']);
  queue.runMicrotasks();
  assert.equal(result.state, 'pending');
  realm.globalProxy.release();
  assert.deepEqual(trace, ['dependency:start']);
  queue.runMicrotasks();
  assert.equal(result.state, 'fulfilled');
  assert.equal(native.moduleNamespace(root).value, 42);
  assert.deepEqual(trace, ['dependency:start', 'dependency:end', 'root']);
  assert.equal(separateResult.state, 'pending');
  other.queue.runMicrotasks();
  assert.equal(separateResult.state, 'fulfilled');
  assert.deepEqual(trace, ['dependency:start', 'dependency:end', 'root', 'other']);
});

test('a rejected awaited dependency preserves its reason and prevents parent execution', () => {
  const { realm, queue } = fixture();
  const sentinel = {};
  realm.globalProxy.sentinel = sentinel;
  realm.globalProxy.ran = false;
  const dependency = compile('await Promise.reject(sentinel); export const value = 42;', realm);
  const root = compile('import { value } from "dependency"; ran = true;', realm);
  link(root, [[root, [dependency]]]);
  const result = observe(native.evaluateModule(root), realm);
  queue.runMicrotasks();
  assert.equal(result.state, 'rejected');
  assert.equal(result.value, sentinel);
  assert.equal(realm.globalProxy.ran, false);
});

test('syntax, missing-export, and execution errors retain the intended realm and origin', () => {
  const { realm, queue } = fixture();
  const syntax = evaluate('SyntaxError.prototype', realm);
  assert.throws(() => compile('export const = ;', realm), error => Object.getPrototypeOf(error) === syntax);
  const root = compile('import { absent } from "dep";', realm, 'missing-export.js');
  const dependency = compile('export const present = 1;', realm);
  assert.throws(() => link(root, [[root, [dependency]]]), error => {
    assert.equal(Object.getPrototypeOf(error), syntax);
    assert.match(error.message, /absent/u);
    return true;
  });
  const failure = compile('throw new Error("module failure")', realm, 'module-origin.js', 6);
  link(failure);
  const result = observe(native.evaluateModule(failure), realm);
  queue.runMicrotasks();
  assert.equal(result.state, 'rejected');
  assert.equal(Object.getPrototypeOf(result.value), evaluate('Error.prototype', realm));
  assert.match(result.value.stack, /module-origin\.js:7:/u);
});

test('module results use their existing realm and cross-realm links are rejected', () => {
  const first = fixture();
  const second = fixture();
  for (const { realm, queue } of [first, second]) {
    const module = compile('export const object = {}; export const global = globalThis;', realm);
    link(module);
    const result = observe(native.evaluateModule(module), realm);
    queue.runMicrotasks();
    assert.equal(result.state, 'fulfilled');
    assert.equal(native.moduleNamespace(module).global, realm.globalProxy);
    assert.equal(Object.getPrototypeOf(native.moduleNamespace(module).object), evaluate('Object.prototype', realm));
  }
  const root = compile('import "dep";', first.realm);
  const foreign = compile('', second.realm);
  assert.throws(() => link(root, [[root, [foreign]]]), { code: 'ERR_MODULE_CONTEXT_MISMATCH' });
});

test('invalid handles and premature or detached execution throw instead of reaching V8 assertions', () => {
  const { realm } = fixture();
  const root = compile('export const value = 42;', realm);
  for (const invalid of [undefined, {}, Object.create(root), new Proxy(root, {})]) {
    assert.throws(() => native.moduleRequests(invalid), { code: 'ERR_INVALID_ARG_TYPE' });
    assert.throws(() => native.evaluateModule(invalid), { code: 'ERR_INVALID_ARG_TYPE' });
  }
  assert.throws(() => native.evaluateModule(root), { code: 'ERR_MODULE_NOT_LINKED' });
  assert.throws(() => native.moduleNamespace(root), { code: 'ERR_MODULE_NOT_LINKED' });
  assert.throws(() => compile(42, realm), { code: 'ERR_INVALID_ARG_TYPE' });
  link(root);
  realm.detachGlobal();
  assert.throws(() => native.evaluateModule(root), { code: 'ERR_CONTEXT_NOT_INITIALIZED' });
});

test('missing dependencies and host getter exceptions leave linking retryable', () => {
  const { realm, queue } = fixture();
  const root = compile('import { value } from "dep"; export { value };', realm);
  const dep = compile('export const value = 42;', realm);
  assert.throws(() => link(root), { code: 'ERR_MODULE_DEPENDENCY_MISSING' });
  assert.throws(() => link(root, [[root, []]]), { code: 'ERR_INVALID_ARG_VALUE' });
  const sentinel = {};
  const dependencies = [dep];
  Object.defineProperty(dependencies, 0, { get() { throw sentinel; } });
  assert.throws(() => link(root, [[root, dependencies]]), error => error === sentinel);
  link(root, [[root, [dep]]]);
  const result = observe(native.evaluateModule(root), realm);
  queue.runMicrotasks();
  assert.equal(result.state, 'fulfilled');
  assert.equal(native.moduleNamespace(root).value, 42);
});

test('linked dependencies survive collection of their JavaScript handles', async () => {
  const { realm, queue } = fixture();
  function allocate() {
    const dependency = compile('export const value = 42;', realm);
    const root = compile('import { value } from "dependency"; export { value };', realm);
    link(root, [[root, [dependency]]]);
    return { root, reference: new WeakRef(dependency) };
  }
  const { root, reference } = allocate();
  await assertCollected({ dependency: reference });
  const result = observe(native.evaluateModule(root), realm);
  queue.runMicrotasks();
  assert.equal(result.state, 'fulfilled');
  assert.equal(native.moduleNamespace(root).value, 42);
});

test('a discarded cyclic module graph and realm are collectible even with a back-reference', async () => {
  function allocate() {
    const { realm, queue } = fixture();
    const a = compile('import "b"; export const value = 1;', realm);
    const b = compile('import "a";', realm);
    link(a, [[a, [b]], [b, [a]]]);
    native.evaluateModule(a);
    queue.runMicrotasks();
    realm.globalProxy.retained = a;
    return { a: new WeakRef(a), b: new WeakRef(b), realm: new WeakRef(realm), global: new WeakRef(realm.globalProxy) };
  }
  await assertCollected(allocate());
});

test('an exported closure survives collection of the module handle', async () => {
  const { realm, queue } = fixture();
  function allocate() {
    const module = compile('let value = 40; export function next() { return ++value; }', realm);
    link(module);
    native.evaluateModule(module);
    queue.runMicrotasks();
    return { next: native.moduleNamespace(module).next, reference: new WeakRef(module) };
  }
  const { next, reference } = allocate();
  await assertCollected({ module: reference });
  assert.equal(next(), 41);
  assert.equal(next(), 42);
});

test('ordinary Node VM modules and dynamic import keep their existing behavior', async () => {
  const context = vm.createContext({});
  const module = new vm.SourceTextModule('export const value = 42;', { context });
  await module.link(() => assert.fail('Unexpected dependency'));
  await module.evaluate();
  assert.equal(module.namespace.value, 42);
  const imported = await import('data:text/javascript,export default 43;');
  assert.equal(imported.default, 43);
});

test('worker teardown handles live modules, pending await, and collected graphs', { timeout: 15000 }, async () => {
  const source = `
    const native = require(require('node:worker_threads').workerData);
    const queue = native.createMicrotaskQueue();
    const realm = native.createContextHandle({ microtaskQueue: queue });
    for (let i = 0; i < 100; i++) {
      const dependency = native.createDefaultExportModule({ answer: 42 }, realm);
      const module = native.compileModule('import data from "data"; export const value = data.answer;', realm, 'worker.js', 0);
      native.linkModule(module, new Map([[module, [dependency]]]));
      native.evaluateModule(module);
      if (native.moduleNamespace(module).value !== 42) throw new Error('Wrong export');
    }
    global.gc();
    globalThis.synthetic = native.createDefaultExportModule({ realm }, realm);
    native.linkModule(synthetic, new Map());
    globalThis.pending = native.compileModule('await new Promise(() => {});', realm, 'pending.js', 0);
    native.linkModule(pending, new Map());
    native.evaluateModule(pending);
  `;
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve, reject) => {
      const worker = new Worker(source, { eval: true, workerData: require.resolve('./support/native-vm.cjs') });
      worker.once('error', reject);
      worker.once('exit', code => code === 0 ? resolve() : reject(new Error(`Worker exited ${code}`)));
    });
  }
});
