'use strict';

const vm = require('node:vm');

// Adapt the public options to the native context/evaluation arguments.
module.exports = native => {
  const methods = {
    createMicrotaskQueue: native.createMicrotaskQueue,
    createContextHandle: function createContextHandle(options = {}) {
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
    },
    runInContext: function runInContext(source, handle, options = {}) {
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
    },
    isContext: native.isContext,
  };

  // A patched runtime can supply the remaining operation without changing the
  // addon's queue/context implementation. Stock Node leaves it unavailable.
  if (typeof vm.makePrototypeImmutable === 'function') {
    methods.makePrototypeImmutable = vm.makePrototypeImmutable;
  }
  return methods;
};
