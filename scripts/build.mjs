import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rollup } from 'rollup';
import dts from 'rollup-plugin-dts';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageNames = ['browlet', 'stylelet', 'selectlet'];
const browserGlobalNames = {
  selectlet: 'createSelectlet',
  stylelet: 'Stylelet',
};
const requestedNames = process.argv.slice(2);
const selectedNames = requestedNames.length === 0 ? packageNames : requestedNames;

for (const name of selectedNames) {
  if (!packageNames.includes(name)) {
    throw new Error(`Unknown package '${name}'. Expected ${packageNames.join(', ')}`);
  }
}

for (const name of selectedNames) {
  await buildPackage(name);
}

function replaceVersionPlugin(version) {
  return {
    name: 'replace-version',
    renderChunk(code) {
      return {
        code: code.replaceAll('__VERSION__', version),
        map: null,
      };
    },
  };
}

async function buildPackage(name) {
  const packageDir = path.join(rootDir, 'packages', name);
  const distDir = path.join(packageDir, 'dist');
  const tmpDir = path.join(distDir, '.tmp');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
  );
  const dependencies = Object.keys(manifest.dependencies ?? {});
  const entryDir = path.join(tmpDir, 'packages', name);
  const banner = createBanner(name, manifest.version);
  const plugins = [replaceVersionPlugin(manifest.version)];

  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  execFileSync(
    process.execPath,
    [
      path.join(rootDir, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p',
      path.join(packageDir, 'tsconfig.build.json'),
    ],
    { cwd: rootDir, stdio: 'inherit' },
  );

  const isExternal = (id) => id.startsWith('node:') || dependencies.some(
    dependency => id === dependency || id.startsWith(`${dependency}/`),
  );
  const moduleBundle = await rollup({
    input: path.join(entryDir, 'index.js'),
    external: isExternal,
    plugins,
  });

  await moduleBundle.write({
    file: path.join(distDir, 'index.mjs'),
    format: 'es',
    banner,
    sourcemap: false,
  });
  await moduleBundle.write({
    file: path.join(distDir, 'index.cjs'),
    format: 'cjs',
    exports: 'named',
    banner,
    sourcemap: false,
  });
  await moduleBundle.close();

  if (manifest.browser) {
    const browserBundle = await rollup({
      input: path.join(entryDir, 'browser.js'),
      plugins,
    });

    await browserBundle.write({
      file: path.join(packageDir, manifest.browser),
      format: 'iife',
      name: browserGlobalNames[name],
      exports: 'default',
      banner,
      sourcemap: false,
    });
    await browserBundle.close();
  }

  const dtsBundle = await rollup({
    input: path.join(entryDir, 'index.d.ts'),
    plugins: [dts()],
  });

  await dtsBundle.write({
    file: path.join(distDir, 'index.d.ts'),
    format: 'es',
  });
  await dtsBundle.close();

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`built ${name} v${manifest.version}`);

  if (name === 'selectlet') syncSelectletArtifacts(distDir);
}

function createBanner(name, version) {
  const copyrights = name === 'selectlet'
    ? [
      'Copyright (c) 2007-2025 Diego Perini',
      'Copyright (c) 2026 Eric Knowlton',
    ]
    : ['Copyright (c) 2026 Eric Knowlton'];

  return `/*\n * ${name} v${version} | MIT\n * ${copyrights.join('\n * ')}\n */\n`;
}

function syncSelectletArtifacts(distDir) {
  syncFile(
    path.join(distDir, 'index.cjs'),
    path.join(
      rootDir,
      'test/selectlet/jsdom/engines/selectlet/node_modules/nwsapi/src/nwsapi.js',
    ),
  );

  syncSelectletPackageDist(
    distDir,
    path.join(rootDir, 'vendor/jsdom/node_modules/selectlet/dist'),
  );
}

function syncFile(from, to) {
  if (!fs.existsSync(from)) {
    console.warn(`skipped '${to}'; missing source '${from}'`);
    return;
  }

  if (!fs.existsSync(to)) {
    console.warn(`skipped '${to}'; file does not exist`);
    return;
  }

  fs.copyFileSync(from, to);
}

function syncSelectletPackageDist(fromDir, destDir) {
  if (!fs.existsSync(destDir)) {
    console.warn(`skipped '${destDir}'; directory does not exist`);
    return;
  }

  for (const file of [
    'index.mjs',
    'index.cjs',
    'index.d.ts',
    'selectlet.js',
  ]) {
    const from = path.join(fromDir, file);
    const to = path.join(destDir, file);

    if (!fs.existsSync(from)) {
      console.warn(`skipped '${to}'; missing source '${from}'`);
      continue;
    }

    fs.copyFileSync(from, to);
  }
}
