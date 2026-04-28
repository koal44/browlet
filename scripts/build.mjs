import fs from 'node:fs';

const outFile = 'dist/nwsapi.js';
const pkgFile = 'package.json';

const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
const version = pkg.version;

let source = fs.readFileSync(outFile, 'utf8');
source = source.replaceAll('__VERSION__', version);

source = source.replace(
  /(^|\n)export\s+(function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g,
  '$1$2 $3'
);

const banner = `/*
 * Copyright (C) 2007-2025 Diego Perini
 * All rights reserved.
 *
 * nwsapi.js - Fast CSS Selectors API Engine
 *
 * Author: Diego Perini <diego.perini at gmail com>
 * Version: ${version}
 * Created: 20070722
 * Release: 20251205
 *
 * License:
 *  https://javascript.nwbox.com/nwsapi/MIT-LICENSE
 * Download:
 *  https://javascript.nwbox.com/nwsapi/nwsapi.js
 */

(function (global) {

`;

const footer = `
function Export(glob, factory) {
  if (typeof module == 'object' && typeof exports == 'object') {
    module.exports = factory;
  } else if (typeof define == 'function' && define.amd) {
    define(factory);
  } else {
    glob.NW || (glob.NW = {});
    glob.NW.Dom = factory(glob, Export);
  }
}

Export(global, Factory);

})(typeof globalThis !== 'undefined' ? globalThis : this);
`;

fs.writeFileSync(outFile, banner + source + footer, 'utf8');
console.log(`wrapped ${outFile} with version ${version}`);
