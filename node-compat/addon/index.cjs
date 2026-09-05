'use strict';

const native = require('./build/node-compat.node');
const vm = require('node:vm');

exports.createMicrotaskQueue = native.createMicrotaskQueue;
exports.createContextHandle = function createContextHandle(options = {}) {
  for (const key of Object.keys(options)) {
    if (key !== 'microtaskQueue' && key !== 'reuseGlobalProxyFrom') {
      throw new TypeError(`Unsupported node-compat context option: ${key}`);
    }
  }
  const { microtaskQueue, reuseGlobalProxyFrom } = options;
  return native.createContextHandle(microtaskQueue, reuseGlobalProxyFrom);
};
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
