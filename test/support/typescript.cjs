'use strict';

const { resolve } = require('node:path');

const { register } = loadTSX();
let scopedRequire;

/** Load TypeScript without replacing the caller's ordinary module loader. */
function requireTypeScript(id, fromFile) {
  // tsx.require() chooses a timestamp namespace, making disk-cache keys change
  // on every run. A stable namespace reuses transforms, never evaluated modules
  // across processes, and keeps Playwright's loader outside this source graph.
  scopedRequire ??= register({ namespace: 'browlet-tooling' }).require;
  return scopedRequire(id, fromFile);
}

/** Register the ordinary CommonJS hook in a dedicated TypeScript child process. */
function registerTypeScript() {
  return register();
}

function loadTSX() {
  // TSX linearly searches its disk-cache listing for every module. Share the
  // existing project-local child-fixture cache instead of the global temp cache.
  // Restore temp settings before any loaded source or fixture can observe them.
  const cache = resolve(__dirname, '../../node-compat/.cache/tsx-unit');
  const names = ['TMPDIR', 'TMP', 'TEMP'];
  const previous = names.map(name => process.env[name]);
  try {
    for (const name of names) process.env[name] = cache;
    return require('tsx/cjs/api');
  } finally {
    for (let index = 0; index < names.length; index++) {
      const name = names[index];
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    }
  }
}

exports.requireTypeScript = requireTypeScript;
exports.registerTypeScript = registerTypeScript;
