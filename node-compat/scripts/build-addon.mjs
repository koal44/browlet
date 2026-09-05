import { mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const addon = fileURLToPath(new URL('../addon/', import.meta.url));
const headers = process.argv[2] === undefined
  ? fileURLToPath(new URL('../.cache/node-v24.19.0/', import.meta.url))
  : resolve(process.argv[2]);
const build = resolve(addon, 'build');
const sources = ['addon.cc', 'vm.cc', 'property-delegate.cc'].map(name => resolve(addon, name));
const lookup = spawnSync('where.exe', ['cl.exe'], { encoding: 'utf8' });
if (lookup.error) throw lookup.error;
if (lookup.status !== 0) throw new Error('Run build-addon.cmd to initialize the C++ tools.');
const compiler = lookup.stdout.trim().split(/\r?\n/u)[0];

// Include the developer prompt's SDK paths so the editor can use
// the same compilation database from an ordinary shell.
const includes = [
  resolve(headers, 'include/node'),
  ...(process.env.INCLUDE ?? '').split(delimiter).filter(Boolean),
];
const compileArgs = [
  '/nologo', '/std:c++20', '/Zc:__cplusplus', '/EHsc', '/MD', '/LD', '/O2',
  '/DNODE_GYP_MODULE_NAME=node_compat',
  ...includes.map(path => `/I${path}`),
  `/Fo${build}\\`,
];
mkdirSync(build, { recursive: true });
writeFileSync(resolve(build, 'compile_commands.json'), JSON.stringify(sources.map(file => ({
  directory: addon,
  file,
  arguments: [compiler, ...compileArgs, file],
})), null, 2) + '\n');

const result = spawnSync(compiler, [
  ...compileArgs, ...sources,
  '/link',
  `/OUT:${resolve(build, 'node-compat.node')}`,
  `/IMPLIB:${resolve(build, 'node-compat.lib')}`,
  resolve(headers, 'Release/node.lib'),
], { cwd: addon, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
