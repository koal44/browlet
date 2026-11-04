'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Worker } = require('node:worker_threads');
const { setImmediate: nextTurn } = require('node:timers/promises');
const native = require('./support/native-vm.cjs');
const { fixture } = require('./support/wasm.cjs');
const { assertCollected } = require('./support/gc.cjs');
const { itPassesWith } = require('./support/test-runtime.cjs');
const { mutableGlobal, importGlobal, binary } = require('./support/wasm-fixtures.cjs');
const { haveSameModuleBinding } = native;
const supportedTest = itPassesWith('wasmGlobalReexports');

test('reviewed Windows x64 engines expose the binding lookup', () => {
  const reviewed = process.platform === 'win32' && process.arch === 'x64' &&
    !Number(process.config.variables.v8_enable_pointer_compression) &&
    ['13.6.233.17-node.51', '14.6.202.34-node.28', '14.6.202.34-node.29'].includes(process.versions.v8);
  assert.equal(typeof haveSameModuleBinding, reviewed ? 'function' : 'undefined');
});

supportedTest('renamed, indirect and cyclic re-exports preserve the native mutable Global', () => {
  const f = fixture();
  const original = f.compileWasm(mutableGlobal());
  const left = f.compile('export { value as renamed } from "./wasm"; export * from "./right";');
  const right = f.compile('import { renamed } from "./left"; export { renamed as value };');
  const consumer = f.compileWasm(importGlobal('./barrel'));
  f.link(consumer, new Map([[consumer, [right]], [right, [left]], [left, [original, right]]]));
  const result = f.evaluate(consumer);
  assert.equal(result.state, 'fulfilled', result.value?.stack);
  assert.equal(consumer.instance.exports.value, original.instance.exports.value);
  original.namespace.bump();
  assert.equal(consumer.namespace.read(), 2);
  assert.equal(original.namespace.value, 1, 'the separate live JavaScript binding gap remains');
});

supportedTest('an already-linked barrel retains its origin after a failed parent link', () => {
  for (const parentFails of [false, true]) {
    const f = fixture();
    const original = f.compileWasm(mutableGlobal());
    const barrel = f.compile('export {value} from "./wasm";');
    if (parentFails) {
      const parent = f.compile('import {missing} from "./barrel";');
      assert.throws(() => f.link(parent, new Map([[parent, [barrel]], [barrel, [original]]])));
    } else f.link(barrel, new Map([[barrel, [original]]]));
    assert.equal(barrel.status, 'linked');
    const consumer = f.compileWasm(importGlobal('./barrel'));
    f.link(consumer, new Map([[consumer, [barrel]]]));
    const result = f.evaluate(consumer);
    assert.equal(result.state, 'fulfilled', result.value?.stack);
    assert.equal(consumer.instance.exports.value, original.instance.exports.value);
  }
});

supportedTest('equal-valued independent globals and copied JavaScript exports remain distinct', () => {
  const f = fixture();
  const first = f.compileWasm(mutableGlobal());
  const second = f.compileWasm(mutableGlobal());
  const barrel = f.compile('import "./first"; export {value} from "./second";');
  const consumer = f.compileWasm(importGlobal('./barrel'));
  f.link(consumer, new Map([[consumer, [barrel]], [barrel, [first, second]]]));
  assert.equal(f.evaluate(consumer).state, 'fulfilled');
  first.namespace.bump();
  assert.equal(consumer.namespace.read(), 1);
  second.namespace.bump();
  assert.equal(consumer.namespace.read(), 2);
  assert.equal(consumer.instance.exports.value, second.instance.exports.value);

  const copy = f.compile('import {value as input} from "./wasm"; export const value = input;');
  const copied = f.compileWasm(importGlobal('./copy'));
  f.link(copied, new Map([[copied, [copy]], [copy, [second]]]));
  assert.equal(Object.getPrototypeOf(f.evaluate(copied).value), f.run('WebAssembly.LinkError.prototype'));
});

