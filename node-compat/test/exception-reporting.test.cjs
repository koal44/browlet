'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { test } = require('node:test');
const { itPassesWith } = require('./support/test-runtime.cjs');

function childPass(mode, flags = []) {
  const child = spawnSync(process.execPath, [
    ...flags, '--expose-gc', join(__dirname, 'support/exception-reporting.fixture.cjs'), mode,
  ], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout, new RegExp(`PASS: ${mode}`));
}

test('reports registry-owned errors and preserves Node monitor/uncaught handlers', () => childPass('ordinary'));
test('reports before Node primary capture and preserves Node async context', () => childPass('primary'));
test('reporter failures return to Node without recursion', () => childPass('reporter-failure'));
test('the reporter and context can be collected together', () => childPass('collection'));

test('registering a context does not disable the abort flag for Node-owned errors', () => {
  const child = spawnSync(process.execPath, ['--abort-on-uncaught-exception', '-e', `
    const compat = require(${JSON.stringify(require.resolve('../addon/index.cjs'))});
    const queue = compat.createMicrotaskQueue();
    const context = compat.createContextHandle({ microtaskQueue: queue });
    compat.setExceptionReporter(context, () => console.log('WRONG REPORTER'));
    process.on('uncaughtException', () => console.log('WRONG HANDLER'));
    setImmediate(() => { throw new Error('Node-owned failure'); });
  `], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.ifError(child.error);
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /Node-owned failure/);
  assert.doesNotMatch(child.stdout, /WRONG/);
});

// Approved fallback limit: official Node aborts before its private JS handler.
// The custom Node hook routes registered contexts before that policy applies.
itPassesWith('contextExceptionReporter')('reports owned errors under the explicit abort flag', () => {
  childPass('abort', ['--abort-on-uncaught-exception']);
});
