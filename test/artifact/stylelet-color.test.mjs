import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

import * as esm from '../../packages/stylelet/dist/index.mjs';

const require = createRequire(import.meta.url);
const cjs = require('../../packages/stylelet/dist/index.cjs');

for (const [format, api] of [['ESM', esm], ['CommonJS', cjs]]) {
  test(`Stylelet ${format} exposes its color value API`, () => {
    const named = api.absoluteColorFromRgba(api.ColorRgba.red);
    assert.equal(named.space.name, 'srgb');
    assert.deepEqual(named.components, [255, 0, 0]);
    assert.equal(named.alpha, 255);
    assert.equal(api.ColorRgba.transparent, 0);

    const rgba = api.absoluteColorFromRgba(0x12345678);
    assert.deepEqual(rgba.components, [18, 52, 86]);
    assert.equal(rgba.alpha, 120);
    assert.equal(rgba.is8Bit, true);
  });
}
