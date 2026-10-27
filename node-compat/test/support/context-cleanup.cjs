'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const compat = require('../../addon/index.cjs');

test('native contexts using Temporal shut down cleanly', () => {
  const realm = compat.createContextHandle({ microtaskQueue: compat.createMicrotaskQueue() });
  assert.equal(typeof compat.runInContext('Temporal.Now.instant().epochNanoseconds', realm), 'bigint');
  assert.equal(typeof compat.runInContext('Temporal.Now.instant().epochNanoseconds', realm), 'bigint');
});
