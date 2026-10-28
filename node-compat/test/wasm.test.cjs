'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Worker } = require('node:worker_threads');
const { assertCollected } = require('./support/gc.cjs');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { fixture, compat } = require('./support/wasm.cjs');
const { binary, constant, callImport, mutableGlobal, importGlobal } = require('./support/wasm-fixtures.cjs');

test('WebAssemblyModule exposes the shared VM lifecycle without its private helper request', () => {
  const f = fixture();
  const wasm = f.compileWasm(callImport(), 'owned.wasm');
  assert.equal(wasm instanceof compat.Module, true);
  assert.equal(wasm.context, f.realm);
  assert.equal(wasm.identifier, 'owned.wasm');
  assert.equal(wasm.status, 'unlinked');
  assert.equal(Object.isFrozen(wasm.moduleRequests), true);
  assert.equal(Object.isFrozen(wasm.moduleRequests[0]), true);
  assert.equal(Object.isFrozen(wasm.moduleRequests[0].attributes), true);
  assert.deepEqual(wasm.moduleRequests.map(request => request.specifier), ['./js']);
  assert.throws(() => wasm.namespace, { code: 'ERR_MODULE_NOT_LINKED' });
  assert.throws(() => wasm.instantiate(), /dependencies/u);
  assert.throws(() => wasm.linkRequests([]), /one module/u);
  const js = f.compile('export const answer = () => 42;');
  js.linkRequests([]);
  wasm.linkRequests([js]);
  wasm.instantiate();
  assert.equal(wasm.status, 'linked');
  assert.equal(wasm.instance, undefined);
  assert.equal(f.evaluate(wasm).state, 'fulfilled');
  assert.equal(wasm.status, 'evaluated');
  assert.equal(wasm.namespace.answer(), 42);
  assert.throws(() => wasm.linkRequests([js]), /unlinked/u);
  assert.throws(() => wasm.error, /status|errored/u);
  assert.throws(() => new compat.WebAssemblyModule(constant(), { context: f.realm, unexpected: true }), /Unsupported/u);
});

test('Wasm compilation and linking do not instantiate or run its start function', () => {
  const f = fixture();
  f.realm.globalProxy.starts = 0;
  const js = f.compile('export function start() { starts++; }');
  const bytes = binary({ types: [[[], []]], imports: [['./js', 'start', 'function', [0]]], start: 0 });
  const wasm = f.compileWasm(bytes);
  assert.deepEqual(wasm.moduleRequests, [{ __proto__: null, specifier: './js', attributes: { __proto__: null }, phase: 'evaluation' }]);
  assert.equal(wasm.instance, undefined);
  assert.equal(f.realm.globalProxy.starts, 0);
  f.link(wasm, new Map([[wasm, [js]]]));
  assert.equal(f.realm.globalProxy.starts, 0);
  const result = f.evaluate(wasm);
  assert.equal(result.state, 'fulfilled');
  assert.equal(f.realm.globalProxy.starts, 1);
  assert.equal(Object.getPrototypeOf(result.promise), f.run('Promise.prototype'));
  assert.equal(Object.getPrototypeOf(wasm.source), f.run('WebAssembly.Module.prototype'));
  assert.equal(Object.getPrototypeOf(wasm.instance), f.run('WebAssembly.Instance.prototype'));
  f.evaluate(wasm);
  assert.equal(f.realm.globalProxy.starts, 1);
});

test('JavaScript imports Wasm functions, immutable globals, memory and tables in its realm', () => {
  const f = fixture();
  const wasm = f.compileWasm(binary({ functions: [{ code: [0x41, 42] }],
    globals: [{ value: [0x41, 7] }], memories: [[0, 1]], tables: [[0x70, 0, 1]],
    exports: [['answer', 'function', 0], ['count', 'global', 0], ['memory', 'memory', 0], ['table', 'table', 0]],
  }));
  const root = f.compile('import * as wasm from "./wasm"; export const result = wasm.answer() + wasm.count; export { wasm };');
  f.link(root, new Map([[root, [wasm]]]));
  assert.equal(f.evaluate(root).state, 'fulfilled');
  const ns = root.namespace;
  assert.equal(ns.result, 49);
  assert.equal(Object.getPrototypeOf(ns.wasm.answer), f.run('Function.prototype'));
  assert.equal(Object.getPrototypeOf(ns.wasm.memory), f.run('WebAssembly.Memory.prototype'));
  assert.equal(Object.getPrototypeOf(ns.wasm.table), f.run('WebAssembly.Table.prototype'));
  assert.equal(ns.wasm.memory, wasm.instance.exports.memory);
  assert.throws(() => { ns.wasm.count = 99; }, TypeError);
});

