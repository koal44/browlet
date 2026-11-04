'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { MessageChannel, moveMessagePortToContext, receiveMessageOnPort } = require('node:worker_threads');
const compat = require('../addon/index.cjs');

test('Wasm cloning creates destination-owned Modules without reading author properties', () => {
  const source = compat.createContextHandle();
  const target = compat.createContextHandle();
  const module = compat.runInContext('new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0]))', source);
  const prototype = target.globalProxy.WebAssembly.Module.prototype;
  target.globalProxy.WebAssembly.Module = () => { throw new Error('constructor'); };
  Object.setPrototypeOf(module, null);
  Object.defineProperty(module, 'constructor', { get() { throw new Error('source property'); }, enumerable: true });
  const clone = compat.cloneWebAssemblyModule(module, target);
  assert.notEqual(clone, module);
  assert.equal(compat.getRealm(clone), target.realm);
  assert.equal(compat.getRealm(module), source.realm);
  assert.equal(Object.getPrototypeOf(clone), prototype);
  assert.equal(Object.hasOwn(clone, 'constructor'), false);
  assert.ok(new WebAssembly.Instance(clone) instanceof WebAssembly.Instance);
  assert.notEqual(compat.cloneWebAssemblyModule(module, source), module);
});

test('Wasm cloning rejects invalid Modules and detached or invalid contexts', () => {
  const target = compat.createContextHandle();
  const module = new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0]));
  for (const value of [undefined, {}, new Proxy(module, {}), new WebAssembly.Instance(module)]) {
    assert.throws(() => compat.cloneWebAssemblyModule(value, target), /Expected a WebAssembly.Module/);
  }
  assert.throws(() => compat.cloneWebAssemblyModule(module, {}), { code: 'ERR_INVALID_ARG_TYPE' });
  target.detachGlobal();
  assert.throws(() => compat.cloneWebAssemblyModule(module, target), { code: 'ERR_CONTEXT_NOT_INITIALIZED' });
});

test('stock MessagePort receipt allocates Modules in the port creation context', () => {
  // The addon observes the native owner; transport itself uses public Node APIs.
  const context = vm.createContext(vm.constants.DONT_CONTEXTIFY);
  const anchor = vm.runInContext('({})', context);
  const module = new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0]));
  const channel = new MessageChannel();
  let receiver = channel.port2;
  try {
    receiver = moveMessagePortToContext(receiver, context);
    channel.port1.postMessage(module);
    const clone = receiveMessageOnPort(receiver).message;
    assert.notEqual(clone, module);
    assert.equal(compat.getRealm(clone), compat.getRealm(anchor));
    assert.equal(Object.getPrototypeOf(clone), vm.runInContext('WebAssembly.Module.prototype', context));
    assert.ok(new WebAssembly.Instance(clone) instanceof WebAssembly.Instance);
  } finally {
    channel.port1.close();
    receiver.close();
  }
});
