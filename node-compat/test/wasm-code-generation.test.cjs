'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { Worker } = require('node:worker_threads');
const { assertCollected } = require('./support/gc.cjs');
const compat = require('../addon/index.cjs');

const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

test('Wasm compilation checks the registered realm on every compilation', async () => {
  const context = compat.createContextHandle();
  const wasm = compat.runInContext('WebAssembly', context);
  let allowed = true;
  let calls = 0;
  compat.setAllowWasmCodeGenerationCallback(context.realm, () => { calls++; return allowed; });
  const module = new wasm.Module(bytes);
  assert.ok(await wasm.compile(bytes) instanceof wasm.Module);
  allowed = false;
  assert.throws(() => new wasm.Module(bytes), wasm.CompileError);
  await assert.rejects(wasm.compile(bytes), wasm.CompileError);
  await assert.rejects(wasm.instantiate(bytes), wasm.CompileError);
  await assert.rejects(wasm.compileStreaming(new Response(bytes)), wasm.CompileError);
  await assert.rejects(wasm.instantiateStreaming(new Response(bytes)), wasm.CompileError);
  assert.equal(calls, 7);
  // Validation, instantiation of retained code, and cloning do not compile author bytes.
  assert.equal(wasm.validate(bytes), true);
  assert.ok(new wasm.Instance(module) instanceof wasm.Instance);
  assert.ok(await wasm.instantiate(module) instanceof wasm.Instance);
  assert.ok(compat.cloneWebAssemblyModule(module, context) instanceof wasm.Module);
  assert.equal(calls, 7);
  compat.setAllowWasmCodeGenerationCallback(context.realm, undefined);
  assert.ok(new wasm.Module(bytes) instanceof wasm.Module);
  assert.equal(calls, 7);
});

test('registered realms remain independent of each other and Node', async () => {
  const context = compat.createContextHandle();
  const other = compat.createContextHandle();
  const blocked = compat.runInContext('WebAssembly', context);
  const allowed = compat.runInContext('WebAssembly', other);
  compat.setAllowWasmCodeGenerationCallback(context.realm, () => false);
  assert.throws(() => new blocked.Module(bytes), blocked.CompileError);
  assert.ok(new allowed.Module(bytes) instanceof allowed.Module);
  assert.ok(new WebAssembly.Module(bytes) instanceof WebAssembly.Module);
  assert.ok(await WebAssembly.compile(bytes) instanceof WebAssembly.Module);
  assert.ok(await WebAssembly.compileStreaming(new Response(bytes, {
    headers: { 'Content-Type': 'application/wasm' },
  })) instanceof WebAssembly.Module);
});

test('Node VM denial survives registration, replacement, and removal', async () => {
  const context = vm.createContext({}, { codeGeneration: { wasm: false } });
  const wasm = vm.runInContext('WebAssembly', context);
  const realm = vm.runInContext('Object', context);
  for (const callback of [undefined, () => true, () => false, undefined]) {
    compat.setAllowWasmCodeGenerationCallback(realm, callback);
    assert.throws(() => new wasm.Module(bytes), wasm.CompileError);
    await assert.rejects(wasm.compile(bytes), wasm.CompileError);
  }
});

test('the policy stays on its context after global reuse', () => {
  const original = compat.createContextHandle();
  const wasm = compat.runInContext('WebAssembly', original);
  compat.setAllowWasmCodeGenerationCallback(original.realm, () => false);
  original.detachGlobal();
  const replacement = compat.createContextHandle({ reuseGlobalProxyFrom: original });
  const current = compat.runInContext('WebAssembly', replacement);
  assert.ok(new current.Module(bytes) instanceof current.Module);
  assert.throws(() => new wasm.Module(bytes), wasm.CompileError);
  compat.setAllowWasmCodeGenerationCallback(original.realm, undefined);
  assert.ok(new wasm.Module(bytes) instanceof wasm.Module);
});

test('discarded contexts and replaced policy closures can collect', async () => {
  function allocate() {
    const context = compat.createContextHandle();
    const policy = () => context.realm !== undefined;
    compat.setAllowWasmCodeGenerationCallback(context.realm, policy);
    return { context: new WeakRef(context), policy: new WeakRef(policy) };
  }
  await assertCollected(allocate());
  const context = compat.createContextHandle();
  function install() {
    const callback = () => true;
    compat.setAllowWasmCodeGenerationCallback(context.realm, callback);
    return { callback: new WeakRef(callback) };
  }
  const replaced = install();
  const removed = install();
  await assertCollected(replaced);
  compat.setAllowWasmCodeGenerationCallback(context.realm, undefined);
  await assertCollected(removed);
});

test('a Node worker loads and unloads its own compilation routing', async () => {
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    const compat = require(${JSON.stringify(require.resolve('../addon/index.cjs'))});
    const context = compat.createContextHandle();
    compat.setAllowWasmCodeGenerationCallback(context.realm, () => false);
    parentPort.postMessage(new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0])) instanceof WebAssembly.Module);
  `, { eval: true });
  const result = new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  const exited = new Promise((resolve) => worker.once('exit', resolve));
  assert.equal(await result, true);
  assert.equal(await exited, 0);
  assert.ok(new WebAssembly.Module(bytes) instanceof WebAssembly.Module);
});
