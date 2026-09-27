import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { installCatalogue } from '../catalogue';
import { readSuites, selectTests } from '../suite';

const root = resolve('.');
const wptDir = resolve(root, 'wpt');
const checkoutDir = resolve(wptDir, 'tests');

async function installWpt(): Promise<void> {
  const lock = JSON.parse(
    readFileSync(resolve(wptDir, 'wpt-lock.json'), 'utf8'),
  ) as WptLock;

  const suites = readSuites();
  const catalogue = await installCatalogue(lock.revision);
  const { tests, support } = selectTests(suites, catalogue);
  const testPaths = tests.filter((test) => !test.skip).map((test) => test.test.source);
  const sparsePaths = [...new Set([
    'LICENSE.md',
    'resources/testharness.js',
    'resources/testharnessreport.js',
    ...testPaths,
    ...support,
  ])];

  prepareCheckout(lock.repository);
  assertCleanCheckout();

  // Existing Git objects and the pinned manifest can be reused offline.
  if (!hasRevision(lock.revision)) {
    git(['fetch', '--depth=1', '--filter=blob:none', '--no-tags', 'origin', lock.revision]);
  }
  git(
    ['sparse-checkout', 'set', '--no-cone', '--stdin'],
    `${sparsePaths.map((path) => `/${path}`).join('\n')}\n`,
  );
  git(['-c', 'advice.detachedHead=false', 'checkout', '--detach', lock.revision]);

  const installedRevision = gitOutput(['rev-parse', 'HEAD']);
  if (installedRevision !== lock.revision) {
    throw new Error(
      `WPT checkout resolved to ${installedRevision}, expected ${lock.revision}`,
    );
  }

  console.log(`[wpt] installed ${new Set(testPaths).size} source files for ${testPaths.length} runnable test URLs`);
  console.log(`[wpt] ${tests.length - testPaths.length} configured skips; ${catalogue.tests.length - tests.length} unselected testharness URLs`);
  console.log(`[wpt] revision ${installedRevision}`);
  console.log(`[wpt] checkout ${checkoutDir}`);
}

void installWpt().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

type WptLock = {
  repository: string;
  revision: string;
};

function hasRevision(revision: string): boolean {
  try {
    gitOutput(['cat-file', '-e', `${revision}^{commit}`]);
    return true;
  } catch {
    return false;
  }
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
