'use strict';

// Same three requirements through Node's own ESM loader, without any addon.
// These retain the same approved expected failures without using the addon.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { binary, mutableGlobal, importGlobal } = require('./support/wasm-fixtures.cjs');
const wasmURL = bytes => `data:application/wasm;base64,${Buffer.from(bytes).toString('base64')}`;

// Keep this control independent of test-runtime.cjs, which loads the addon.
const expectedFailure = (name, run) => test(`${name} [expected failure]`, () =>
  assert.rejects(run, 'Expected the known Node Wasm binding gap to fail'));

expectedFailure('Node control: a mutable Wasm global stays live through an ESM binding', async () => {
  const ns = await import(wasmURL(mutableGlobal()));
  assert.equal(ns.value, 1);
  ns.bump();
  assert.equal(ns.read(), 2);
  assert.equal(ns.value, 2);
});

expectedFailure('Node control: a v128 export remains in TDZ', async () => {
  const bytes = binary({ globals: [{ type: 0x7b, value: [0xfd, 0x0c, ...Array(16).fill(0)] }],
    functions: [{ code: [0x41, 42] }], exports: [['vector', 'global', 0], ['answer', 'function', 0]] });
  const ns = await import(wasmURL(bytes));
  assert.equal(ns.answer(), 42);
  assert.throws(() => ns.vector, ReferenceError);
});

expectedFailure('Node control: Wasm imports a mutable global re-exported through JavaScript', async () => {
  const original = wasmURL(mutableGlobal());
  const source = `export { value } from ${JSON.stringify(original)};`;
  const barrel = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const ns = await import(wasmURL(importGlobal(barrel)));
  const originalNs = await import(original);
  const before = ns.read();
  originalNs.bump();
  assert.equal(ns.read(), before + 1);
});
