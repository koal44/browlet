'use strict';

const { isModuleNamespaceObject } = require('node:util').types;

// Node's module object model over the addon's context handles. Loading remains
// the host's responsibility; these objects retain supplied dependencies only.
module.exports = (native, registerImport) => {
  const records = new WeakMap();
  const wasm = require('./vm-wasm.cjs')(native);
  let nextIdentifier = 0;

  class Module {
    constructor(context, identifier, createHandle) {
      if (new.target === Module) throw new TypeError('Module is not a constructor');
      records.set(this, { context, identifier, handle: createHandle(this) });
    }

    get context() { return recordFor(this).context; }
    get identifier() { return recordFor(this).identifier; }
    get status() { return native.moduleStatus(recordFor(this).handle); }
    get error() { return native.moduleError(recordFor(this).handle); }
    get namespace() { return native.moduleNamespace(recordFor(this).handle); }

    evaluate(options = {}) {
      try {
        checkOptions(options, []);
        const { handle } = recordFor(this);
        const status = native.moduleStatus(handle);
        if (status !== 'linked' && status !== 'evaluated' && status !== 'errored') {
          throw Object.assign(new Error('Module must be linked, evaluated, or errored'), {
            code: 'ERR_VM_MODULE_STATUS',
          });
        }
        return native.evaluateModule(handle);
      } catch (error) {
        // Node reports evaluation admission errors through a rejected host Promise.
        return Promise.reject(error);
      }
    }
  }

  class SourceTextModule extends Module {
    constructor(source, options = {}) {
      checkOptions(options, ['context', 'identifier', 'lineOffset', 'importModuleDynamically', 'initializeImportMeta']);
      const { context, lineOffset = 0, identifier = `vm:module(${nextIdentifier++})`, initializeImportMeta } = options;
      if (initializeImportMeta !== undefined) {
        if (typeof initializeImportMeta !== 'function') throw new TypeError('Expected initializeImportMeta to be a function');
        if (!native.setImportMetaInitializer) {
          throw new Error('import.meta initialization in addon contexts requires the patched Node forwarding export');
        }
      }
      super(context, identifier, module => native.compileModule(source, context, identifier, lineOffset,
        registerImport(options.importModuleDynamically, module)));
      const record = recordFor(this);
      if (initializeImportMeta !== undefined) {
        record.initializeImportMeta = meta => Reflect.apply(initializeImportMeta, undefined, [meta, this]);
      }
      record.requests = Object.freeze(native.moduleRequests(record.handle).map(request => Object.freeze({
        __proto__: null,
        specifier: request.specifier,
        attributes: Object.freeze(Object.fromEntries(request.attributes.map(({ key, value }) => [key, value]))),
        phase: request.phase,
      })));
    }

    get moduleRequests() { return recordFor(this).requests; }

    linkRequests(modules) {
      linkRequests(this, modules);
    }

    instantiate() {
      instantiate(this);
    }
  }

  // Node has no public Wasm VM class. This extension uses the same lifecycle as
  // SourceTextModule, while hiding the generated source and synthetic helper.
  class WebAssemblyModule extends Module {
    constructor(bytes, options = {}) {
      checkOptions(options, ['context', 'identifier']);
      const { context, identifier = `vm:wasm(${nextIdentifier++})` } = options;
      const compiled = wasm.compile(bytes, context);
      super(context, identifier, () => native.compileModule(compiled.sourceText, context, identifier, 0));
      const record = recordFor(this);
      record.wasm = compiled;
      record.requests = Object.freeze(compiled.specifiers.map(specifier => Object.freeze({
        __proto__: null, specifier, attributes: Object.freeze({ __proto__: null }), phase: 'evaluation',
      })));
      record.helper = new SyntheticModule(['default'], function() {
        this.setExport('default', compiled.instantiate);
      }, { context, identifier: `${identifier}:instantiate` });
    }

    get moduleRequests() { return recordFor(this).requests; }
    get source() { return recordFor(this).wasm.source; }
    get instance() { return recordFor(this).wasm.instance; }

    linkRequests(modules) { linkRequests(this, modules); }
    instantiate() { instantiate(this); }
  }

  class SyntheticModule extends Module {
    constructor(exportNames, evaluateCallback, options = {}) {
      checkOptions(options, ['context', 'identifier']);
      if (!Array.isArray(exportNames) || exportNames.some(name => typeof name !== 'string')) {
        throw new TypeError('Export names must be an array of strings');
      }
      if (new Set(exportNames).size !== exportNames.length) throw new TypeError('Export names must be unique');
      if (typeof evaluateCallback !== 'function') throw new TypeError('Expected an evaluation callback');
      const { context, identifier = `vm:module(${nextIdentifier++})` } = options;
      super(context, identifier, module => native.createSyntheticModule(
        exportNames, context, () => Reflect.apply(evaluateCallback, module, []), identifier,
      ));
      // Like current Node, synthetic modules are instantiated at construction.
      native.linkModule(recordFor(this).handle, new Map());
    }

    link() { recordFor(this); }

    setExport(name, value) {
      native.setSyntheticExport(recordFor(this).handle, name, value);
    }
  }

  function linkRequests(module, modules) {
    const record = recordFor(module);
    if (module.status !== 'unlinked') throw new Error('Module must be unlinked');
    if (!Array.isArray(modules) || modules.length !== record.requests.length) {
      throw new TypeError('Supply one module per request, in request order');
    }
    for (let i = 0; i < modules.length; ++i) {
      const dependency = recordFor(modules[i]);
      if (dependency.context !== record.context) throw new Error('Modules must belong to the same context');
      if (record.requests[i].phase === 'source' && dependency.wasm === undefined) {
        throw new TypeError('A source-phase dependency must be a WebAssemblyModule');
      }
    }
    record.dependencies = modules.slice();
  }

  function instantiate(module) {
    if (module.status !== 'unlinked') throw new Error('Module must be unlinked');
    const graph = new Map();
    const linkedRecords = [];
    const visit = module => {
      const record = recordFor(module);
      if (graph.has(record.handle) || module.status !== 'unlinked') return;
      const dependencies = record.dependencies ?? [];
      if (dependencies.length !== record.requests.length) {
        throw new Error('Supply module dependencies with linkRequests() before instantiation');
      }
      const supplied = dependencies.map((dependency, i) => record.requests[i].phase === 'source'
        ? recordFor(dependency).wasm.source : recordFor(dependency).handle);
      if (record.wasm !== undefined) {
        record.wasm.dependencies = dependencies.map(dependency => recordFor(dependency).wasm);
        supplied.push(recordFor(record.helper).handle);
      }
      graph.set(record.handle, supplied);
      linkedRecords.push(record);
      dependencies.forEach((dependency, i) => {
        if (record.requests[i].phase === 'evaluation') visit(dependency);
      });
    };
    visit(module);
    native.linkModule(recordFor(module).handle, graph);
    // Namespaces exist after linking. Let V8 retain initializers and their
    // public referrers even when only an exported function remains reachable.
    for (const record of linkedRecords) {
      if (record.initializeImportMeta !== undefined) {
        native.setImportMetaInitializer(record.handle, record.initializeImportMeta);
        record.initializeImportMeta = undefined;
      }
      record.dependencies = undefined;
    }
  }

  function recordFor(module) {
    const record = records.get(module);
    if (record === undefined) throw new TypeError('Expected a compatibility module');
    return record;
  }

  function checkOptions(options, supported) {
    if (options === null || typeof options !== 'object') throw new TypeError('Expected module options');
    for (const key of Object.keys(options)) {
      if (!supported.includes(key)) throw new TypeError(`Unsupported node-compat module option: ${key}`);
    }
  }

  function resultForImport(value, phase) {
    if (phase === 'source' && records.get(value)?.wasm !== undefined) return recordFor(value).wasm.source;
    if (phase !== 'source' && isModuleNamespaceObject(value)) return value;
    if (phase === 'source') throw new TypeError('A source-phase result must be a WebAssemblyModule');
    if (!records.has(value)) {
      throw Object.assign(new Error('Provided module is not an instance of Module'), {
        code: 'ERR_VM_MODULE_NOT_MODULE',
      });
    }
    if (value.status === 'errored') throw value.error;
    return value.namespace;
  }

  return { Module, SourceTextModule, SyntheticModule, WebAssemblyModule,
    resultForImport, captureWasmIntrinsics: wasm.captureIntrinsics };
};
