'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { Worker } = require('node:worker_threads');
const { spawnSync } = require('node:child_process');
const compat = require('../addon/index.cjs');
const { assertCollected } = require('./support/gc.cjs');

test('Global predicate recognizes numeric and reference globals from Node, VM, and addon contexts', () => {
  for (const value of ['i32', 'i64', 'f32', 'f64', 'anyfunc', 'externref', 'anyref', 'eqref', 'structref', 'arrayref', 'i31ref']) {
    for (const mutable of [false, true]) {
      assert.equal(compat.isWebAssemblyGlobal(new WebAssembly.Global({ value, mutable })), true, `${value}/${mutable}`);
    }
  }
  assert.equal(compat.isWebAssemblyGlobal(vm.runInNewContext('new WebAssembly.Global({value:"i32"})')), true);
  const context = compat.createContextHandle({ microtaskQueue: compat.createMicrotaskQueue() });
  assert.equal(compat.isWebAssemblyGlobal(compat.runInContext('new WebAssembly.Global({value:"externref"})', context)), true);
  class Derived extends WebAssembly.Global {}
  assert.equal(compat.isWebAssemblyGlobal(new Derived({ value: 'i32' })), true);
});

test('Global predicate ignores author properties and preserves contents with altered or frozen prototypes', () => {
  const fail = () => { throw new Error('Author code ran'); };
  const value = new Proxy({}, { get: fail, getPrototypeOf: fail });
  const getter = Object.getOwnPropertyDescriptor(WebAssembly.Global.prototype, 'value').get;
  for (const mutable of [false, true]) {
    const global = new WebAssembly.Global({ value: 'externref', mutable }, value);
    for (const key of ['value', 'valueOf', 'constructor', Symbol.toStringTag, Symbol.toPrimitive]) {
      Object.defineProperty(global, key, { get: fail });
    }
    Object.setPrototypeOf(global, new Proxy({}, { get: fail, getPrototypeOf: fail, ownKeys: fail }));
    Object.freeze(global);
    assert.equal(compat.isWebAssemblyGlobal(global), true);
    assert.equal(getter.call(global), value);
  }
  const bare = Object.freeze(Object.setPrototypeOf(new WebAssembly.Global({ value: 'i32' }, 7), null));
  assert.equal(compat.isWebAssemblyGlobal(bare), true);
  assert.equal(getter.call(bare), 7);
});

test('Global predicate rejects other native objects, forged prototypes, and proxies without invoking traps', () => {
  const fail = () => { throw new Error('Author code ran'); };
  const global = new WebAssembly.Global({ value: 'i32' });
  const revoked = Proxy.revocable(global, {});
  revoked.revoke();
  const module = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  for (const value of [
    undefined, null, true, 1, 1n, Symbol(), '', {}, [], () => {}, new Date(), new Map(), new Set(), new Number(1),
    Object.create(WebAssembly.Global.prototype), Object.create(global), { [Symbol.toStringTag]: 'WebAssembly.Global' },
    new Proxy(global, { get: fail, getPrototypeOf: fail, ownKeys: fail, has: fail }), revoked.proxy,
    new Proxy(() => {}, { get: fail }), module, new WebAssembly.Instance(module),
    new WebAssembly.Memory({ initial: 0 }), new WebAssembly.Table({ element: 'externref', initial: 0 }),
    WebAssembly.JSTag, new WebAssembly.Exception(new WebAssembly.Tag({ parameters: [] }), []),
  ]) assert.equal(compat.isWebAssemblyGlobal(value), false);
  assert.equal(compat.isWebAssemblyGlobal(), false);
});

test('Global predicate recognizes exported vectors without reading their inaccessible values', () => {
  const context = compat.createContextHandle({ microtaskQueue: compat.createMicrotaskQueue() });
  for (const mutable of [0, 1]) {
    const bytes = new Uint8Array(vectorBytes);
    bytes[12] = mutable;
    context.globalProxy.bytes = bytes;
    const global = compat.runInContext('new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.g', context);
    assert.equal(compat.isWebAssemblyGlobal(global), true);
    const getter = Object.getOwnPropertyDescriptor(WebAssembly.Global.prototype, 'value').get;
    assert.throws(() => getter.call(global), TypeError);
  }
});

test('Global predicate leaves first function materialization to the author getter realm', () => {
  const native = compat.createContextHandle({ microtaskQueue: compat.createMicrotaskQueue() });
  native.globalProxy.bytes = functionGlobalBytes;
  const standard = vm.createContext({ bytes: functionGlobalBytes });
  for (const run of [source => vm.runInContext(source, standard), source => compat.runInContext(source, native)]) {
    const global = run('new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(bytes))).exports.g');
    assert.equal(compat.isWebAssemblyGlobal(global), true);
    const getter = run('Object.getOwnPropertyDescriptor(WebAssembly.Global.prototype,"value").get');
    const fn = getter.call(global);
    assert.equal(Object.getPrototypeOf(fn), run('Function.prototype'));
    assert.equal(fn(), 42);
    assert.equal(getter.call(global), fn);
  }
});

test('Global predicate does not retain its arguments or their context', async () => {
  function allocate() {
    const context = compat.createContextHandle({ microtaskQueue: compat.createMicrotaskQueue() });
    const global = compat.runInContext('new WebAssembly.Global({value:"externref"})', context);
    assert.equal(compat.isWebAssemblyGlobal(global), true);
    return { global: new WeakRef(global), context: new WeakRef(context) };
  }
  await assertCollected(allocate());
});

test('Global predicate initialization uses an untouched constructor rather than Node author properties', () => {
  const child = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const Global = WebAssembly.Global;
    let calls = 0;
    Object.defineProperty(WebAssembly, 'Global', { get() { calls++; throw new Error('author constructor'); } });
    const compat = require(process.argv[1]);
    assert.equal(compat.isWebAssemblyGlobal(new Global({value:'i32'})), true);
    assert.equal(compat.isWebAssemblyGlobal({}), false);
    assert.equal(calls, 0);
  `, require.resolve('../addon/index.cjs')], { encoding: 'utf8', windowsHide: true });
  if (child.error) throw child.error;
  assert.equal(child.status, 0, child.stderr);
});

test('Global predicate initializes independently in worker isolates', async () => {
  const worker = new Worker(`
    const {parentPort, workerData} = require('node:worker_threads');
    const compat = require(workerData);
    parentPort.postMessage([
      compat.isWebAssemblyGlobal(new WebAssembly.Global({value:'i32'})),
      compat.isWebAssemblyGlobal({}),
    ]);
  `, { eval: true, workerData: require.resolve('../addon/index.cjs') });
  const messages = [];
  worker.on('message', value => messages.push(value));
  await new Promise((resolve, reject) => {
    worker.on('error', reject);
    worker.on('exit', code => code === 0 ? resolve() : reject(new Error(`Exit ${code}`)));
  });
  assert.deepEqual(messages, [[true, false]]);
});

// (module (global (export "g") v128 (v128.const i32x4 0 0 0 0)))
const vectorBytes = [0, 97, 115, 109, 1, 0, 0, 0, 6, 22, 1, 123, 0, 253, 12,
  ...Array(16).fill(0), 11, 7, 5, 1, 1, 103, 3, 0];

// (module (func (result i32) (i32.const 42)) (global (export "g") funcref (ref.func 0)))
// No separate function export: its JS wrapper must be created only by the first explicit value read.
const functionGlobalBytes = [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0,
  6, 6, 1, 112, 0, 210, 0, 11, 7, 5, 1, 1, 103, 3, 0, 10, 6, 1, 4, 0, 65, 42, 11];
