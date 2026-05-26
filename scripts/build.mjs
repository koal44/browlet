import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { rollup } from 'rollup';

const tmpDir = 'dist/.tmp';
const tscOutFile = 'dist/.tmp/selectlet.js';
const bundleFile = 'dist/.tmp/selectlet.bundle.js';
const outFile = 'dist/selectlet.js';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = pkg.version;

fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

execSync('npx tsc -p tsconfig.build.json', { stdio: 'inherit' });

const bundle = await rollup({
  input: tscOutFile,
});

await bundle.write({
  file: bundleFile,
  format: 'es',
});

await bundle.close();

let source = fs.readFileSync(bundleFile, 'utf8');
source = source.replaceAll('__VERSION__', version);

source = source.replace(
  /(^|\n)export\s*\{[\s\S]*?\};?\s*(?=\n|$)/g,
  '$1'
);

const banner = `/*
 * selectlet v${version} | MIT
 * Copyright (c) 2007-2025 Diego Perini
 * Copyright (c) 2026 Eric Knowlton
 */

(function (global) {

`;

const footer = `
function installGlobal(glob, createSelectlet) {
  if (typeof module == 'object' && typeof exports == 'object') {
    module.exports = createSelectlet;
  } else if (typeof define == 'function' && define.amd) {
    define(createSelectlet);
  } else {
    glob.selectlet = createSelectlet(glob, installGlobal);
  }
}

installGlobal(global, createSelectlet);

})(typeof globalThis !== 'undefined' ? globalThis : this);
`;

fs.writeFileSync(outFile, banner + source + footer, 'utf8');
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`built '${outFile}' v${version}!`);
