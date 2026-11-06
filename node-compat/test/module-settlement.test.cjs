'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { test } = require('node:test');

for (const scenario of ['node', 'addon', 'throwing-hook', 'nested-init', 'timeout']) {
  test(`settlement observation preserves reporting: ${scenario}`, () => {
    run('module-settlement-child.cjs', scenario);
  });
}

for (const scenario of ['callback', 'hook-last', 'same-error', 'top-level-await']) {
  test(`settlement observation preserves genuine errors: ${scenario}`, () => {
    run('settlement-reporting-child.cjs', scenario);
  });
}

test('settlement observation preserves Node Promise tracing', () => {
  const output = run('module-settlement-child.cjs', 'notification', ['--trace-promises']);
  assert.match(output, /\[--trace-promises\] created promise/);
  assert.match(output, /\[--trace-promises\] resolved promise/);
});

function run(script, scenario, flags = []) {
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', ...flags,
    join(__dirname, 'support', script), scenario],
  { encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout + result.stderr;
}
