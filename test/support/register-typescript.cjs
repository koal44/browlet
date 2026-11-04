'use strict';

const { resolve } = require('node:path');

// TSX searches its disk-cache listing for every module. A shared temp cache can
// contain hundreds of thousands of entries from unrelated projects/worktrees.
// Let TSX capture a project-local directory, then restore the child's normal
// temp environment before the fixture runs. This caches transforms, not modules.
const cache = resolve(__dirname, '../../node-compat/.cache/tsx-unit');
const names = ['TMPDIR', 'TMP', 'TEMP'];
const previous = names.map(name => process.env[name]);
try {
  for (const name of names) process.env[name] = cache;
  require('tsx/cjs');
} finally {
  for (let index = 0; index < names.length; index++) {
    const name = names[index];
    if (previous[index] === undefined) delete process.env[name];
    else process.env[name] = previous[index];
  }
}
