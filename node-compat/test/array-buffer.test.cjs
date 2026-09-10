'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const compat = require('../addon/index.cjs');

test('length tracking is queried without touching a view or its backing storage', {
  skip: typeof compat.isLengthTrackingArrayBufferView !== 'function' &&
    'This engine does not expose ArrayBufferView::IsLengthTracking',
}, () => {
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
