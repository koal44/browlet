'use strict';

const { join } = require('node:path');
const { addonBuild, requireFile, validateRuntimeVersion } = require('../node-base.cjs');
const base = process.env.NODE_BASE ?? '24.19.0';
validateRuntimeVersion(base, process.versions.node);
const build = addonBuild(base);
const hint = `Build the addon with npm run build:node-compat -- --base ${base}.`;
requireFile(join(build, 'node-compat.node'), hint);
requireFile(join(build, 'node.json'), hint);
const builtFor = require(join(build, 'node.json'));
if (builtFor.version !== process.versions.node || builtFor.modules !== process.versions.modules ||
    builtFor.arch !== process.arch || builtFor.platform !== process.platform) {
  throw new Error(`Addon ${base} was built for Node ${builtFor.version} (${builtFor.arch}); ` +
    `running ${process.versions.node} (${process.arch}). ${hint}`);
}
const native = require(join(build, 'node-compat.node'));

if (native.installHostHooks) {
  exports.setHostHooks = require('./host-hooks.cjs')(native);
}
exports.getRealm = native.getRealm;
exports.getFunctionRealm = native.getFunctionRealm;
exports.observePromise = native.observePromise;
exports.isArrayIterator = native.isArrayIterator;
exports.isStringIterator = native.isStringIterator;
exports.isRegExpStringIterator = native.isRegExpStringIterator;
exports.isWeakRef = native.isWeakRef;
exports.isFinalizationRegistry = native.isFinalizationRegistry;
exports.isLengthTrackingArrayBufferView = native.isLengthTrackingArrayBufferView;
exports.createCollectionIterator = native.createCollectionIterator;
exports.createHTMLDDA = native.createHTMLDDA;
Object.assign(exports, require('./vm.cjs')(native));
Object.assign(exports, require('./property-delegate.cjs')(native));
