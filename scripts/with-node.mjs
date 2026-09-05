import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  delimiter, dirname, resolve,
} from 'node:path';
import nodeBase from '../node-compat/node-base.cjs';

const { root, parseOptions, resolveBase, inspectNode } = nodeBase;
const envFile = resolve(root, '.env');
const require = createRequire(import.meta.url);

try {
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const command = parseCommandLine(process.argv.slice(2));
  const target = resolveBase(command.base);
  const node = inspectNode(target);
  const nodePath = target.executable;
  const environment = withSelectedNode(process.env, nodePath);
  environment.NODE_BASE = command.base;
  environment.NODE_RUNTIME = command.runtime;
  if (command.runtime === 'compat') {
    environment.BROWLET_NODE_ADDON = resolve(root, 'node-compat/addon/index.cjs');
  } else {
    delete environment.BROWLET_NODE_ADDON;
  }

  console.log(
    `[browlet] Node base: ${command.base}, Node ${node.version}, runtime: ${command.runtime}\n` +
    `  executable: ${nodePath}` +
    (command.runtime === 'compat' ? `\n  addon: ${resolve(target.build, 'node-compat.node')}` : ''),
  );

  if (command.runtime === 'compat') {
    const probe = spawnSync(nodePath, [
      resolve(root, 'node-compat/test/check-addon.cjs'),
    ], { cwd: root, env: environment, stdio: 'inherit' });
    exitFor(probe, 'Node addon capability check');
  }

  const run = spawnSync(nodePath, command.args,
    { cwd: root, env: environment, stdio: 'inherit' });
  exitFor(run, 'Node command');
} catch (error) {
  console.error(
    `[browlet] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}

function parseCommandLine(arguments_) {
  const { base, runtime, args } = parseOptions(arguments_);
  const program = args.shift();
  if (!['node', 'vitest', 'playwright'].includes(program)) {
    throw new Error(
      'usage: node scripts/with-node.mjs [--base custom|24.19.0|26.8.1] [--runtime compat|stock] <node|vitest|playwright> [arguments]',
    );
  }
  if (program !== 'node') {
    const packageName = program === 'playwright' ? '@playwright/test' : program;
    const packageFile = require.resolve(`${packageName}/package.json`);
    const { bin } = require(packageFile);
    args.unshift(resolve(dirname(packageFile), bin[program]));
  }
  return { base, runtime, args };
}

function withSelectedNode(source, nodePath) {
  const environment = { ...source };
  const pathName = Object.keys(environment)
    .find((name) => name.toLowerCase() === 'path') ?? 'PATH';
  const existingPath = environment[pathName];
  environment[pathName] = existingPath
    ? `${dirname(nodePath)}${delimiter}${existingPath}`
    : dirname(nodePath);
  return environment;
}

function exitFor(result, operation) {
  if (result.error) throw result.error;
  if (result.signal) {
    throw new Error(`${operation} ended with signal ${result.signal}`);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