test('source imports share the compiled object without linking or executing its dependencies', () => {
  const f = fixture();
  const wasm = f.compileWasm(callImport('./unloaded'));
  const root = f.compile('import source first from "./wasm"; import source second from "./wasm"; export { first, second };');
  f.link(root, new Map([[root, [wasm]]]));
  assert.equal(f.evaluate(root).state, 'fulfilled');
  const ns = root.namespace;
  assert.equal(ns.first, ns.second);
  assert.equal(ns.first, wasm.source);
  assert.equal(wasm.instance, undefined);
  const instantiate = f.run('(module) => new WebAssembly.Instance(module, { "./unloaded": { answer: () => 42 } })');
  assert.equal(instantiate(ns.first).exports.answer(), 42);
});

test('source and evaluation requests for the same specifier are resolved separately', () => {
  const f = fixture();
  const wasm = f.compileWasm(constant());
  const root = f.compile('import source code from "./wasm"; import { answer } from "./wasm"; export { code, answer };');
  assert.deepEqual(root.moduleRequests.map(request => request.phase), ['source', 'evaluation']);
  f.link(root, new Map([[root, [wasm, wasm]]]));
  assert.equal(f.evaluate(root).state, 'fulfilled');
  const ns = root.namespace;
  assert.equal(ns.code, wasm.source);
  assert.equal(ns.answer, wasm.instance.exports.answer);
  assert.equal(ns.answer(), 42);
});

test('static source imports reject JavaScript modules and foreign-context dependencies', () => {
  const f = fixture();
  const root = f.compile('import source code from "./wasm";');
  const js = f.compile('export default 42;');
  assert.throws(() => root.linkRequests([js]), /WebAssemblyModule/u);
  assert.throws(() => root.linkRequests([fixture().compileWasm(constant())]), /same context/u);
});

test('Wasm dependencies use JavaScript bindings after top-level await settles', () => {
  const f = fixture();
  const js = f.compile('await new Promise(resolve => globalThis.release = resolve); export const answer = () => 42;');
  const wasm = f.compileWasm(callImport());
  f.link(wasm, new Map([[wasm, [js]]]));
  const result = f.evaluate(wasm);
  assert.equal(result.state, 'pending');
  assert.equal(wasm.instance, undefined);
  f.realm.globalProxy.release();
  f.queue.runMicrotasks();
  assert.equal(result.state, 'fulfilled');
  assert.equal(wasm.namespace.answer(), 42);
});

test('a JavaScript/Wasm cycle can use an initialized function declaration', () => {
  const f = fixture();
  const js = f.compile('import { answer as wasmAnswer } from "./wasm"; export function answer() { return 42; } export const result = wasmAnswer();');
  const wasm = f.compileWasm(callImport());
  f.link(js, new Map([[js, [wasm]], [wasm, [js]]]));
  assert.equal(f.evaluate(js).state, 'fulfilled');
  assert.equal(js.namespace.result, 42);
});

test('a cycle reading an uninitialized JavaScript binding rejects in the author realm', () => {
  const f = fixture();
  const js = f.compile('import { answer as wasmAnswer } from "./wasm"; export const answer = () => 42;');
  const wasm = f.compileWasm(callImport());
  f.link(js, new Map([[js, [wasm]], [wasm, [js]]]));
  const result = f.evaluate(js);
  assert.equal(result.state, 'rejected');
  assert.equal(Object.getPrototypeOf(result.value), f.run('ReferenceError.prototype'));
});

test('direct Wasm-to-Wasm imports retain mutable globals and memory identity', () => {
  const f = fixture();
  const a = f.compileWasm(mutableGlobal());
  const b = f.compileWasm(importGlobal());
  f.link(b, new Map([[b, [a]]]));
  assert.equal(f.evaluate(b).state, 'fulfilled');
  const ns = a.namespace;
  assert.equal(b.namespace.read(), 1);
  ns.bump();
  assert.equal(b.namespace.read(), 2);
  assert.equal(a.instance.exports.value, b.instance.exports.value);

  const memory = f.compileWasm(binary({ memories: [[0, 1]], exports: [['memory', 'memory', 0]] }));
  const consumer = f.compileWasm(binary({ imports: [['./memory', 'memory', 'memory', [0, 1]]],
    exports: [['memory', 'memory', 0]] }));
  f.link(consumer, new Map([[consumer, [memory]]]));
  assert.equal(f.evaluate(consumer).state, 'fulfilled');
  assert.equal(consumer.namespace.memory, memory.namespace.memory);
});

test('unexecuted Wasm dependencies in a cycle produce a Wasm LinkError', () => {
  const f = fixture();
  const a = f.compileWasm(callImport('./b'));
  const b = f.compileWasm(callImport('./a'));
  f.link(a, new Map([[a, [b]], [b, [a]]]));
  const result = f.evaluate(a);
  assert.equal(result.state, 'rejected');
  assert.equal(Object.getPrototypeOf(result.value), f.run('WebAssembly.LinkError.prototype'));
});