supportedTest('star-export diamonds resolve while ambiguous stars still fail linking', () => {
  const f = fixture();
  const original = f.compileWasm(mutableGlobal());
  const other = f.compileWasm(mutableGlobal());
  const left = f.compile('export * from "./wasm";');
  const right = f.compile('export * from "./wasm";');
  const diamond = f.compile('export * from "./left"; export * from "./right";');
  const consumer = f.compileWasm(importGlobal('./diamond'));
  f.link(consumer, new Map([[consumer, [diamond]], [diamond, [left, right]], [left, [original]], [right, [original]]]));
  assert.equal(f.evaluate(consumer).state, 'fulfilled');
  assert.equal(consumer.instance.exports.value, original.instance.exports.value);
  const ambiguous = f.compile('export * from "./first"; export * from "./second";');
  const rejected = f.compileWasm(importGlobal('./ambiguous'));
  assert.throws(() => f.link(rejected, new Map([[rejected, [ambiguous]], [ambiguous, [original, other]]])),
    error => Object.getPrototypeOf(error) === f.run('SyntaxError.prototype'));
});

supportedTest('a retained barrel keeps its native origin usable and releases the whole graph afterwards', async () => {
  async function exercise() {
    const f = fixture();
    let barrel;
    const refs = (() => {
      const original = f.compileWasm(mutableGlobal());
      barrel = f.compile('export {value, bump} from "./original";');
      f.link(barrel, new Map([[barrel, [original]]]));
      assert.equal(f.evaluate(barrel).state, 'fulfilled');
      return [f.realm, original.source, original.instance].map(value => new WeakRef(value));
    })();
    await nextTurn();
    await global.gc({ type: 'major', execution: 'async' });
    const consumer = f.compileWasm(importGlobal('./barrel'));
    f.link(consumer, new Map([[consumer, [barrel]]]));
    assert.equal(f.evaluate(consumer).state, 'fulfilled');
    barrel.namespace.bump();
    assert.equal(consumer.namespace.read(), 2);
    return refs;
  }
  // As in wasm.test.cjs, leave the exercising frame and flush V8's compilation
  // caches before asserting that the addon has no remaining roots.
  const refs = await exercise();
  await nextTurn();
  await global.gc({ type: 'major', execution: 'async', flavor: 'last-resort' });
  await assertCollected(refs);
});

supportedTest('lookup preserves TDZ, handles arbitrary export names, and survives GC', () => {
  const f = fixture();
  const names = ['', '0', '__proto__', 'default', 'snowman\u2603', 'zero\u0000end',
    ...Array.from({ length: 100 }, (_, i) => `entry${i}`)];
  const original = f.compile(`let value = 1; const copy = 1;
    ${names.map(name => `export {value as ${JSON.stringify(name)}};`).join('\n')}
    export {copy};`);
  const barrel = f.compile(names.map((name, i) => `export {${JSON.stringify(name)} as e${i}} from "./original";`).join('\n'));
  f.link(barrel, new Map([[barrel, [original]]]));
  const check = () => {
    for (const [i, name] of names.entries()) {
      assert.equal(haveSameModuleBinding(original.namespace, name, barrel.namespace, `e${i}`), true);
      assert.equal(haveSameModuleBinding(original.namespace, 'copy', barrel.namespace, `e${i}`), false);
    }
    assert.equal(haveSameModuleBinding(original.namespace, 'missing', barrel.namespace, 'missing'), false);
  };
  assert.throws(() => barrel.namespace.e0, { name: 'ReferenceError' });
  check();
  assert.throws(() => barrel.namespace.e0, { name: 'ReferenceError' });
  assert.equal(f.evaluate(barrel).state, 'fulfilled');
  global.gc();
  check();
  assert.equal(barrel.namespace.e0, 1);
});

