'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { Worker } = require('node:worker_threads');
const compat = require('../addon/index.cjs');
const native = require('./support/native-vm.cjs');
const { binary } = require('./support/wasm-fixtures.cjs');
const { assertCollected } = require('./support/gc.cjs');

for (const multiple of [false, true]) {
  for (const throws of [false, true]) {
    test(`native result conversion finishes inside the call (multiple: ${multiple}, throws: ${throws})`, () => {
      const module = imported([], multiple ? [i32, i32] : [i32]);
      let active = false;
      const states = [];
      const marker = new Error('author conversion');
      const value = { valueOf() { states.push(active); if (throws) throw marker; return 7; } };
      const callback = () => multiple ? {
        *[Symbol.iterator]() { states.push(active); yield value; yield 9; },
      } : value;
      const convert = compat.createWebAssemblyImportCall(module, 0, callback, WebAssembly.Instance);
      const run = new WebAssembly.Instance(module, {
        env: { fn: () => { active = true; try { return convert(); } finally { active = false; } } },
      }).exports.run;
      if (throws) assert.throws(run, error => error === marker);
      else assert.deepEqual(run(), multiple ? [7, 9] : 7);
      assert.equal(active, false);
      assert(states.length > 0 && states.every(Boolean));
    });
  }
}

test('preserves numeric and reference values, zero results, and separate callbacks sharing a signature', () => {
  const object = { valueOf() { throw new Error('externref coerced'); } };
  for (const [type, value] of [[i32, -17], [i64, 9n], [0x7d, 0.5], [0x7c, -0], [0x6f, object], [0x70, null]]) {
    const module = imported([type], [type]);
    const call = compat.createWebAssemblyImportCall(module, 0, x => x, WebAssembly.Instance);
    assert(Object.is(call(value), value));
  }
  const module = imported([], [i32]);
  const first = compat.createWebAssemblyImportCall(module, 0, () => 1, WebAssembly.Instance);
  const second = compat.createWebAssemblyImportCall(module, 0, () => 2, WebAssembly.Instance);
  assert.equal(first(), 1);
  assert.equal(second(), 2);
  assert.equal(first(), 1);
  assert.equal(compat.createWebAssemblyImportCall(imported([], []), 0, () => object, WebAssembly.Instance)(), undefined);
});

test('reads function signatures after mixed import kinds and repeated names', () => {
  const module = new WebAssembly.Module(binary({
    types: [[[], [i32]], [[], [i64]], [[], []]],
    imports: [
      ['env', 'global', 'global', [i32, 0]], ['env', 'memory', 'memory', [1, 1, 2]],
      ['env', 'table', 'table', [0x70, 1, 0, 2]], ['env', 'tag', 'tag', [0, 2]],
      ['env', 'fn', 'function', [0]], ['env', 'fn', 'function', [1]],
    ],
  }));
  assert.equal(compat.createWebAssemblyImportCall(module, 4, () => 3, WebAssembly.Instance)(), 3);
  assert.equal(compat.createWebAssemblyImportCall(module, 5, () => 4n, WebAssembly.Instance)(), 4n);
});

test('retains GC recursive-group references and canonical types', () => {
  const module = new WebAssembly.Module(new Uint8Array(gcModule));
  const identity = compat.createWebAssemblyImportCall(module, 0, value => value, WebAssembly.Instance);
  const instance = new WebAssembly.Instance(module, { env: { fn: identity } });
  const object = instance.exports.create();
  assert.equal(identity(object), object);
  assert.throws(() => identity({}), TypeError);
});

test('uses the supplied Instance realm for conversion errors and ignores replaced exports/Array iteration', () => {
  const foreign = vm.runInNewContext('({ Instance: WebAssembly.Instance, TypeError, Array })');
  Object.defineProperty(foreign.Instance.prototype, 'exports', { get() { throw new Error('author exports getter'); } });
  foreign.Array.prototype[Symbol.iterator] = () => { throw new Error('author array iterator'); };
  const invalid = compat.createWebAssemblyImportCall(imported([], [i64]), 0, () => 1, foreign.Instance);
  assert.throws(invalid, foreign.TypeError);
  const module = imported([], [i32, i32]);
  const convert = compat.createWebAssemblyImportCall(module, 0, function*() { yield 3; yield 4; }, foreign.Instance);
  assert.deepEqual(new WebAssembly.Instance(module, { env: { fn: convert } }).exports.run(), [3, 4]);
});