test('relinking cannot replace dependencies V8 already linked, including after a parent link error', () => {
  for (const parentFails of [false, true]) {
    const f = fixture();
    const original = f.compileWasm(mutableGlobal());
    const replacement = f.compileWasm(mutableGlobal());
    const consumer = f.compileWasm(importGlobal());
    if (parentFails) {
      const parent = f.compile('import { absent } from "./consumer";');
      assert.throws(() => f.link(parent, new Map([[parent, [consumer]], [consumer, [original]]])));
    } else {
      f.link(consumer, new Map([[consumer, [original]]]));
    }
    f.link(consumer, new Map([[consumer, [replacement]]]));
    const result = f.evaluate(consumer);
    assert.equal(result.state, 'fulfilled', result.value?.stack);
    assert.equal(consumer.instance.exports.value, original.instance.exports.value);
    assert.equal(replacement.instance, undefined);
  }
});

test('Wasm errors preserve compile/link/runtime categories and user exceptions', () => {
  const f = fixture();
  assert.throws(() => f.compileWasm(Uint8Array.of(0)), error =>
    Object.getPrototypeOf(error) === f.run('WebAssembly.CompileError.prototype'));
  const wasm = f.compileWasm(callImport());
  const wrong = f.compile('export const answer = 7;');
  f.link(wasm, new Map([[wasm, [wrong]]]));
  let result = f.evaluate(wasm);
  assert.equal(result.state, 'rejected');
  assert.equal(Object.getPrototypeOf(result.value), f.run('WebAssembly.LinkError.prototype'));

  const trap = f.compileWasm(binary({ types: [[[], []]], functions: [{ code: [0x00] }], start: 0 }));
  f.link(trap);
  result = f.evaluate(trap);
  assert.equal(result.state, 'rejected');
  assert.equal(Object.getPrototypeOf(result.value), f.run('WebAssembly.RuntimeError.prototype'));

  const marker = {};
  f.realm.globalProxy.marker = marker;
  const throws = f.compile('export function start() { throw marker; }');
  const starts = f.compileWasm(binary({ types: [[[], []]], imports: [['./js', 'start', 'function', [0]]], start: 0 }));
  f.link(starts, new Map([[starts, [throws]]]));
  result = f.evaluate(starts);
  assert.equal(result.state, 'rejected');
  assert.equal(result.value, marker);
  assert.equal(f.evaluate(starts).value, marker);
});

test('missing and ambiguous imports fail linking before Wasm instantiation', () => {
  const f = fixture();
  const absent = f.compile('export const other = 1;');
  const wasm = f.compileWasm(callImport());
  assert.throws(() => f.link(wasm, new Map([[wasm, [absent]]])), error =>
    Object.getPrototypeOf(error) === f.run('SyntaxError.prototype'));
  assert.equal(wasm.instance, undefined);
  const a = f.compile('export function answer() {}');
  const b = f.compile('export function answer() {}');
  const barrel = f.compile('export * from "a"; export * from "b";');
  const ambiguous = f.compileWasm(callImport());
  assert.throws(() => f.link(ambiguous, new Map([[ambiguous, [barrel]], [barrel, [a, b]]])), error =>
    Object.getPrototypeOf(error) === f.run('SyntaxError.prototype'));
});

test('arbitrary import/export names cannot inject code or collide with the private helper', () => {
  const f = fixture();
  const name = '"; globalThis.injected = true; // \u0000 🚀';
  const wasm = f.compileWasm(constant(name));
  f.link(wasm);
  assert.equal(f.evaluate(wasm).state, 'fulfilled');
  assert.equal(wasm.namespace[name](), 42);
  assert.equal(f.realm.globalProxy.injected, undefined);
  const js = f.compile('export function answer() { return 42; }');
  const collision = f.compileWasm(callImport('browlet:wasm-instantiate'));
  f.link(collision, new Map([[collision, [js]]]));
  assert.equal(f.evaluate(collision).state, 'fulfilled');
  assert.equal(collision.namespace.answer(), 42);
});

test('reserved prefixes are rejected while built-in string imports need no host dependency', () => {
  const f = fixture();
  for (const bytes of [constant('wasm:reserved'), constant('wasm-js:reserved'),
    callImport('wasm-js:reserved'), callImport('./js', 'wasm:reserved')]) {
    assert.throws(() => f.compileWasm(bytes), error =>
      Object.getPrototypeOf(error) === f.run('WebAssembly.LinkError.prototype'));
  }
  const strings = f.compileWasm(binary({
    types: [[[0x6f], [0x7f]], [[], [0x7f]]],
    imports: [['wasm:js/string-constants', 'hello', 'global', [0x6f, 0]],
      ['wasm:js-string', 'length', 'function', [0]]],
    functions: [{ type: 1, code: [0x23, 0, 0x10, 0] }],
    exports: [['text', 'global', 0], ['length', 'function', 1]],
  }));
  assert.deepEqual(strings.moduleRequests, []);
  f.link(strings);
  assert.equal(f.evaluate(strings).state, 'fulfilled');
  assert.equal(strings.namespace.text, 'hello');
  assert.equal(strings.namespace.length(), 5);
});

