'use strict';

// Eric approved these three draft gaps during adoption. Keep the specification
// expectations: an unexpected pass means this classification needs reviewing.
const assert = require('node:assert/strict');
const { itPassesWith } = require('./support/test-runtime.cjs');
const { fixture } = require('./support/wasm.cjs');
const { binary, mutableGlobal, importGlobal } = require('./support/wasm-fixtures.cjs');
const test = itPassesWith('completeWasmBindings');

test('mutable Wasm globals remain live in JavaScript import bindings', () => {
  const f = fixture();
  const wasm = f.compileWasm(mutableGlobal());
  const js = f.compile('import { value, bump } from "./wasm"; export const read = () => value; export { bump };');
  f.link(js, new Map([[js, [wasm]]]));
  assert.equal(f.evaluate(js).state, 'fulfilled');
  const ns = js.namespace;
  assert.equal(ns.read(), 1);
  ns.bump();
  assert.equal(ns.read(), 2);
});

test('a v128 export stays in TDZ while other exports remain usable', () => {
  const f = fixture();
  const wasm = f.compileWasm(binary({ globals: [{ type: 0x7b, value: [0xfd, 0x0c, ...Array(16).fill(0)] }],
    functions: [{ code: [0x41, 42] }], exports: [['vector', 'global', 0], ['answer', 'function', 0]] }));
  f.link(wasm);
  assert.equal(f.evaluate(wasm).state, 'fulfilled');
  const ns = wasm.namespace;
  assert.equal(ns.answer(), 42);
  assert.throws(() => ns.vector, error => Object.getPrototypeOf(error) === f.run('ReferenceError.prototype'));
});

test('a Wasm global re-exported through JavaScript resolves to the original Wasm global', () => {
  const f = fixture();
  const original = f.compileWasm(mutableGlobal());
  const barrel = f.compile('export { value } from "./original";');
  const consumer = f.compileWasm(importGlobal('./barrel'));
  f.link(consumer, new Map([[consumer, [barrel]], [barrel, [original]]]));
  const result = f.evaluate(consumer);
  assert.equal(result.state, 'fulfilled', result.value?.stack);
  original.namespace.bump();
  assert.equal(consumer.namespace.read(), 2);
});