supportedTest('lookup rejects proxies and coercible names without running author code', () => {
  const f = fixture();
  const original = f.compile('export const value = 1;');
  f.link(original);
  let calls = 0;
  const trap = () => { calls++; throw new Error('author trap'); };
  const proxy = new Proxy(original.namespace, { get: trap, getPrototypeOf: trap, ownKeys: trap });
  const revoked = Proxy.revocable(original.namespace, {});
  revoked.revoke();
  for (const value of [null, undefined, 0, {}, proxy, revoked.proxy]) {
    assert.throws(() => haveSameModuleBinding(value, 'value', original.namespace, 'value'), TypeError);
    assert.throws(() => haveSameModuleBinding(original.namespace, 'value', value, 'value'), TypeError);
  }
  assert.throws(() => haveSameModuleBinding(original.namespace, { [Symbol.toPrimitive]: trap }, original.namespace, 'value'), TypeError);
  assert.equal(calls, 0);
});

test('without the predicate ordinary imports work and the existing re-export limitation remains', () => {
  const modules = require('../addon/vm-modules.cjs')({ ...native, haveSameModuleBinding: undefined }, () => undefined);
  const f = fixture();
  modules.captureWasmIntrinsics(f.realm);
  const original = new modules.WebAssemblyModule(mutableGlobal(), { context: f.realm });
  const barrel = new modules.SourceTextModule('export {value} from "./original";', { context: f.realm });
  const consumer = new modules.WebAssemblyModule(importGlobal('./barrel'), { context: f.realm });
  original.linkRequests([]);
  barrel.linkRequests([original]);
  consumer.linkRequests([barrel]);
  consumer.instantiate();
  assert.equal(Object.getPrototypeOf(f.evaluate(consumer).value), f.run('WebAssembly.LinkError.prototype'));
  const plain = new modules.SourceTextModule('export const value = 42;', { context: f.realm });
  plain.linkRequests([]);
  plain.instantiate();
  assert.equal(f.evaluate(plain).state, 'fulfilled');
  assert.equal(plain.namespace.value, 42);
});

supportedTest('a re-export can carry a native v128 Global without reading its JavaScript value', () => {
  const f = fixture();
  const original = f.compileWasm(binary({ globals: [{ type: 0x7b, value: [0xfd, 0x0c, ...Array(16).fill(0)] }],
    exports: [['vector', 'global', 0]] }));
  const barrel = f.compile('export {vector} from "./original";');
  const consumer = f.compileWasm(binary({ imports: [['./barrel', 'vector', 'global', [0x7b, 0]]],
    exports: [['vector', 'global', 0]] }));
  f.link(consumer, new Map([[consumer, [barrel]], [barrel, [original]]]));
  const result = f.evaluate(consumer);
  assert.equal(result.state, 'fulfilled', result.value?.stack);
  assert.equal(consumer.instance.exports.vector, original.instance.exports.vector);
});

supportedTest('binding lookup initializes independently in a Node worker', async () => {
  const worker = new Worker(`
    const {fixture} = require(${JSON.stringify(require.resolve('./support/wasm.cjs'))});
    const {mutableGlobal, importGlobal} = require(${JSON.stringify(require.resolve('./support/wasm-fixtures.cjs'))});
    const f = fixture();
    const original = f.compileWasm(mutableGlobal());
    const barrel = f.compile('export {value} from "./original";');
    const consumer = f.compileWasm(importGlobal('./barrel'));
    f.link(consumer, new Map([[consumer, [barrel]], [barrel, [original]]]));
    const result = f.evaluate(consumer);
    if (result.state !== 'fulfilled') throw result.value;
    original.namespace.bump();
    require('node:worker_threads').parentPort.postMessage(consumer.namespace.read());
  `, { eval: true });
  const message = new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  const exit = new Promise(resolve => worker.once('exit', resolve));
  assert.equal(await message, 2);
  assert.equal(await exit, 0);
});
