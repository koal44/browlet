'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { assertCollected } = require('./support/gc.cjs');
const { fixture, compat } = require('./support/wasm.cjs');
const { constant } = require('./support/wasm-fixtures.cjs');

test('namespace lookup returns the existing Instance even when obtained only through an import', () => {
  const f = fixture();
  const wasm = f.compileWasm(constant());
  const root = f.compile('import * as ns from "./wasm"; export { ns };');
  f.link(root, new Map([[root, [wasm]]]));
  assert.equal(f.evaluate(root).state, 'fulfilled');
  const namespace = root.namespace.ns;
  const instance = compat.getWebAssemblyNamespaceInstance(namespace);
  assert.equal(instance, wasm.instance);
  assert.equal(instance.exports.answer, namespace.answer);
  assert.equal(instance.exports.answer(), 42);
  assert.equal(compat.getWebAssemblyNamespaceInstance(root.namespace), null);
  assert.equal(compat.getWebAssemblyNamespaceInstance(instance.exports), null);
  f.evaluate(root);
  assert.equal(compat.getWebAssemblyNamespaceInstance(namespace), instance);
});

test('a linked Wasm namespace is recognized without evaluating it', () => {
  const f = fixture();
  const wasm = f.compileWasm(constant());
  f.link(wasm);
  assert.equal(compat.getWebAssemblyNamespaceInstance(wasm.namespace), undefined);
  assert.equal(wasm.status, 'linked');
  f.evaluate(wasm);
  assert.equal(compat.getWebAssemblyNamespaceInstance(wasm.namespace), wasm.instance);
});

test('a Wasm dependency linked before its parent fails retains its namespace association', () => {
  const f = fixture();
  const wasm = f.compileWasm(constant());
  const parent = f.compile('import { missing } from "./wasm";');
  assert.throws(() => f.link(parent, new Map([[parent, [wasm]]])));
  f.link(wasm);
  f.evaluate(wasm);
  assert.equal(compat.getWebAssemblyNamespaceInstance(wasm.namespace), wasm.instance);
});

test('namespace lookup rejects forged namespaces, proxies, and ordinary JS or synthetic modules', () => {
  const f = fixture();
  const wasm = f.compileWasm(constant());
  f.link(wasm);
  f.evaluate(wasm);
  const js = f.compile('export { answer } from "./wasm";');
  f.link(js, new Map([[js, [wasm]]]));
  f.evaluate(js);
  const synthetic = new compat.SyntheticModule(['answer'], function() {
    this.setExport('answer', wasm.instance.exports.answer);
  }, { context: f.realm });
  const root = f.compile('export { answer } from "./synthetic";');
  f.link(root, new Map([[root, [synthetic]]]));
  f.evaluate(root);
  const trap = () => { throw new Error('lookup must not inspect the argument'); };
  const proxy = new Proxy(wasm.namespace, { get: trap, getPrototypeOf: trap, ownKeys: trap });
  const revoked = Proxy.revocable(wasm.namespace, {});
  revoked.revoke();
  for (const candidate of [null, undefined, 7, {}, js.namespace, synthetic.namespace,
    { [Symbol.toStringTag]: 'Module', answer: wasm.namespace.answer }, proxy, revoked.proxy]) {
    assert.equal(compat.getWebAssemblyNamespaceInstance(candidate), null);
  }
});

test('identical modules and different contexts retain distinct namespace associations', () => {
  const first = fixture();
  const second = fixture();
  const modules = [first.compileWasm(constant()), first.compileWasm(constant()), second.compileWasm(constant())];
  modules.forEach((module, index) => {
    const f = index === 2 ? second : first;
    f.link(module);
    f.evaluate(module);
    assert.equal(compat.getWebAssemblyNamespaceInstance(module.namespace), module.instance);
  });
  assert.equal(new Set(modules.map(module => compat.getWebAssemblyNamespaceInstance(module.namespace))).size, 3);
});

test('a retained namespace owns its Instance without the public module wrapper', async () => {
  const f = fixture();
  let wasm = f.compileWasm(constant());
  f.link(wasm);
  f.evaluate(wasm);
  const namespace = wasm.namespace;
  const instance = wasm.instance;
  const reference = new WeakRef(wasm);
  wasm = undefined;
  await assertCollected(reference);
  assert.equal(compat.getWebAssemblyNamespaceInstance(namespace), instance);
  assert.equal(instance.exports.answer(), 42);
});
