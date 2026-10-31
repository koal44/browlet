'use strict';

const vm = require('node:vm');

let needsPromiseThenWorkaround = process.versions.node.startsWith('24.');

// Adapt the public options to the native context/evaluation arguments.
module.exports = (native, initializeGlobalObject) => {
  const { Module, SourceTextModule, SyntheticModule, WebAssemblyModule, resultForImport, captureWasmIntrinsics } =
    require('./vm-modules.cjs')(native, registerImport);
  const imports = native.installDynamicImportRouter &&
    require('./vm-imports.cjs')(native, resultForImport);

  function registerImport(callback, referrer) {
    checkImportCallback(callback);
    if (callback === undefined) return undefined;
    return imports.register(callback, referrer);
  }

  function checkImportCallback(callback) {
    if (callback === undefined) return;
    if (typeof callback !== 'function') throw new TypeError('Expected importModuleDynamically to be a function');
    if (!imports) throw new Error('Dynamic imports in addon contexts require the patched Node forwarding export');
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
        if (key !== 'microtaskQueue' && key !== 'reuseGlobalProxyFrom' && key !== 'globalPrototypeChain' && key !== 'globalAccess' &&
            key !== 'importModuleDynamically') {
          throw new TypeError(`Unsupported node-compat context option: ${key}`);
        }
      }
      const { microtaskQueue, reuseGlobalProxyFrom, globalPrototypeChain, globalAccess, importModuleDynamically } = options;
      // Validate before allocating a context or consuming a detached proxy.
      checkImportCallback(importModuleDynamically);
      const layout = globalPrototypeChain?.map(kind => {
        const index = ['mutable', 'immutable', 'delegated'].indexOf(kind);
        if (index === -1) throw new TypeError(`Unknown prototype kind: ${kind}`);
        return index;
      });
      const context = native.createContextHandle(microtaskQueue, reuseGlobalProxyFrom, layout, globalAccess);
      if (globalAccess && needsPromiseThenWorkaround) {
        // Node 24 lacks https://github.com/v8/v8/commit/626b689e9a9845b584fbbdd0917fb19cdc43f1f4.
        // Invalidate the isolate-wide Promise lookup optimization in a disposable
        // realm, preserving host/Window intrinsics. Remove after the V8 backport.
        const disposable = vm.createContext(vm.constants.DONT_CONTEXTIFY);
        vm.runInContext(`
          const then = Promise.prototype.then;
          Promise.prototype.then = function () {};
          Promise.prototype.then = then;
        `, disposable);
        needsPromiseThenWorkaround = false;
      }
      initializeGlobalObject(context);
      captureWasmIntrinsics(context);
      if (importModuleDynamically !== undefined) {
        native.setContextImportLoader(context, imports.register(importModuleDynamically, context));
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
  return {
    methods,
    // Distinguish absent metadata from foreign code; the host decides whether
    // it has a saved script context to restore when metadata is absent.
    getCompiledCode(options) {
      if (options.length === 0) return undefined;
      return imports ? imports.getReferrer(options) : null;
    },
  };
};
