'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

test('native context cleanup leaves pending weak callbacks safe', () => {
  // Check the child exit status: the regression crashes after its assertions pass.
  // Temporal needs its feature flag on Node 24.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, [
    '--harmony-temporal', '--test', require.resolve('./support/context-cleanup.cjs'),
  ], { env, encoding: 'utf8', timeout: 10000 });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stdout + child.stderr);
});
