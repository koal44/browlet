'use strict';

const vm = require('node:vm');

// Adapt the public options to the native context/evaluation arguments.
module.exports = native => {
  const { Module, SourceTextModule, SyntheticModule, WebAssemblyModule, resultForImport, captureWasmIntrinsics } =
    require('./vm-modules.cjs')(native, registerImport);
  const register = native.installDynamicImportRouter &&
    require('./vm-imports.cjs')(native, resultForImport);

  function registerImport(callback, referrer) {
    checkImportCallback(callback);
    if (callback === undefined) return undefined;
    return register(callback, referrer);
  }

  function checkImportCallback(callback) {
    if (callback === undefined) return;
    if (typeof callback !== 'function') throw new TypeError('Expected importModuleDynamically to be a function');
    if (!register) throw new Error('Dynamic imports in addon contexts require the patched Node forwarding export');
  }

  class Script {
    #handle;

    constructor(source, options = {}) {
      if (typeof options === 'string') options = { filename: options };
      for (const key of Object.keys(options)) {
        if (key !== 'filename' && key !== 'lineOffset' && key !== 'displayErrors' && key !== 'importModuleDynamically') {
          throw new TypeError(`Unsupported node-compat script option: ${key}`);
        }
      }
      if (options.displayErrors !== undefined && options.displayErrors !== false) {
        throw new TypeError('node-compat does not implement displayErrors annotation');
      }
      // A Script is unbound. HTML realizes parser failures in its selected realm.
      this.#handle = native.compileScript(`${source}`, undefined,
        options.filename ?? 'evalmachine.<anonymous>', options.lineOffset ?? 0,
        registerImport(options.importModuleDynamically, this));
    }

    runInContext(context, options = {}) {
      for (const key of Object.keys(options)) {
        if (key !== 'displayErrors') throw new TypeError(`Unsupported node-compat execution option: ${key}`);
      }
      if (options.displayErrors !== undefined && options.displayErrors !== false) {
        throw new TypeError('node-compat does not implement displayErrors annotation');
      }
      return native.runScript(this.#handle, context);
    }
  }

  const methods = {
    Script,
    Module, SourceTextModule, SyntheticModule, WebAssemblyModule,
    createMicrotaskQueue: native.createMicrotaskQueue,
    createContextHandle: function createContextHandle(options = {}) {
      for (const key of Object.keys(options)) {
        if (key !== 'microtaskQueue' && key !== 'reuseGlobalProxyFrom' && key !== 'globalPrototypeChain' &&
            key !== 'importModuleDynamically') {
          throw new TypeError(`Unsupported node-compat context option: ${key}`);
        }
      }
      const { microtaskQueue, reuseGlobalProxyFrom, globalPrototypeChain, importModuleDynamically } = options;
      // Validate before allocating a context or consuming a detached proxy.
      checkImportCallback(importModuleDynamically);
      const layout = globalPrototypeChain?.map(kind => {
        const index = ['mutable', 'immutable', 'delegated'].indexOf(kind);
        if (index === -1) throw new TypeError(`Unknown prototype kind: ${kind}`);
        return index;
      });
      const context = native.createContextHandle(microtaskQueue, reuseGlobalProxyFrom, layout);
      captureWasmIntrinsics(context);
      if (importModuleDynamically !== undefined) {
        native.setContextImportLoader(context, register(importModuleDynamically, context));
      }
      return context;
    },
    runInContext: function runInContext(source, handle, options = {}) {
      for (const key of Object.keys(options)) {
        if (key !== 'filename' && key !== 'lineOffset' && key !== 'displayErrors' && key !== 'importModuleDynamically') {
          throw new TypeError(`Unsupported node-compat evaluation option: ${key}`);
        }
      }
      if (options.displayErrors !== undefined && options.displayErrors !== false) {
        throw new TypeError('node-compat does not implement displayErrors annotation');
      }
      if (options.importModuleDynamically !== undefined) {
        return new Script(source, options).runInContext(handle);
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
