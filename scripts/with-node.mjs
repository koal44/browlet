import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import {
  delimiter, dirname, isAbsolute, resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(root, '.env');

try {
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const command = parseCommandLine(process.argv.slice(2));
  const nodePath = selectNodePath(command.runtime);
  const environment = withSelectedNode(process.env, nodePath);
  environment.BROWLET_NODE_RUNTIME = command.runtime;
  if (command.runtime === 'addon') {
    environment.BROWLET_NODE_ADDON = resolve(root, 'node-compat/addon/index.cjs');
  } else {
    delete environment.BROWLET_NODE_ADDON;
  }

  console.log(
    `[browlet] Node runtime: ${command.runtime} (${nodePath})`,
  );

  if (command.runtime === 'compat') {
    const probe = spawnSync(
      nodePath,
      [resolve(root, 'scripts/check-compatible-node.mjs')],
      { cwd: root, env: environment, stdio: 'inherit' },
    );
    exitFor(probe, 'compatible Node capability check');
  }
  if (command.runtime === 'addon') {
    const probe = spawnSync(nodePath, [
      resolve(root, 'node-compat/test/check-addon.cjs'),
    ], { cwd: root, env: environment, stdio: 'inherit' });
    exitFor(probe, 'Node addon capability check');
  }

  const run = spawnSync(
    nodePath,
    [
      `--run=${command.script}`,
      ...(command.arguments.length === 0
        ? []
        : ['--', ...command.arguments]),
    ],
    { cwd: root, env: environment, stdio: 'inherit' },
  );
  exitFor(run, command.script);
} catch (error) {
  console.error(
    `[browlet] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}

function parseCommandLine(arguments_) {
  const args = [...arguments_];
  let runtime = process.env.BROWLET_NODE_RUNTIME ?? 'stock';

  if (args[0] === '--runtime') {
    runtime = args[1];
    args.splice(0, 2);
  }
  if (runtime !== 'stock' && runtime !== 'compat' && runtime !== 'addon') {
    throw new Error('Node runtime must be "stock", "compat" or "addon"');
  }

  const script = args.shift();
  if (!script) {
    throw new Error(
      'usage: npm.cmd run with-node -- [--runtime stock|compat|addon] <script> [-- <arguments>]',
    );
  }
  if (args[0] === '--') args.shift();
  return { arguments: args, runtime, script };
}

function selectNodePath(runtime) {
  const variable = runtime === 'compat'
    ? 'BROWLET_COMPAT_NODE'
    : 'BROWLET_STOCK_NODE';
  const configured = process.env[variable];
  const nodePath = configured ?? (runtime === 'compat' ? '' : process.execPath);

  if (!nodePath) {
    throw new Error(`${variable} must name the ${runtime} Node executable`);
  }
  if (!isAbsolute(nodePath)) {
    throw new Error(`${variable} must be an absolute path: ${nodePath}`);
  }
  if (!existsSync(nodePath) || !statSync(nodePath).isFile()) {
    throw new Error(`${variable} is not a file: ${nodePath}`);
  }
  return resolve(nodePath);
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
