'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const compat = require('../../addon/index.cjs');
const native = require('./native-vm.cjs');

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
  dynamicImport: typeof native.installDynamicImportRouter === 'function',
  importMeta: typeof native.setImportMetaInitializer === 'function',
  codeGeneration: typeof compat.setModifyCodeGenerationFromStringsCallback === 'function',
  temporalClock: typeof compat.setTemporalHostSystemUTCEpochNanosecondsCallback === 'function',
  // V8 omits compilation kind, original Function arguments and boundaries,
  // and reports Function()'s implicit empty body as CodeLike.
  fullStringCompilation: false,
  // Public module bindings cannot preserve mutable Wasm globals, v128 TDZ,
  // or the original Wasm binding through a JavaScript re-export.
  completeWasmBindings: false,
  // Node 26/custom reuse the first Function body's import metadata; Node 24
  // passes the control. Keep the assertion strict so an engine fix is noticed.
  functionImportReferrer: Number(process.versions.node.split('.')[0]) < 26,
  finalizationRegistryPredicate: typeof compat.isFinalizationRegistry === 'function',
  hostHooks: typeof compat.setHostHooks === 'function',
  iteratorPredicates: typeof compat.isArrayIterator === 'function' &&
    typeof compat.isStringIterator === 'function' && typeof compat.isRegExpStringIterator === 'function',
  lengthTracking: typeof compat.isLengthTrackingArrayBufferView === 'function',
  'v26+': Number(process.versions.node.split('.')[0]) >= 26,
};
