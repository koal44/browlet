'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync, statSync } = require('node:fs');
const { isAbsolute, join, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const bases = ['custom', '24.19.0', '26.8.1'];

function resolveBase(base, environment = process.env) {
  validateBase(base);
  const custom = base === 'custom';
  const source = custom ? environment.CUSTOM_NODE_SOURCE : join(__dirname, '.cache', `node-v${base}`);
  if (custom && (!source || !isAbsolute(source))) {
    throw new Error('CUSTOM_NODE_SOURCE must be an absolute path to the regular Node source checkout');
  }
  const directory = resolve(source);
  const includes = custom
    ? [join(directory, 'src'), join(directory, 'deps/v8/include'), join(directory, 'deps/uv/include')]
    : [join(directory, 'include/node')];
  return {
    base,
    executable: join(directory, custom ? 'out/Release/node.exe' : 'node.exe'),
    includes,
    versionHeader: join(includes[0], 'node_version.h'),
    library: join(directory, custom ? 'out/Release/node.lib' : 'Release/node.lib'),
    build: addonBuild(base),
    hint: custom ? `Build Node in CUSTOM_NODE_SOURCE (${directory}).`
      : `Run npm run build:node-compat -- --base ${base}.`,
  };
}

function inspectNode(target) {
  requireFile(target.executable, `Node executable. ${target.hint}`);
  const child = spawnSync(target.executable, ['-p',
    'JSON.stringify({ version: process.versions.node, modules: process.versions.modules, arch: process.arch, platform: process.platform })',
  ], { encoding: 'utf8' });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`Cannot inspect ${target.executable}: ${child.stderr.trim()}`);
  const node = JSON.parse(child.stdout);
  validateRuntimeVersion(target.base, node.version);
  return node;
}

function validateBuildInputs(target, node) {
  requireFile(target.library, `Node import library. ${target.hint}`);
  for (const header of ['node.h', 'v8.h', 'uv.h']) {
    if (!target.includes.some(directory => existsSync(join(directory, header)))) {
      throw new Error(`Missing ${header} in ${target.includes.join(', ')}. ${target.hint}`);
    }
  }
  requireFile(target.versionHeader, `Node version header. ${target.hint}`);
  const header = readFileSync(target.versionHeader, 'utf8');
  const version = ['MAJOR', 'MINOR', 'PATCH'].map(part => {
    const match = header.match(new RegExp(`^#define NODE_${part}_VERSION (\\d+)`, 'm'));
    if (!match) throw new Error(`Cannot read Node version from ${target.versionHeader}`);
    return match[1];
  }).join('.');
  if (version !== node.version.split('-')[0]) {
    throw new Error(`Node headers are ${version}, but the executable is ${node.version}. ${target.hint}`);
  }
  const abi = header.match(/^#define NODE_MODULE_VERSION (\d+)/m)?.[1];
  if (abi !== undefined && abi !== node.modules) {
    throw new Error(`Node headers use ABI ${abi}, but the executable uses ABI ${node.modules}. ${target.hint}`);
  }
}

function parseOptions(arguments_, environment = process.env) {
  const args = [...arguments_];
  let base = environment.NODE_BASE ?? '24.19.0';
  let runtime = environment.NODE_RUNTIME ?? 'compat';
  while (args[0]?.startsWith('--')) {
    const option = args.shift();
    if (option !== '--base' && option !== '--runtime') throw new Error(`Unknown Node option: ${option}`);
    const value = args.shift();
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
    if (option === '--base') base = value;
    else runtime = value;
  }
  validateBase(base);
  if (runtime !== 'compat' && runtime !== 'stock') {
    throw new Error('NODE_RUNTIME must be "compat" or "stock"');
  }
  return { base, runtime, args };
}

function addonBuild(base) {
  validateBase(base);
  return join(__dirname, 'addon/build', base);
}

function validateRuntimeVersion(base, version) {
  validateBase(base);
  if (base !== 'custom' && version !== base) {
    throw new Error(`NODE_BASE=${base} requires Node ${base}; running ${version}`);
  }
}

function validateBase(base) {
  if (!bases.includes(base)) throw new Error(`NODE_BASE must be one of: ${bases.join(', ')}`);
}

function requireFile(path, description) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Missing ${description}\nExpected file: ${path}`);
}

module.exports = { root, resolveBase, inspectNode, validateBuildInputs, parseOptions,
  addonBuild, validateRuntimeVersion, requireFile };
