import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
import nodeBase from '../node-compat/node-base.cjs';

// Compile the compatibility addon for the selected Node base.
const { root, parseOptions, resolveBase, inspectNode, validateBuildInputs } = nodeBase;

try {
  const envFile = resolve(root, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const { base, args } = parseOptions(process.argv.slice(2));
  if (args.length !== 0) {
    throw new Error('usage: node scripts/build-node-compat.mjs [--base custom|24.19.0|26.8.1]');
  }
  if (!['win32', 'linux'].includes(process.platform) || process.arch !== 'x64') {
    throw new Error('The compatibility addon build supports Windows and Linux x64.');
  }
  const windows = process.platform === 'win32';
  const target = resolveBase(base);
  const node = inspectNode(target);
  validateBuildInputs(target, node);

  const addon = resolve(root, 'node-compat/addon');
  const build = target.build;
  const sources = ['addon.cc', 'array-buffer.cc', 'vm.cc', 'property-delegate.cc', 'host-hooks.cc'].map(name => resolve(addon, name));
  const isolateHeader = target.includes.map(path => resolve(path, 'v8-isolate.h')).find(existsSync);
  const api = readFileSync(isolateHeader, 'utf8');
  const hostHooks = ['SetPromiseCaptureHook', 'SetPromiseCallHook', 'SetPromiseJobEnqueueHook',
    'SetFinalizationRegistryCaptureHook', 'SetFinalizationRegistryCallHook',
    'SetGenericJobEnqueueHook', 'SetTimeoutJobEnqueueHook',
    'GetCurrentHostDefinedOptions(bool'].every(name => api.includes(name));
  const arrayBufferHeader = resolve(dirname(isolateHeader), 'v8-array-buffer.h');
  const lengthTracking = readFileSync(arrayBufferHeader, 'utf8').includes('bool IsLengthTracking() const;');
  const containerHeader = resolve(dirname(isolateHeader), 'v8-container.h');
  const collectionIterators = readFileSync(containerHeader, 'utf8').includes('class V8_EXPORT CollectionIterator');
  const valueHeader = readFileSync(resolve(dirname(isolateHeader), 'v8-value.h'), 'utf8');
  const iteratorPredicates = ['IsArrayIterator', 'IsStringIterator', 'IsRegExpStringIterator']
    .every(name => valueHeader.includes(`bool ${name}() const;`));
  const environment = windows ? compilerEnvironment() : process.env;
  const compiler = windows
    ? run('where.exe', ['cl.exe'], { env: environment }).split(/\r?\n/u)[0]
    : environment.CXX ?? 'c++';
  const definitions = [
    'NODE_GYP_MODULE_NAME=node_compat',
    ...(hostHooks ? ['NODE_COMPAT_HOST_HOOKS'] : []),
    ...(lengthTracking ? ['NODE_COMPAT_ARRAY_BUFFER_LENGTH_TRACKING'] : []),
    ...(collectionIterators ? ['NODE_COMPAT_COLLECTION_ITERATORS'] : []),
    ...(iteratorPredicates ? ['NODE_COMPAT_ITERATOR_PREDICATES'] : []),
  ];

  // Include the developer prompt's SDK paths so the editor can use
  // the same compilation database from an ordinary shell.
  const includes = [
    ...target.includes,
    ...(windows ? (environment.INCLUDE ?? '').split(delimiter).filter(Boolean) : []),
  ];
  const compileArgs = windows ? [
    '/nologo', '/std:c++20', '/Zc:__cplusplus', '/EHsc', '/MD', '/LD', '/O2',
    ...definitions.map(name => `/D${name}`),
    ...includes.map(path => `/I${path}`),
    `/Fo${build}\\`,
  ] : [
    '-std=gnu++20', '-fPIC', '-fno-rtti', '-fno-exceptions', '-pthread', '-O2',
    ...definitions.map(name => `-D${name}`),
    ...includes.map(path => `-I${path}`),
  ];
  mkdirSync(build, { recursive: true });
  const commands = sources.map(file => ({
    directory: addon,
    file,
    arguments: [compiler, ...compileArgs, file],
  }));

  console.log(`Building addon for ${base}: Node ${node.version} (${node.arch})\n  output: ${build}`);
  const linkArgs = windows ? [
    '/link',
    `/OUT:${resolve(build, 'node-compat.node')}`,
    `/IMPLIB:${resolve(build, 'node-compat.lib')}`,
    target.library,
  ] : ['-shared', '-o', resolve(build, 'node-compat.node')];
  run(compiler, [...compileArgs, ...sources, ...linkArgs],
    { cwd: addon, env: environment, stdio: 'inherit' });
  writeFileSync(resolve(build, 'node.json'), JSON.stringify(node, null, 2) + '\n');
  // The editor follows the most recent successful build; binaries remain separate.
  writeFileSync(resolve(addon, 'build/compile_commands.json'), JSON.stringify(commands, null, 2) + '\n');
} catch (error) {
  console.error(error.message);
  process.exitCode ||= 1;
}

function compilerEnvironment() {
  if (process.env.VSCMD_ARG_TGT_ARCH === 'x64' &&
    spawnSync('where.exe', ['cl.exe']).status === 0) return process.env;

  let installation = process.env.VSINSTALLDIR;
  if (!installation) {
    const vswhere = resolve(process.env['ProgramFiles(x86)'], 'Microsoft Visual Studio/Installer/vswhere.exe');
    if (!existsSync(vswhere)) {
      throw new Error('Visual Studio C++ tools were not found. Run from an x64 developer prompt or set VSINSTALLDIR.');
    }
    installation = run(vswhere, ['-latest', '-products', '*',
      '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath']);
    if (!installation) throw new Error('Install the Visual Studio Desktop development with C++ workload.');
  }
  const output = run(process.env.ComSpec ?? 'cmd.exe', [
    '/d', '/s', '/c', 'call "%NODE_COMPAT_VSDEVCMD%" -arch=x64 -host_arch=x64 >nul && set',
  ], { windowsVerbatimArguments: true, env: { ...process.env,
    NODE_COMPAT_VSDEVCMD: resolve(installation, 'Common7/Tools/VsDevCmd.bat') } });
  const environment = {};
  for (const line of output.split(/\r?\n/u)) {
    const index = line.indexOf('=');
    if (index > 0) environment[line.slice(0, index)] = line.slice(index + 1);
  }
  return environment;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    throw new Error(`${command} failed (${result.signal ?? result.status})${result.stderr ? `:\n${result.stderr.trim()}` : ''}`);
  }
  return result.stdout?.trim() ?? '';
}
