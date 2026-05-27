import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const engines: EngineConfig[] = [
  {
    name: 'nwsapi',
    jsdomVersion: '23.1.0',
    enginePackage: 'nwsapi',
    expectedEngineVersion: '2.2.23',
  },
  {
    name: 'dom-selector',
    jsdomVersion: '23.2.0',
    enginePackage: '@asamuzakjp/dom-selector',
    expectedEngineVersion: '2.0.2',
  },
  {
    name: 'selectlet',
    jsdomVersion: '23.1.0',
    enginePackage: 'nwsapi',
    expectedEngineVersion: '2.2.23',
    postInstall(dir) {
      copyFileSync(
        'dist/selectlet.js',
        `${dir}/node_modules/nwsapi/src/nwsapi.js`,
      );

      console.log('[selectlet] copied dist/nwsapi.js into jsdom nwsapi backend');
    },
  },
];

const ENGINES_DIR = 'test/jsdom/engines';

type EngineName = 'nwsapi' | 'dom-selector' | 'selectlet';

type EngineConfig = {
  name: EngineName;
  jsdomVersion: string;
  enginePackage: string;
  expectedEngineVersion?: string;
  dependencies?: Record<string, string>;
  postInstall?: (dir: string) => void;
};

type PackageJson = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  [key: string]: unknown;
};

function sh(bin: string, args: string[], cwd?: string) {
  try {
    execFileSync(bin, args, { stdio: 'inherit', cwd });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    throw new Error(
      `Command failed in ${cwd ?? process.cwd()}: ${bin} ${args.join(' ')}\n${e.message}`,
    );
  }
}

function npmInstall(cwd: string) {
  const npmCli = process.env.npm_execpath;

  if (npmCli) {
    sh(process.execPath, [npmCli, 'install'], cwd);
    return;
  }

  throw new Error('npm_execpath not found in environment. You must run this script via npm');
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageJson;
}

function findPackageJson(start: string, expectedName: string) {
  let dir = dirname(start);
  let fallback: string | null = null;

  while (true) {
    const pkg = `${dir}/package.json`;

    if (existsSync(pkg)) {
      fallback ??= pkg;

      try {
        if (readJson(pkg).name === expectedName) return pkg;
      } catch {
        // keep walking
      }
    }

    const next = dirname(dir);
    if (next === dir) return fallback;
    dir = next;
  }
}

function probePackage(requireFromEngine: NodeJS.Require, pkg: string) {
  try {
    const entry = requireFromEngine.resolve(pkg);
    const packageJsonPath = findPackageJson(entry, pkg);
    if (!packageJsonPath) throw new Error(`package.json for ${pkg} not found`);

    const meta = readJson(packageJsonPath);

    return {
      pkg,
      version: meta.version,
    };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return {
      pkg,
      error: e.code ?? e.message,
    };
  }
}

function writeEnginePackage(engine: EngineConfig, dir: string) {
  const pkg = {
    private: true,
    name: `jsdom-${engine.name}`,
    version: '0.0.0',
    type: 'commonjs',
    dependencies: {
      jsdom: engine.jsdomVersion,
      ...engine.dependencies,
    },
  };

  writeFileSync(`${dir}/package.json`, `${JSON.stringify(pkg, null, 2)}\n`);
}

function verifySelectors(requireFromEngine: NodeJS.Require) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { JSDOM } = requireFromEngine('jsdom');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const dom = new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <div id="a" class="foo"></div>
        <div id="b" class="foo bar"></div>
        <section id="c"><p class="bar"></p></section>
      </body>
    </html>
  `) as { window: Window; };

  const { document } = dom.window;

  const ids = (xs: Iterable<Element>) =>
    [...xs].map((e) => e.id || e.tagName.toLowerCase());

  const checks: [string, unknown, unknown][] = [
    ['qSA .foo', ids(document.querySelectorAll('.foo')).join(','), 'a,b'],
    ['qSA .foo.bar', ids(document.querySelectorAll('.foo.bar')).join(','), 'b'],
    ['query #b', document.querySelector('#b')?.id, 'b'],
    ['matches .foo.bar', document.getElementById('b')?.matches('.foo.bar'), true],
    ['closest section', document.querySelector('p')?.closest('section')?.id, 'c'],
  ];

  for (const [label, actual, expected] of checks) {
    if (actual !== expected) {
      throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
    }
  }

  console.log('selectors: ok');
}

function installEngine(engine: EngineConfig) {
  const dir = `${ENGINES_DIR}/${engine.name}`;

  console.log(`\n== ${engine.name} ==`);

  mkdirSync(dir, { recursive: true });
  writeEnginePackage(engine, dir);
  npmInstall(dir);

  engine.postInstall?.(dir);

  const requireFromEngine = createRequire(`${process.cwd()}/${dir}/package.json`);

  const jsdomProbe = probePackage(requireFromEngine, 'jsdom');
  const engineProbe = probePackage(requireFromEngine, engine.enginePackage);

  console.log('');
  console.log('jsdom:', jsdomProbe);
  console.log(`${engine.name}:`, engineProbe);

  verifySelectors(requireFromEngine);

  if (engineProbe.version !== engine.expectedEngineVersion) {
    console.warn(
      `${engine.name}: expected ${engine.enginePackage} ${engine.expectedEngineVersion}, got ${engineProbe.version}`,
    );
  }
}

mkdirSync(ENGINES_DIR, { recursive: true });

for (const engine of engines) {
  installEngine(engine);
}

console.log('\nDone.');
