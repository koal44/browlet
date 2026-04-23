import fs from 'node:fs';

const outFile = 'dist/nwsapi.js';
const pkgFile = 'package.json';

const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
const version = pkg.version;

const source = fs.readFileSync(outFile, 'utf8');
const replacedSource = source.replaceAll('__VERSION__', version);

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
  'use strict';

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




fs.writeFileSync(outFile, banner + replacedSource + footer, 'utf8');
console.log(`wrapped ${outFile} with version ${version}`);
