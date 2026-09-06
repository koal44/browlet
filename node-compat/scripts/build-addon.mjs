import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import nodeBase from '../node-base.cjs';

const { root, parseOptions, resolveBase, inspectNode, validateBuildInputs } = nodeBase;
const envFile = resolve(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { base, args } = parseOptions(process.argv.slice(2));
if (args.length !== 0) throw new Error('usage: build-addon.cmd [--base custom|24.19.0|26.8.1]');
const target = resolveBase(base);
const node = inspectNode(target);
validateBuildInputs(target, node);
const addon = resolve(root, 'node-compat/addon');
const build = target.build;
const sources = ['addon.cc', 'vm.cc', 'property-delegate.cc', 'host-hooks.cc'].map(name => resolve(addon, name));
const isolateHeader = target.includes.map(path => resolve(path, 'v8-isolate.h')).find(existsSync);
const api = readFileSync(isolateHeader, 'utf8');
const hostHooks = ['SetPromiseCaptureHook', 'SetPromiseCallHook', 'SetPromiseJobEnqueueHook',
  'SetFinalizationRegistryCaptureHook', 'SetFinalizationRegistryCallHook',
  'SetGenericJobEnqueueHook', 'SetTimeoutJobEnqueueHook',
  'GetCurrentHostDefinedOptions(bool'].every(name => api.includes(name));
const lookup = spawnSync('where.exe', ['cl.exe'], { encoding: 'utf8' });
if (lookup.error) throw lookup.error;
if (lookup.status !== 0) throw new Error('Run build-addon.cmd to initialize the C++ tools.');
const compiler = lookup.stdout.trim().split(/\r?\n/u)[0];

// Include the developer prompt's SDK paths so the editor can use
// the same compilation database from an ordinary shell.
const includes = [
  ...target.includes,
  ...(process.env.INCLUDE ?? '').split(delimiter).filter(Boolean),
];
const compileArgs = [
  '/nologo', '/std:c++20', '/Zc:__cplusplus', '/EHsc', '/MD', '/LD', '/O2',
  '/DNODE_GYP_MODULE_NAME=node_compat',
  ...(hostHooks ? ['/DNODE_COMPAT_HOST_HOOKS'] : []),
  ...includes.map(path => `/I${path}`),
  `/Fo${build}\\`,
];
mkdirSync(build, { recursive: true });
const commands = sources.map(file => ({
  directory: addon,
  file,
  arguments: [compiler, ...compileArgs, file],
}));

console.log(`Building addon for ${base}: Node ${node.version} (${node.arch})\n  output: ${build}`);
const result = spawnSync(compiler, [
  ...compileArgs, ...sources,
  '/link',
  `/OUT:${resolve(build, 'node-compat.node')}`,
  `/IMPLIB:${resolve(build, 'node-compat.lib')}`,
  target.library,
], { cwd: addon, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
if (process.exitCode === 0) {
  writeFileSync(resolve(build, 'node.json'), JSON.stringify(node, null, 2) + '\n');
  // The editor follows the most recent successful build; binaries remain separate.
  writeFileSync(resolve(addon, 'build/compile_commands.json'), JSON.stringify(commands, null, 2) + '\n');
}
