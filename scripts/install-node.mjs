import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import nodeBase from '../node-compat/node-base.cjs';

// Install the official runtime and inputs for an optional addon build.
const { root, parseOptions, resolveBase, inspectNode } = nodeBase;

try {
  const envFile = resolve(root, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const { base, args } = parseOptions(process.argv.slice(2));
  if (args.length !== 0) {
    throw new Error('usage: node scripts/install-node.mjs [--base 24.19.0|26.8.1]');
  }
  if (base === 'custom') {
    throw new Error('Custom Node builds are supplied through CUSTOM_NODE_SOURCE. Select --base 24.19.0 or --base 26.8.1 to install official Node.');
  }
  if (!['win32', 'linux'].includes(process.platform) || process.arch !== 'x64') {
    throw new Error('Official Node installation currently supports Windows and Linux x64.');
  }
  const target = resolveBase(base);
  await prepareNode(target);
  const node = inspectNode(target);
  console.log(`Prepared Node ${node.version} (${node.arch})\n  executable: ${target.executable}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

async function prepareNode(target) {
  // Official https://nodejs.org/dist/v<version>/SHASUMS256.txt.
  const hashes = {
    '24.19.0': {
      headers: '54f14a297d47ea0794fe272363703d9dc419c96ac68f20d890f98b63754a3e4c',
      library: '63ec831bbf164d1b23197d6fac1944dfb146534e332889ca0755d250e8dedff9',
      executable: '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237',
      linux: '14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647',
    },
    '26.8.1': {
      headers: 'e4f54decdbf7eadb121c39c050f04f5430a7af1d035bb8ded501171637fe72de',
      library: '5432dceeac196ef89ec001939cc3801cfa131036a05f5fabf5e07b6c5a0895a4',
      executable: '5cba0ea928508c65ddadefc0681d2fb6d95f1f3beea4428f04397631140ee8e5',
      linux: '3e301118d7df53d563b7e96c1617545f26e2f76f9724be668d6cab65c15dda5d',
    },
  }[target.base];
  const url = `https://nodejs.org/dist/v${target.base}/`;
  if (process.platform === 'linux') {
    const archive = resolve(target.directory, 'linux-x64.tar.xz');
    mkdirSync(target.directory, { recursive: true });
    // Keep the verified archive for offline reinstalls, including executable permissions.
    await prepareArtifact(`${url}node-v${target.base}-linux-x64.tar.xz`, archive, hashes.linux);
    execFileSync('tar', ['-xf', archive, '-C', target.directory, '--strip-components=1'],
      { stdio: 'inherit' });
    return;
  }
  mkdirSync(dirname(target.library), { recursive: true });
  await prepareArtifact(`${url}win-x64/node.exe`, target.executable, hashes.executable);
  await prepareArtifact(`${url}win-x64/node.lib`, target.library, hashes.library);
  const headers = ['node.h', 'node_version.h', 'v8.h', 'v8-isolate.h', 'uv.h'];
  if (headers.every(name => existsSync(resolve(target.includes[0], name)))) return;

  const directory = dirname(target.executable);
  const archive = resolve(directory, 'headers.tar.gz');
  try {
    await prepareArtifact(`${url}node-v${target.base}-headers.tar.gz`, archive, hashes.headers);
    execFileSync('tar.exe', ['-xf', archive, '-C', directory, '--strip-components=1'],
      { stdio: 'inherit', windowsHide: true });
  } finally {
    if (existsSync(archive)) unlinkSync(archive);
  }
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
