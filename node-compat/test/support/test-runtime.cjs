'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const compat = require('../../addon/index.cjs');

/** Like the Vitest helper: execute unsupported cases and reject unexpected passes. */
exports.itPassesWith = function itPassesWith(...requirements) {
  if (requirements.every(requirement => supported[requirement])) return test;
  return (name, options, run) => {
    if (typeof options === 'function') {
      run = options;
      options = {};
    }
    return test(`${name} [expected failure]`, options, context =>
      assert.rejects(async () => run(context), 'Expected unsupported runtime test to fail'));
  };
};

const supported = {
  collectionIterators: typeof compat.createCollectionIterator === 'function',
  finalizationRegistryPredicate: typeof compat.isFinalizationRegistry === 'function',
  hostHooks: typeof compat.setHostHooks === 'function',
  iteratorPredicates: typeof compat.isArrayIterator === 'function' &&
    typeof compat.isStringIterator === 'function' && typeof compat.isRegExpStringIterator === 'function',
  lengthTracking: typeof compat.isLengthTrackingArrayBufferView === 'function',
  'v26+': Number(process.versions.node.split('.')[0]) >= 26,
};
