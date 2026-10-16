'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { MessageChannel, moveMessagePortToContext, receiveMessageOnPort } = require('node:worker_threads');
const compat = require('../addon/index.cjs');
const { itPassesWith } = require('./support/test-runtime.cjs');

for (const growable of [false, true]) {
  test(`shared-buffer clones belong to the destination context (growable=${growable})`, () => {
    const source = compat.createContextHandle();
    const destination = compat.createContextHandle();
    const buffer = compat.runInContext(growable
      ? 'new SharedArrayBuffer(4, { maxByteLength: 16 })'
      : 'new SharedArrayBuffer(4)', source);
    const prototype = destination.globalProxy.SharedArrayBuffer.prototype;
    // Native allocation must ignore constructor replacements and source properties.
    destination.globalProxy.SharedArrayBuffer = () => { throw new Error('constructor'); };
    for (const name of ['constructor', 'byteLength', 'maxByteLength', 'growable']) {
      Object.defineProperty(buffer, name, { get() { throw new Error(name); } });
    }
    const clone = compat.cloneSharedArrayBuffer(buffer, destination);
    assert.notEqual(clone, buffer);
    assert.equal(compat.getRealm(clone), destination.realm);
    assert.equal(compat.getRealm(buffer), source.realm);
    assert.equal(Object.getPrototypeOf(clone), prototype);
    assert.equal(clone.byteLength, 4);
    assert.equal(clone.maxByteLength, growable ? 16 : 4);
    assert.equal(clone.growable, growable);
    new Uint8Array(buffer)[0] = 17;
    assert.equal(new Uint8Array(clone)[0], 17);
    new Uint8Array(clone)[1] = 23;
    assert.equal(new Uint8Array(buffer)[1], 23);
    if (growable) {
      clone.grow(8);
      assert.equal(new Uint8Array(buffer).length, 8);
      SharedArrayBuffer.prototype.grow.call(buffer, 16);
      assert.equal(clone.byteLength, 16);
    }
  });
}

test('shared-buffer allocation rejects invalid buffers and unusable contexts', () => {
  const destination = compat.createContextHandle();
  const buffer = new SharedArrayBuffer(4);
  for (const value of [undefined, {}, new ArrayBuffer(4), new Proxy(buffer, {})]) {
    assert.throws(() => compat.cloneSharedArrayBuffer(value, destination), /Expected a SharedArrayBuffer/);
  }
  assert.throws(() => compat.cloneSharedArrayBuffer(buffer, {}), { code: 'ERR_INVALID_ARG_TYPE' });
  destination.detachGlobal();
  assert.throws(() => compat.cloneSharedArrayBuffer(buffer, destination), { code: 'ERR_CONTEXT_NOT_INITIALIZED' });
});

test('stock MessagePort receipt allocates shared buffers in the port creation context', () => {
  // Use the addon only as an oracle: prototype checks cannot establish a native
  // creation realm. This verifies the public Node APIs used by the stock fallback.
  const context = vm.createContext(vm.constants.DONT_CONTEXTIFY);
  const anchor = vm.runInContext('({})', context);
  for (const growable of [false, true]) {
    const buffer = new SharedArrayBuffer(4, growable ? { maxByteLength: 8 } : undefined);
    const channel = new MessageChannel();
    let receiver = channel.port2;
    try {
      receiver = moveMessagePortToContext(receiver, context);
      channel.port1.postMessage(buffer);
      const clone = receiveMessageOnPort(receiver).message;
      assert.equal(compat.getRealm(clone), compat.getRealm(anchor));
      assert.notEqual(clone, buffer);
      assert.equal(clone.growable, growable);
      new Uint8Array(clone)[0] = 17;
      assert.equal(new Uint8Array(buffer)[0], 17);
      if (growable) {
        clone.grow(8);
        assert.equal(buffer.byteLength, 8);
      }
    } finally {
      channel.port1.close();
      receiver.close();
    }
  }
});

itPassesWith('lengthTracking')('length tracking is queried without touching a view or its backing storage', () => {
  const query = compat.isLengthTrackingArrayBufferView;
  const realm = compat.createContextHandle();
  const { buffer, shared, fixed, tracking } = compat.runInContext(`(() => {
    const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
    const shared = new SharedArrayBuffer(8, { maxByteLength: 16 });
    new Uint8Array(buffer).set([1, 2, 3, 4, 5, 6, 7, 8]);
    const fixed = [new Uint8Array(8), new DataView(new ArrayBuffer(8))];
    const tracking = [];
    for (const storage of [buffer, shared]) {
      for (const View of [Uint8Array, Uint16Array, BigInt64Array, DataView]) {
        fixed.push(new View(storage, 0, 1));
        tracking.push(new View(storage));
      }
    }
    for (const view of [...fixed, ...tracking]) {
      for (const key of ['buffer', 'byteLength', 'length']) {
        Object.defineProperty(view, key, { get() { throw new Error(key); } });
      }
    }
    return { buffer, shared, fixed, tracking };
  })()`, realm);
  const check = () => {
    for (const view of fixed) assert.equal(query(view), false);
    for (const view of tracking) assert.equal(query(view), true);
  };
  check();
  assert.deepEqual([...new Uint8Array(buffer)], [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(buffer.byteLength, 8);
  assert.equal(shared.byteLength, 8);
  buffer.resize(0);
  shared.grow(16);
  check();
  buffer.transfer();
  check();
  assert.throws(() => query({}), TypeError);
  assert.throws(() => query(new Proxy(tracking[0], {})), TypeError);
});