test('host instantiation uses captured intrinsics after author code replaces the public API', () => {
  const f = fixture();
  f.run(`
    WebAssembly.Module.imports = WebAssembly.Module.exports = () => { throw new Error('author static'); };
    Object.defineProperty(WebAssembly.Instance.prototype, 'exports', { get() { throw new Error('author getter'); } });
    Object.defineProperty(WebAssembly.Global.prototype, 'value', { get() { throw new Error('author global'); } });
    globalThis.WebAssembly = undefined;
  `);
  const wasm = f.compileWasm(binary({ globals: [{ value: [0x41, 42] }], exports: [['answer', 'global', 0]] }));
  f.link(wasm);
  const result = f.evaluate(wasm);
  assert.equal(result.state, 'fulfilled', result.value?.stack);
  assert.equal(wasm.namespace.answer, 42);
});

test('separate realms keep independent instances and microtask queues', () => {
  const a = fixture();
  const b = fixture();
  const am = a.compileWasm(constant());
  const bm = b.compileWasm(constant());
  a.link(am);
  b.link(bm);
  b.run('Promise.resolve().then(() => globalThis.drained = true)');
  assert.equal(a.evaluate(am).state, 'fulfilled');
  assert.equal(b.realm.globalProxy.drained, undefined);
  assert.equal(b.evaluate(bm).state, 'fulfilled');
  assert.notEqual(am.namespace.answer, bm.namespace.answer);
  assert.equal(Object.getPrototypeOf(bm.namespace.answer), b.run('Function.prototype'));
  const root = a.compile('import { answer } from "./foreign";');
  assert.throws(() => a.link(root, new Map([[root, [bm]]])), /same context/u);
});

test('retained Wasm exports survive discarded handles and unreachable graphs collect', async () => {
  let f = fixture();
  let wasm = f.compileWasm(constant());
  f.link(wasm);
  assert.equal(f.evaluate(wasm).state, 'fulfilled');
  let answer = wasm.namespace.answer;
  const refs = [f.realm, wasm, wasm.source, wasm.instance].map(value => new WeakRef(value));
  f = wasm = undefined;
  await nextTurn();
  await global.gc({ type: 'major', execution: 'async' });
  assert.equal(answer(), 42);
  answer = undefined;
  await nextTurn();
  await global.gc({ type: 'major', execution: 'async', flavor: 'last-resort' });
  await assertCollected(refs);
});

test('unreachable Wasm graphs collect before and after linking and evaluation', async () => {
  function allocate(stage) {
    const f = fixture();
    const wasm = f.compileWasm(callImport());
    const js = f.compile('export const answer = () => 42;');
    if (stage !== 'compiled') f.link(wasm, new Map([[wasm, [js]]]));
    if (stage === 'evaluated') assert.equal(f.evaluate(wasm).state, 'fulfilled');
    return [f.realm, js, wasm, wasm.source].map(value => new WeakRef(value));
  }
  const refs = ['compiled', 'linked', 'evaluated'].flatMap(allocate);
  await nextTurn();
  await global.gc({ type: 'major', execution: 'async', flavor: 'last-resort' });
  await assertCollected(refs);
});

test('ordinary Node Wasm and ESM remain available after using the bridge', async () => {
  const f = fixture();
  const wasm = f.compileWasm(constant());
  f.link(wasm);
  assert.equal(f.evaluate(wasm).state, 'fulfilled');
  assert.equal(new WebAssembly.Instance(new WebAssembly.Module(constant())).exports.answer(), 42);
  const module = await import('data:text/javascript,export default 42');
  assert.equal(module.default, 42);
});

test('worker-local Wasm modules initialize and tear down cleanly', async () => {
  const worker = new Worker(`
    const { fixture } = require(${JSON.stringify(require.resolve('./support/wasm.cjs'))});
    const { constant } = require(${JSON.stringify(require.resolve('./support/wasm-fixtures.cjs'))});
    const f = fixture(); const module = f.compileWasm(constant());
    f.link(module); f.evaluate(module);
    require('node:worker_threads').parentPort.postMessage(module.namespace.answer());
  `, { eval: true });
  const message = new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  const exit = new Promise(resolve => worker.once('exit', resolve));
  assert.equal(await message, 42);
  assert.equal(await exit, 0);
});