test('defers revoked Proxy errors until invocation and retains thrown author identities', () => {
  const { proxy, revoke } = Proxy.revocable(() => 1, {});
  revoke();
  const module = imported([], [i32]);
  const convert = compat.createWebAssemblyImportCall(module, 0, proxy, WebAssembly.Instance);
  assert.throws(convert, TypeError);
  const marker = {};
  const throws = compat.createWebAssemblyImportCall(module, 0, () => { throw marker; }, WebAssembly.Instance);
  assert.throws(throws, error => error === marker);
});

test('handles multibyte type indices and copies bytes without changing the source Module', () => {
  const module = new WebAssembly.Module(binary({
    types: [...Array.from({ length: 130 }, () => [[], []]), [[], [i32]]],
    imports: [['env', 'fn', 'function', [0x82, 1]]],
  }));
  const original = native.getWasmModuleBytes(module);
  native.getWasmModuleBytes(module).fill(0);
  assert.deepEqual(native.getWasmModuleBytes(module), original);
  assert.equal(compat.createWebAssemblyImportCall(module, 0, () => 15, WebAssembly.Instance)(), 15);
  assert.throws(() => native.getWasmModuleBytes({}), TypeError);
  assert.throws(() => native.compileWasmImportBridge({}), TypeError);
});

test('converting an existing foreign Module preserves disabled author compilation and reflection', () => {
  const context = vm.createContext({}, { codeGeneration: { wasm: false } });
  const foreign = vm.runInContext('({ Instance: WebAssembly.Instance, Module: WebAssembly.Module, CompileError: WebAssembly.CompileError })', context);
  const module = imported([], [i32]);
  const bytes = native.getWasmModuleBytes(module);
  assert.throws(() => new foreign.Module(bytes), foreign.CompileError);
  assert.equal(compat.createWebAssemblyImportCall(module, 0, () => 16, foreign.Instance)(), 16);
  assert.throws(() => new foreign.Module(bytes), foreign.CompileError);
  assert.equal(Object.hasOwn(WebAssembly.Module.imports(module)[0], 'type'), false);
});

test('the metadata cache does not retain Modules, callbacks, or foreign realms', async () => {
  const references = (() => {
    const module = imported([], [i32]);
    const context = vm.createContext({});
    const foreign = vm.runInContext('({ Instance: WebAssembly.Instance, callback: () => 7 })', context);
    const call = compat.createWebAssemblyImportCall(module, 0, foreign.callback, foreign.Instance);
    assert.equal(call(), 7);
    return { module: new WeakRef(module), callback: new WeakRef(foreign.callback), realm: new WeakRef(context) };
  })();
  await assertCollected(references);
});

test('worker isolates compile their own import converters', async () => {
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const compat = require(workerData.addon);
    const module = new WebAssembly.Module(workerData.bytes);
    parentPort.postMessage(compat.createWebAssemblyImportCall(module, 0, () => 19, WebAssembly.Instance)());
  `, { eval: true, workerData: { addon: require.resolve('../addon/index.cjs'), bytes: native.getWasmModuleBytes(imported([], [i32])) } });
  const value = await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  assert.equal(value, 19);
  await worker.terminate();
});

function imported(parameters, results) {
  return new WebAssembly.Module(binary({ types: [[parameters, results]],
    imports: [['env', 'fn', 'function', [0]]], exports: [['run', 'function', 0]] }));
}

const i32 = 0x7f, i64 = 0x7e;
// (rec (type $s (struct (field (mut i32)))) (type $fn (func (param (ref $s)) (result (ref $s)))))
// (import "env" "fn" (func (type $fn)))
// (func (export "create") (result (ref $s)) (struct.new_default $s))
const gcModule = [
  0, 97, 115, 109, 1, 0, 0, 0,
  1, 19, 2, 0x4e, 2, 0x5f, 1, 0x7f, 1, 0x60, 1, 0x64, 0, 1, 0x64, 0, 0x60, 0, 1, 0x64, 0,
  2, 10, 1, 3, 101, 110, 118, 2, 102, 110, 0, 1,
  3, 2, 1, 2, 7, 10, 1, 6, 99, 114, 101, 97, 116, 101, 0, 1,
  10, 7, 1, 5, 0, 0xfb, 1, 0, 0x0b,
];
