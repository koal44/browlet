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
const vm = require('node:vm');

exports.supportsHostHooks = native.supportsHostHooks;
exports.setHostHooks = require('./host-hooks.cjs')(native);
exports.getRealm = native.getRealm;
exports.createMicrotaskQueue = native.createMicrotaskQueue;
exports.createContextHandle = function createContextHandle(options = {}) {
  for (const key of Object.keys(options)) {
    if (key !== 'microtaskQueue' && key !== 'reuseGlobalProxyFrom' && key !== 'globalPrototypeChain') {
      throw new TypeError(`Unsupported node-compat context option: ${key}`);
    }
  }
  const { microtaskQueue, reuseGlobalProxyFrom, globalPrototypeChain } = options;
  const layout = globalPrototypeChain?.map(kind => {
    const index = ['mutable', 'immutable', 'delegated'].indexOf(kind);
    if (index === -1) throw new TypeError(`Unknown prototype kind: ${kind}`);
    return index;
  });
  return native.createContextHandle(microtaskQueue, reuseGlobalProxyFrom, layout);
};
exports.setPropertyDelegate = function setPropertyDelegate(object, delegate) {
  native.setPropertyDelegate(object, propertyHandlers(delegate));
};
exports.setGlobalObject = function setGlobalObject(handle, object) {
  if (!native.isContext(handle) || handle.globalObject !== object) {
    throw new TypeError('Expected the context\'s allocated global object');
  }
  native.setPropertyDelegate(handle.globalProxy, propertyHandlers(object));
};
function propertyHandlers(delegate) {
  return {
    has: key => Reflect.has(delegate, key),
    // Native global callbacks omit the receiver to use the per-context target.
    get: (key, receiver = delegate) => Reflect.get(delegate, key, receiver),
    set: (key, value, receiver = delegate) => Reflect.set(delegate, key, value, receiver),
    descriptor: key => Reflect.getOwnPropertyDescriptor(delegate, key),
    query: key => {
      const descriptor = Reflect.getOwnPropertyDescriptor(delegate, key);
      if (descriptor === undefined) return undefined;
      return (descriptor.writable === false ? 1 : 0) |
        (descriptor.enumerable ? 0 : 2) | (descriptor.configurable ? 0 : 4);
    },
    define: (key, descriptor) => Reflect.defineProperty(delegate, key, descriptor),
    delete: key => Reflect.deleteProperty(delegate, key),
    keys: () => Reflect.ownKeys(delegate).filter(key => !isIndex(key)),
    indices: () => Reflect.ownKeys(delegate).filter(isIndex).map(Number),
  };
}
function isIndex(key) {
  return typeof key === 'string' && String(Number(key) >>> 0) === key &&
    key !== '4294967295';
}
exports.runInContext = function runInContext(source, handle, options = {}) {
  for (const key of Object.keys(options)) {
    if (key !== 'filename' && key !== 'lineOffset' && key !== 'displayErrors') {
      throw new TypeError(`Unsupported node-compat evaluation option: ${key}`);
    }
  }
  if (options.displayErrors !== undefined && options.displayErrors !== false) {
    throw new TypeError('node-compat does not implement displayErrors annotation');
  }
  return native.evaluate(source, handle, options.filename ?? 'node-compat.js',
    options.lineOffset ?? 0);
};
exports.isContext = native.isContext;

// A patched runtime can supply the remaining operation without changing the
// addon's queue/context implementation. Stock Node leaves it unavailable.
if (typeof vm.makePrototypeImmutable === 'function') {
  exports.makePrototypeImmutable = vm.makePrototypeImmutable;
}
