import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

type GitSpec = {
  type: 'git';
  repo: string;
  rev: string;
  dir: string;
  patch?: string;
  active: boolean;
};

type VendorLock = Record<string, GitSpec>;

const LOCK_PATH = 'vendor-lock.json';

const lock = JSON.parse(
  readFileSync(LOCK_PATH, 'utf8'),
) as VendorLock;

for (const [name, spec] of Object.entries(lock)) {
  if (!spec.active) {
    console.log(`--- [vendor] Skipping ${name} (active=false) ---`);
    continue;
  }

  fetchGitSpec(name, spec);

  if (name === 'jsdom') {
    prepareJsdomVendor(spec.dir);
  }
}

function sh(bin: string, args: string[], cwd?: string): void {
  const useShell = process.platform === 'win32' && ['npm', 'npx', 'pnpm', 'yarn'].includes(bin);

  execFileSync(bin, args, {
    stdio: 'inherit',
    cwd,
    shell: useShell,
  });
}

function git(args: string[], cwd: string): void {
  sh('git', args, cwd);
}

function gitOk(args: string[], cwd: string): boolean {
  try {
    execFileSync('git', args, { stdio: 'ignore', cwd });
    return true;
  } catch {
    return false;
  }
}

function fetchGitSpec(name: string, spec: GitSpec): void {
  console.log(`--- [vendor] Using ${name} ---`);

  const { repo, rev, dir } = spec;
  const patch = spec.patch ? resolve(spec.patch) : undefined;

  if (!existsSync(dir)) {
    mkdirSync(dirname(dir), { recursive: true });
    sh('git', ['clone', '--quiet', repo, dir]);
    git(['config', 'core.filemode', 'false'], dir);
    console.log(`[vendor] cloned ${repo} -> ${dir}`);
  }

  if (!gitOk(['rev-parse', '--verify', `${rev}^{commit}`], dir)) {
    console.log(`[vendor] ${name}: fetching origin because ${rev} is not present locally`);
    git(['fetch', '--quiet', '--tags', '--prune', 'origin'], dir);
  }

  console.log(`[vendor] ${name}: reset to ${rev}`);
  git(['-c', 'advice.detachedHead=false', 'checkout', '--force', rev], dir);
  git(['reset', '--hard', rev], dir);
  git(['clean', '-ffd'], dir);

  if (patch) {
    if (!existsSync(patch)) {
      console.log(`[vendor] ${name}: no patch at ${patch}; skipping`);
    } else {
      console.log(`[vendor] ${name}: applying ${patch}`);
      git(['apply', '--whitespace=fix', '--quiet', patch], dir);
    }
  }

  console.log(`[vendor] ${name} ready @ ${dir}`);
}

function prepareJsdomVendor(dir: string): void {
  console.log(`[vendor] jsdom: installing dependencies`);
  sh('npm', ['ci'], dir);

  console.log(`[vendor] jsdom: running prepare`);
  sh('npm', ['run', 'prepare'], dir);

  syncSelectletIntoJsdom(dir);

  console.log(`[vendor] jsdom: smoke testing lib/api.js`);
  sh('node', [
    '-e',
    [
      "const { JSDOM } = require('./lib/api.js');",
      "const dom = new JSDOM('<div id=x></div><iframe></iframe>');",
      "if (!dom.window.document.querySelector('#x')) throw new Error('querySelector failed');",
      "if (dom.window.frames.length !== 1) throw new Error('iframe frames check failed');",
      "console.log('[vendor] jsdom smoke passed');",
    ].join(' '),
  ], dir);
}

function syncSelectletIntoJsdom(jsdomDir: string): void {
  const destDir = resolve(jsdomDir, 'node_modules/selectlet/dist');

  if (!existsSync(destDir)) {
    throw new Error(`[vendor] missing ${destDir}; npm ci probably did not install selectlet`);
  }

  for (const file of [
    'index.mjs',
    'index.cjs',
    'index.d.ts',
    'selectlet.js',
  ]) {
    const src = resolve('dist', file);
    const dest = resolve(destDir, file);

    if (!existsSync(src)) {
      throw new Error(`[vendor] missing ${src}; run selectlet build first`);
    }

    if (!existsSync(dest)) {
      throw new Error(`[vendor] missing ${dest}; selectlet package layout changed`);
    }

    copyFileSync(src, dest);
    console.log(`[vendor] copied ${src} -> ${dest}`);
  }
}
