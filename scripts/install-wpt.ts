import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('.');
const wptDir = resolve(root, 'test/wpt');
const checkoutDir = resolve(wptDir, 'tests');

function installWpt(): void {
  const lock = JSON.parse(
    readFileSync(resolve(wptDir, 'wpt-lock.json'), 'utf8'),
  ) as WptLock;

  const { supportPaths, testPaths } = readSelection(
    resolve(wptDir, 'selection.txt'),
  );
  const sparsePaths = unique([
    'LICENSE.md',
    'resources/testharness.js',
    'resources/testharnessreport.js',
    ...testPaths,
    ...supportPaths,
  ]);

  prepareCheckout(lock.repository);
  assertCleanCheckout();

  git(['fetch', '--depth=1', '--filter=blob:none', '--no-tags', 'origin', lock.revision]);
  git(
    ['sparse-checkout', 'set', '--no-cone', '--stdin'],
    `${sparsePaths.map((path) => `/${path}`).join('\n')}\n`,
  );
  git(['-c', 'advice.detachedHead=false', 'checkout', '--detach', 'FETCH_HEAD']);

  const installedRevision = gitOutput(['rev-parse', 'HEAD']);
  if (installedRevision !== lock.revision) {
    throw new Error(
      `WPT checkout resolved to ${installedRevision}, expected ${lock.revision}`,
    );
  }

  console.log(`[wpt] installed ${testPaths.length} selected test(s)`);
  console.log(`[wpt] revision ${installedRevision}`);
  console.log(`[wpt] checkout ${checkoutDir}`);
}

installWpt();

type WptLock = {
  repository: string;
  revision: string;
};

type WptSelection = {
  supportPaths: string[];
  testPaths: string[];
};

function readSelection(path: string): WptSelection {
  const supportPaths: string[] = [];
  const testPaths: string[] = [];

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# support:')) {
      supportPaths.push(normalizeSelection(trimmed.slice(10).trim()));
    } else if (trimmed !== '' && !trimmed.startsWith('#')) {
      testPaths.push(normalizeSelection(trimmed));
    }
  }

  return { supportPaths, testPaths };
}

function normalizeSelection(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//u, '');

  if (
    normalized.startsWith('/') ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(`WPT selection must be a repository-relative path: ${path}`);
  }

  return normalized;
}

function unique(paths: string[]): string[] {
  return [...new Set(paths)];
}

function prepareCheckout(repository: string): void {
  mkdirSync(checkoutDir, { recursive: true });

  if (!existsSync(resolve(checkoutDir, '.git'))) {
    if (readdirSync(checkoutDir).length !== 0) {
      throw new Error(`WPT checkout directory is not empty: ${checkoutDir}`);
    }

    git(['init', '--quiet']);
  }

  const remotes = gitOutput(['remote']).split(/\r?\n/u);
  if (remotes.includes('origin')) {
    git(['remote', 'set-url', 'origin', repository]);
  } else {
    git(['remote', 'add', 'origin', repository]);
  }

  git(['sparse-checkout', 'init', '--no-cone']);
}

function assertCleanCheckout(): void {
  const status = gitOutput(['status', '--porcelain']);

  if (status !== '') {
    throw new Error(
      `WPT checkout has local changes; preserve or discard them before installing:\n${status}`,
    );
  }
}

function git(args: string[], input?: string): void {
  execFileSync('git', args, {
    cwd: checkoutDir,
    input,
    stdio: input === undefined
      ? 'inherit'
      : ['pipe', 'inherit', 'inherit'],
  });
}

function gitOutput(args: string[]): string {
  return execFileSync('git', args, {
    cwd: checkoutDir,
    encoding: 'utf8',
  }).trim();
}
