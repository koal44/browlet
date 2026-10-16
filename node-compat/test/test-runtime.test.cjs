'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

for (const supported of [true, false]) {
  for (const throws of [true, false]) {
    for (const asynchronous of [true, false]) {
      test(`capability gate: supported=${supported}, throws=${throws}, async=${asynchronous}`, () => {
        const child = spawnSync(process.execPath, ['-e', `
          const compat = require(${JSON.stringify(require.resolve('../addon/index.cjs'))});
          compat.createCollectionIterator = ${supported ? '() => {}' : 'undefined'};
          const { itPassesWith } = require(${JSON.stringify(require.resolve('./support/test-runtime.cjs'))});
          itPassesWith('collectionIterators')('probe', ${asynchronous ? 'async' : ''} () => {
            ${asynchronous ? 'await Promise.resolve();' : ''}
            console.log('probe body ran');
            ${throws ? 'throw new Error("probe failure");' : ''}
          });
        `], { env: process.env, encoding: 'utf8' });
        assert.equal(child.status, supported === throws ? 1 : 0, child.stdout + child.stderr);
        assert.match(child.stdout, /probe body ran/);
        assert.equal(child.stdout.includes('[expected failure]'), !supported);
      });
    }
  }
}
