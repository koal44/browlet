import fs from 'node:fs';
// import path from 'node:path';
import { execSync } from 'node:child_process';
import { rollup } from 'rollup';
import dts from 'rollup-plugin-dts';

const distDir = 'dist';
const tmpDir = 'dist/.tmp';

const moduleInputFile = 'dist/.tmp/index.js';
const browserInputFile = 'dist/.tmp/browser.js';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = pkg.version;

const banner = `/*
 * selectlet v${version} | MIT
 * Copyright (c) 2007-2025 Diego Perini
 * Copyright (c) 2026 Eric Knowlton
 */
`;

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

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

execSync('npx tsc -p tsconfig.build.json', { stdio: 'inherit' });

const plugins = [
  replaceVersionPlugin(version),
];

// ESM + CJS from normal named-export library entry.
const moduleBundle = await rollup({
  input: moduleInputFile,
  plugins,
});

await moduleBundle.write({
  file: 'dist/index.mjs',
  format: 'es',
  banner,
  sourcemap: false,
});

await moduleBundle.write({
  file: 'dist/index.cjs',
  format: 'cjs',
  exports: 'named',
  banner,
  sourcemap: false,
});

await moduleBundle.close();

// Browser IIFE from default-export entry.
const browserBundle = await rollup({
  input: browserInputFile,
  plugins,
});

await browserBundle.write({
  file: 'dist/selectlet.js',
  format: 'iife',
  name: 'createSelectlet',
  exports: 'default',
  banner,
  sourcemap: false,
});

await browserBundle.close();

// copyFileIfExists('dist/.tmp/index.d.ts', 'dist/index.d.ts');
// copyDtsTree(tmpDir, distDir);

const dtsBundle = await rollup({
  input: 'dist/.tmp/index.d.ts',
  plugins: [
    dts(),
  ],
});

await dtsBundle.write({
  file: 'dist/index.d.ts',
  format: 'es',
});

await dtsBundle.close();

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`built selectlet v${version}`);

syncBuiltArtifacts();

console.log('synced built artifacts\n');

// function copyFileIfExists(from, to) {
//   if (!fs.existsSync(from)) {
//     console.warn(`missing '${from}'`);
//     return;
//   }

//   fs.mkdirSync(path.dirname(to), { recursive: true });
//   fs.copyFileSync(from, to);
//   // console.log(`wrote '${to}'`);
// }

function syncBuiltArtifacts() {
  syncFile(
    'dist/index.cjs',
    'test/selectlet/jsdom/engines/selectlet/node_modules/nwsapi/src/nwsapi.js',
  );

  syncSelectletPackageDist('vendor/jsdom/node_modules/selectlet/dist');
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
  // console.log(`updated '${to}'`);
}

function syncSelectletPackageDist(destDir) {
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
    const from = `dist/${file}`;
    const to = `${destDir}/${file}`;

    if (!fs.existsSync(from)) {
      console.warn(`skipped '${to}'; missing source '${from}'`);
      continue;
    }

    fs.copyFileSync(from, to);
    // console.log(`updated '${to}'`);
  }
}

// function copyDtsTree(fromDir, toDir) {
//   for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
//     const from = path.join(fromDir, entry.name);
//     const to = path.join(toDir, entry.name);

//     if (entry.isDirectory()) {
//       copyDtsTree(from, to);
//       continue;
//     }

//     if (!entry.name.endsWith('.d.ts')) continue;

//     fs.mkdirSync(path.dirname(to), { recursive: true });
//     fs.copyFileSync(from, to);
//   }
// }
