'use strict';

const assert = require('node:assert/strict');
const process = require('node:process');
const { mock } = require('node:test');
const { runInNewContext } = require('node:vm');
const { WebAssembly } = globalThis;

// Instrument before loading JS Engine, without resetting the parent worker.
const exportsSpy = mock.method(WebAssembly.Module, 'exports');
const { isWebAssemblyModule } = require('../../../src/js-engine/built-in-primitives.ts');
const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const foreign = runInNewContext('new WebAssembly.Module(bytes)', { bytes });
for (const module of [new WebAssembly.Module(bytes), foreign]) {
  assert.equal(isWebAssemblyModule(module), true);
  Object.setPrototypeOf(module, null);
  Object.freeze(module);
  assert.equal(isWebAssemblyModule(module), true);
  assert.equal(isWebAssemblyModule(module), true);
}
assert.equal(exportsSpy.mock.callCount(), process.env.BROWLET_NODE_ADDON ? 0 : 2);
