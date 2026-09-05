'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { test } = require('node:test');

test('addon rejects a selected official base that differs from the running Node', () => {
  const base = process.versions.node === '26.8.1' ? '24.19.0' : '26.8.1';
  const child = spawnSync(process.execPath, ['-e',
    `require(${JSON.stringify(resolve(__dirname, '../addon/index.cjs'))})`,
  ], { env: { ...process.env, NODE_BASE: base }, encoding: 'utf8' });
  assert.notEqual(child.status, 0, 'a different NODE_BASE must not load the current runtime addon');
  assert.match(child.stderr, /NODE_BASE.*requires Node.*running/);
});

test('CLI overrides environment settings and preserves test arguments', () => {
  const { parseOptions } = require('../node-base.cjs');
  assert.deepEqual(parseOptions([
    '--runtime', 'stock', '--base', '26.8.1', 'test:unit', '--', '--maxWorkers=2',
  ], { NODE_BASE: 'custom', NODE_RUNTIME: 'compat' }), {
    base: '26.8.1', runtime: 'stock', args: ['test:unit', '--', '--maxWorkers=2'],
  });
  assert.throws(() => parseOptions(['--base'], {}), /--base requires a value/);
  assert.throws(() => parseOptions(['--base', '../elsewhere'], {}), /NODE_BASE/);
  assert.throws(() => parseOptions([], { NODE_RUNTIME: 'addon' }), /NODE_RUNTIME/);
});

for (const runtime of ['stock', 'compat']) {
  test(`test launcher runs Node arguments with the selected ${runtime} backend`, () => {
    const child = spawnSync(process.execPath, [
      resolve(__dirname, '../../scripts/with-node.mjs'), '--runtime', runtime, 'node',
      '--eval', `console.log(JSON.stringify({
        executable: process.execPath,
        runtime: process.env.NODE_RUNTIME,
        addon: process.env.BROWLET_NODE_ADDON !== undefined &&
          typeof require(process.env.BROWLET_NODE_ADDON).createMicrotaskQueue === 'function',
        args: process.argv.slice(1),
      }))`, '--', 'argument with spaces', '--test-filter',
    ], { env: { ...process.env, BROWLET_NODE_ADDON: 'must-be-replaced' }, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout.trim().split('\n').at(-1)), {
      executable: process.execPath, runtime, addon: runtime === 'compat',
      args: ['argument with spaces', '--test-filter'],
    });
  });
}

test('test launcher preserves a failing child exit status', () => {
  const child = spawnSync(process.execPath, [
    resolve(__dirname, '../../scripts/with-node.mjs'), '--runtime', 'stock', 'node',
    '--eval', 'process.exit(73)',
  ], { env: process.env, encoding: 'utf8' });
  assert.equal(child.status, 73, child.stderr);
});

test('each base has its own addon output', () => {
  const { addonBuild } = require('../node-base.cjs');
  const outputs = ['24.19.0', '26.8.1', 'custom'].map(addonBuild);
  assert.equal(new Set(outputs).size, 3);
  assert.throws(() => addonBuild('../elsewhere'), /NODE_BASE/);
});

test('custom paths all derive from the configured source directory', t => {
  const { resolveBase, inspectNode } = require('../node-base.cjs');
  const source = temporaryDirectory(t);
  const target = resolveBase('custom', { CUSTOM_NODE_SOURCE: source });
  assert.equal(target.executable, join(source, 'out/Release/node.exe'));
  assert.equal(target.library, join(source, 'out/Release/node.lib'));
  assert.deepEqual(target.includes, [join(source, 'src'), join(source, 'deps/v8/include'), join(source, 'deps/uv/include')]);
  assert.throws(() => inspectNode(target), /Node executable.*Build Node.*CUSTOM_NODE_SOURCE/s);
  assert.throws(() => resolveBase('custom', {}), /CUSTOM_NODE_SOURCE/);
  assert.throws(() => resolveBase('custom', { CUSTOM_NODE_SOURCE: 'relative/node' }), /absolute/);
});

test('official base validates the executable version', () => {
  const { resolveBase, inspectNode } = require('../node-base.cjs');
  const base = process.versions.node === '26.8.1' ? '24.19.0' : '26.8.1';
  const target = { ...resolveBase(base), executable: process.execPath };
  assert.equal(inspectNode({ ...target, base: 'custom' }).version, process.versions.node);
  assert.throws(() => inspectNode(target), /requires Node.*running/);
});

test('building rejects missing libraries and headers for a different runtime', t => {
  const { resolveBase, validateBuildInputs } = require('../node-base.cjs');
  const directory = temporaryDirectory(t);
  const target = { ...resolveBase('24.19.0'), includes: [directory],
    library: join(directory, 'node.lib'), versionHeader: join(directory, 'node_version.h') };
  assert.throws(() => validateBuildInputs(target,
    { version: '24.19.0' }), /Node import library/);
  for (const file of ['node.lib', 'node.h', 'v8.h', 'uv.h']) writeFileSync(join(directory, file), '');
  writeFileSync(target.versionHeader, '#define NODE_MAJOR_VERSION 23\n#define NODE_MINOR_VERSION 0\n#define NODE_PATCH_VERSION 0\n');
  assert.throws(() => validateBuildInputs(target,
    { version: '26.8.1' }), /headers.*23.0.0.*executable.*26.8.1/);
});

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'browlet-node-base-'));
  t.after(() => {
    assert.equal(directory.startsWith(join(tmpdir(), 'browlet-node-base-')), true);
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
