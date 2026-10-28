'use strict';

const assert = require('node:assert/strict');
const { fixture } = require('./support/wasm.cjs');
const { constant, callImport } = require('./support/wasm-fixtures.cjs');
const { itPassesWith } = require('./support/test-runtime.cjs');
const test = itPassesWith('dynamicImport');

test('dynamic source imports return the retained Wasm source without linking or instantiating dependencies', () => {
  const f = fixture();
  const wasm = f.compileWasm(callImport('./not-loaded'));
  const calls = [];
  const root = f.compile('export const source = await import.source("./wasm");', 'source.js', {
    importModuleDynamically(specifier, referrer, attributes, phase) {
      calls.push({ specifier, referrer, phase });
      assert.deepEqual(Reflect.ownKeys(attributes), []);
      return wasm;
    },
  });
  f.link(root);
  assert.equal(f.evaluate(root).state, 'fulfilled');
  assert.equal(root.namespace.source, wasm.source);
  assert.equal(wasm.instance, undefined);
  assert.equal(wasm.status, 'unlinked');
  assert.deepEqual(calls, [{ specifier: './wasm', referrer: root, phase: 'source' }]);
});

test('dynamic evaluation imports return the existing Wasm namespace in the author queue', () => {
  const f = fixture();
  const wasm = f.compileWasm(constant());
  f.link(wasm);
  const root = f.compile('export const answer = (await import("./wasm")).answer();', 'instance.js', {
    importModuleDynamically(specifier, referrer, attributes, phase) {
      assert.equal(specifier, './wasm');
      assert.equal(referrer, root);
      assert.deepEqual(Reflect.ownKeys(attributes), []);
      assert.equal(phase, 'evaluation');
      return f.run('(promise, module) => promise.then(() => module)')(wasm.evaluate(), wasm);
    },
  });
  f.link(root);
  assert.equal(f.evaluate(root).state, 'fulfilled');
  assert.equal(root.namespace.answer, 42);
});

test('dynamic source imports reject a JavaScript module or namespace instead of returning a bogus source', () => {
  const f = fixture();
  const dependency = f.compile('export const value = 42;');
  f.link(dependency);
  f.evaluate(dependency);
  for (const value of [dependency, dependency.namespace]) {
    const root = f.compile('await import.source("./js");', 'invalid.js', {
      importModuleDynamically: () => value,
    });
    f.link(root);
    const result = f.evaluate(root);
    assert.equal(result.state, 'rejected');
    assert.match(result.value.message, /WebAssemblyModule/u);
  }
});
