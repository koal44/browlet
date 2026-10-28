'use strict';

// Private bridge tests retain native handles so they can exercise validation,
// lifetime and source-phase support below the supported Node-shaped API.
const { join } = require('node:path');
const { addonBuild } = require('../../node-base.cjs');
const compat = require('../../addon/index.cjs');
const native = require(join(addonBuild(process.env.NODE_BASE ?? '24.19.0'), 'node-compat.node'));

module.exports = {
  ...native,
  createContextHandle: compat.createContextHandle,
  createDefaultExportModule(value, context) {
    const module = native.createSyntheticModule(['default'], context, () => {
      native.setSyntheticExport(module, 'default', value);
    }, 'default-export');
    return module;
  },
};
