import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { require as tsxRequire } from 'tsx/cjs/api';

import * as esm from '../../packages/stylelet/dist/index.mjs';

const require = createRequire(import.meta.url);
const cjs = require('../../packages/stylelet/dist/index.cjs');
const { createStyleletTestEnvironment } = tsxRequire('../stylelet/environment-fixture.ts', import.meta.url);

for (const [format, api] of [['ESM', esm], ['CommonJS', cjs]]) {
  test(`Stylelet ${format} parses stylesheet URLs directly`, () => {
    const env = createStyleletTestEnvironment();
    const styles = new api.Stylelet(createDocument(), { env });
    assert.equal(styles.context.env, env);
    const sheet = styles.createStyleSheet({ baseURL: 'https://éxample.test/assets/' });
    assert.deepEqual(sheet.baseURL.host, { kind: 'domain', value: 'xn--xample-9ua.test' });
    assert.deepEqual(sheet.baseURL.path, ['assets', '']);
    assert.equal(sheet.href, null);
    assert.throws(() => styles.createStyleSheet({ baseURL: 'http://[' }), {
      name: 'NotAllowedError',
      message: 'The stylesheet base URL is invalid.',
    });
  });

  test(`Stylelet ${format} retains supplied execution for stylesheet replacement`, async () => {
    const env = createStyleletTestEnvironment();
    const exec = env.exec;
    const styles = new api.Stylelet(createDocument(), { env });
    const sheet = styles.createStyleSheet({ baseURL: '../styles/' });
    assert.equal(styles.context.env.exec, exec);
    assert.deepEqual(sheet.baseURL.path, ['styles', '']);
    const completed = await new Promise((resolve, reject) => {
      sheet.replace('main { color: red }').observe(resolve, reject);
    });
    assert.equal(completed, sheet);
    assert.equal(sheet.cssRules.length, 1);
  });
}

function createDocument() {
  const document = {
    nodeType: 9,
    baseURI: 'https://example.test/document/',
    documentElement: { nodeType: 1, ownerDocument: null },
    contentType: 'text/html',
    compatMode: 'CSS1Compat',
  };
  document.documentElement.ownerDocument = document;
  return document;
}
