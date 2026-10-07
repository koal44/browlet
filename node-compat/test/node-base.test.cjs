'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join, relative, resolve } = require('node:path');
const { test } = require('node:test');

const windows = process.platform === 'win32';
const selectedBase = process.env.NODE_BASE ?? '24.19.0';
const rejectDownloads = 'data:text/javascript,' + encodeURIComponent(
  'globalThis.fetch = () => { throw new Error("Unexpected download"); };',
);

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

test('stock launcher runs the selected executable without headers or an addon', t => {
  const { resolveBase } = require('../node-base.cjs');
  const launcher = isolatedScript(t, 'with-node.mjs');
  const source = resolveBase(selectedBase);
  const directory = resolve(dirname(launcher), selectedBase === 'custom'
    ? '../node-source' : `../node-compat/.cache/node-v${selectedBase}`);
  const executable = join(directory, relative(source.directory, source.executable));
  mkdirSync(dirname(executable), { recursive: true });
  copyFileSync(source.executable, executable);
  const child = spawnSync(process.execPath, [launcher, '--base', selectedBase, '--runtime', 'stock', 'node',
    '--eval', `console.log(JSON.stringify({
      executable: process.execPath,
      version: process.versions.node,
      addon: process.env.BROWLET_NODE_ADDON ?? null,
    }))`,
  ], { env: { ...process.env, CUSTOM_NODE_SOURCE: directory, BROWLET_NODE_ADDON: 'must-be-removed' }, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout.trim().split('\n').at(-1)), {
    executable, version: process.versions.node, addon: null,
  });
  assert.equal(existsSync(join(directory, 'include')), false);
  assert.equal(existsSync(resolve(dirname(launcher), '../node-compat/addon')), false);
});

test('stock launcher does not substitute the running Node for a missing selected executable', t => {
  const launcher = isolatedScript(t, 'with-node.mjs');
  const child = spawnSync(process.execPath, [launcher,
    '--base', selectedBase, '--runtime', 'stock', 'node', '--eval', 'process.exit(0)',
  ], { env: { ...process.env, CUSTOM_NODE_SOURCE: resolve(dirname(launcher), '../node-source') }, encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /Missing Node executable/);
  assert.doesNotMatch(child.stderr, /build:node/);
});

test('Node installer reuses verified official inputs without building an addon', {
  skip: selectedBase === 'custom' && 'Custom builds do not use the official runtime installer',
}, t => {
  const { resolveBase } = require('../node-base.cjs');
  const installer = isolatedScript(t, 'install-node.mjs');
  const source = resolveBase(selectedBase).directory;
  const directory = resolve(dirname(installer), `../node-compat/.cache/node-v${selectedBase}`);
  const files = windows ? ['node.exe', 'Release/node.lib', ...[
    'node.h', 'node_version.h', 'v8.h', 'v8-isolate.h', 'uv.h',
  ].map(name => `include/node/${name}`)] : ['linux-x64.tar.xz'];
  for (const file of files) {
    const target = join(directory, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(source, file), target);
  }
  const child = spawnSync(process.execPath, ['--import', rejectDownloads,
    installer, '--base', selectedBase,
  ], { env: process.env, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.ok(child.stdout.includes(`Prepared Node ${selectedBase}`), child.stdout);
  assert.equal(existsSync(join(directory, 'include/node/node.h')), true);
  assert.equal(existsSync(resolve(dirname(installer), '../node-compat/addon')), false);
});

test('Node installer rejects a cached runtime artifact with the wrong checksum', t => {
  const installer = isolatedScript(t, 'install-node.mjs');
  const artifact = resolve(dirname(installer), '../node-compat/.cache/node-v24.19.0',
    windows ? 'node.exe' : 'linux-x64.tar.xz');
  mkdirSync(dirname(artifact), { recursive: true });
  writeFileSync(artifact, 'corrupt runtime');
  const child = spawnSync(process.execPath, ['--import', rejectDownloads,
    installer, '--base', '24.19.0',
  ], { env: process.env, encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.ok(child.stderr.includes(`Hash mismatch: ${artifact}`), child.stderr);
});

test('Node installer leaves custom engine builds to the configured source checkout', t => {
  const child = spawnSync(process.execPath, ['--import', rejectDownloads,
    isolatedScript(t, 'install-node.mjs'), '--base', 'custom',
  ], { env: process.env, encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /Custom Node builds are supplied through CUSTOM_NODE_SOURCE/);
});

test('addon build requires installed Node inputs without downloading them', t => {
  const child = spawnSync(process.execPath, ['--import', rejectDownloads,
    isolatedScript(t, 'build-node-compat.mjs'), '--base', '24.19.0',
  ], { env: process.env, encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /Missing Node executable.*npm run install:node -- --base 24\.19\.0/s);
});

for (const runtime of ['stock', 'compat']) {
  test(`test launcher runs Node arguments with the selected ${runtime} backend`, () => {
    const { resolveBase } = require('../node-base.cjs');
    const target = resolveBase(selectedBase);
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
      executable: target.executable,
      runtime, addon: runtime === 'compat',
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
  assert.equal(target.executable, join(source, windows ? 'out/Release/node.exe' : 'out/Release/node'));
  assert.equal(target.library, windows ? join(source, 'out/Release/node.lib') : undefined);
  assert.deepEqual(target.includes, [join(source, 'src'), join(source, 'deps/v8/include'), join(source, 'deps/uv/include')]);
  assert.throws(() => inspectNode(target), /Node executable.*Build Node.*CUSTOM_NODE_SOURCE/s);
  assert.throws(() => resolveBase('custom', {}), /CUSTOM_NODE_SOURCE/);
  assert.throws(() => resolveBase('custom', { CUSTOM_NODE_SOURCE: 'relative/node' }), /absolute/);
});

test('build command reports an unbuilt custom source without trying to build Node', t => {
  const directory = temporaryDirectory(t);
  const child = spawnSync(process.execPath, [
    resolve(__dirname, '../../scripts/build-node-compat.mjs'), '--base', 'custom',
  ], { env: { ...process.env, CUSTOM_NODE_SOURCE: directory }, encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /Missing Node executable.*Build Node.*CUSTOM_NODE_SOURCE/s);
  assert.ok(child.stderr.includes(directory));
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

test('building validates matching headers and ABI without an import library', t => {
  const { validateBuildInputs } = require('../node-base.cjs');
  const directory = temporaryDirectory(t);
  const target = { includes: [directory], versionHeader: join(directory, 'node_version.h') };
  for (const file of ['node.h', 'v8.h', 'uv.h']) writeFileSync(join(directory, file), '');
  writeFileSync(target.versionHeader,
    '#define NODE_MAJOR_VERSION 24\n#define NODE_MINOR_VERSION 19\n#define NODE_PATCH_VERSION 0\n#define NODE_MODULE_VERSION 137\n');
  assert.doesNotThrow(() => validateBuildInputs(target, { version: '24.19.0', modules: '137' }));
  assert.throws(() => validateBuildInputs(target,
    { version: '24.19.0', modules: '138' }), /headers use ABI 137.*executable uses ABI 138/);
});

function isolatedScript(t, name) {
  const directory = temporaryDirectory(t);
  for (const file of [`scripts/${name}`, 'node-compat/node-base.cjs']) {
    const target = join(directory, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(resolve(__dirname, '../..', file), target);
  }
  return join(directory, 'scripts', name);
}

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'browlet-node-base-'));
  t.after(() => {
    assert.equal(directory.startsWith(join(tmpdir(), 'browlet-node-base-')), true);
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
