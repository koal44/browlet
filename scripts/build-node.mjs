import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
import nodeBase from '../node-compat/node-base.cjs';

// Prepare the selected Node base and compile its compatibility addon.
// Custom Node engine builds remain in CUSTOM_NODE_SOURCE.
const { root, parseOptions, resolveBase, inspectNode, validateBuildInputs } = nodeBase;

try {
  const envFile = resolve(root, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const { base, args } = parseOptions(process.argv.slice(2));
  if (args.length !== 0) {
    throw new Error('usage: node scripts/build-node.mjs [--base custom|24.19.0|26.8.1]');
  }
  const target = resolveBase(base);
  if (base !== 'custom') await prepareNode(target);
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
  const environment = compilerEnvironment();
  const compiler = run('where.exe', ['cl.exe'], { env: environment }).split(/\r?\n/u)[0];

  // Include the developer prompt's SDK paths so the editor can use
  // the same compilation database from an ordinary shell.
  const includes = [
    ...target.includes,
    ...(environment.INCLUDE ?? '').split(delimiter).filter(Boolean),
  ];
  const compileArgs = [
    '/nologo', '/std:c++20', '/Zc:__cplusplus', '/EHsc', '/MD', '/LD', '/O2',
    '/DNODE_GYP_MODULE_NAME=node_compat',
    ...(hostHooks ? ['/DNODE_COMPAT_HOST_HOOKS'] : []),
    ...(lengthTracking ? ['/DNODE_COMPAT_ARRAY_BUFFER_LENGTH_TRACKING'] : []),
    ...(collectionIterators ? ['/DNODE_COMPAT_COLLECTION_ITERATORS'] : []),
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
  run(compiler, [
    ...compileArgs, ...sources,
    '/link',
    `/OUT:${resolve(build, 'node-compat.node')}`,
    `/IMPLIB:${resolve(build, 'node-compat.lib')}`,
    target.library,
  ], { cwd: addon, env: environment, stdio: 'inherit' });
  writeFileSync(resolve(build, 'node.json'), JSON.stringify(node, null, 2) + '\n');
  // The editor follows the most recent successful build; binaries remain separate.
  writeFileSync(resolve(addon, 'build/compile_commands.json'), JSON.stringify(commands, null, 2) + '\n');
} catch (error) {
  console.error(error.message);
  process.exitCode ||= 1;
}

async function prepareNode(target) {
  // Official https://nodejs.org/dist/v<version>/SHASUMS256.txt.
  const hashes = {
    '24.19.0': {
      headers: '54f14a297d47ea0794fe272363703d9dc419c96ac68f20d890f98b63754a3e4c',
      library: '63ec831bbf164d1b23197d6fac1944dfb146534e332889ca0755d250e8dedff9',
      executable: '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237',
    },
    '26.8.1': {
      headers: 'e4f54decdbf7eadb121c39c050f04f5430a7af1d035bb8ded501171637fe72de',
      library: '5432dceeac196ef89ec001939cc3801cfa131036a05f5fabf5e07b6c5a0895a4',
      executable: '5cba0ea928508c65ddadefc0681d2fb6d95f1f3beea4428f04397631140ee8e5',
    },
  }[target.base];
  const url = `https://nodejs.org/dist/v${target.base}/`;
  mkdirSync(dirname(target.library), { recursive: true });
  await prepareArtifact(`${url}win-x64/node.exe`, target.executable, hashes.executable);
  await prepareArtifact(`${url}win-x64/node.lib`, target.library, hashes.library);
  const headers = ['node.h', 'node_version.h', 'v8.h', 'v8-isolate.h', 'uv.h'];
  if (headers.every(name => existsSync(resolve(target.includes[0], name)))) return;

  const directory = dirname(target.executable);
  const archive = resolve(directory, 'headers.tar.gz');
  try {
    await prepareArtifact(`${url}node-v${target.base}-headers.tar.gz`, archive, hashes.headers);
    run('tar.exe', ['-xf', archive, '-C', directory, '--strip-components=1']);
  } finally {
    if (existsSync(archive)) unlinkSync(archive);
  }
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

async function prepareArtifact(url, path, hash) {
  const cached = existsSync(path);
  let contents;
  if (cached) {
    contents = readFileSync(path);
  } else {
    console.log(`Downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
    contents = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(contents).digest('hex') !== hash) {
    throw new Error(`Hash mismatch: ${path}`);
  }
  if (!cached) writeFileSync(path, contents);
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
