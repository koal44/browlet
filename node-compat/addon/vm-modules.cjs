'use strict';

const { isModuleNamespaceObject } = require('node:util').types;
const createWasmGlobalResolver = require('./vm-module-bindings.cjs');

// Node's module object model over the addon's context handles. Loading remains
// the host's responsibility; these objects retain supplied dependencies only.
module.exports = (native, registerCompilation) => {
  const records = new WeakMap();
  // Associate the actual namespace, including namespaces obtained by an import
  // before the host ever reads Module.namespace. The namespace keeps its Wasm
  // record alive without retaining unrelated modules or wrapping engine objects.
  const wasmNamespaces = new WeakMap();
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
        registerCompilation(options.importModuleDynamically, module), options.importModuleDynamically !== undefined));
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
      checkOptions(options, ['context', 'identifier', 'createInstance', 'getExports', 'getSource']);
      const { context, identifier = `vm:wasm(${nextIdentifier++})`, createInstance, getExports, getSource } = options;
      if (createInstance !== undefined && typeof createInstance !== 'function') {
        throw new TypeError('Expected createInstance to be a function');
      }
      if (getExports !== undefined && typeof getExports !== 'function') {
        throw new TypeError('Expected getExports to be a function');
      }
      if (getSource !== undefined && typeof getSource !== 'function') {
        throw new TypeError('Expected getSource to be a function');
      }
      const compiled = wasm.compile(bytes, context, createInstance, getExports);
      super(context, identifier, () => native.compileModule(compiled.sourceText, context, identifier, 0));
      const record = recordFor(this);
      record.wasm = compiled;
      compiled.resolveGlobal = createWasmGlobalResolver(native, record);
      record.getSource = getSource;
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
    // Retain records after linking: a later Wasm consumer can recover the
    // original Global through an already-linked JavaScript re-export. These
    // are GC-traced records, not native roots or a context-wide registry.
    record.dependencies = modules.map(recordFor);
  }

  function instantiate(module) {
    if (module.status !== 'unlinked') throw new Error('Module must be unlinked');
    const graph = new Map();
    const linkedRecords = [];
    const visit = record => {
      if (graph.has(record.handle) || native.moduleStatus(record.handle) !== 'unlinked') return;
      const dependencies = record.dependencies ?? [];
      if (dependencies.length !== record.requests.length) {
        throw new Error('Supply module dependencies with linkRequests() before instantiation');
      }
      const supplied = dependencies.map((dependency, i) => record.requests[i].phase === 'source'
        ? sourceForImport(dependency) : dependency.handle);
      if (record.wasm !== undefined) {
        record.wasm.dependencies = dependencies.map(dependency => dependency.wasm);
        supplied.push(recordFor(record.helper).handle);
      }
      graph.set(record.handle, supplied);
      linkedRecords.push(record);
      dependencies.forEach((dependency, i) => {
        if (record.requests[i].phase === 'evaluation') visit(dependency);
      });
    };
    visit(recordFor(module));
    try {
      native.linkModule(recordFor(module).handle, graph);
    } finally {
      // V8 can finish linking a dependency before its parent fails. Retain that
      // dependency's namespace association even when the root call throws.
      for (const record of linkedRecords) {
        if (record.wasm === undefined) continue;
        if (native.moduleStatus(record.handle) === 'linked') {
          wasmNamespaces.set(native.moduleNamespace(record.handle), record.wasm);
        }
      }
    }
    // Namespaces exist after linking. Let V8 retain initializers and their
    // public referrers even when only an exported function remains reachable.
    for (const record of linkedRecords) {
      if (record.initializeImportMeta !== undefined) {
        native.setImportMetaInitializer(record.handle, record.initializeImportMeta);
        record.initializeImportMeta = undefined;
      }
    }
  }

  function recordFor(module) {
    const record = records.get(module);
    if (record === undefined) throw new TypeError('Expected a compatibility module');
    return record;
  }

  // null means a foreign/non-Wasm namespace; undefined means the known Wasm
  // record has not produced an Instance. No properties or Proxy traps are read.
  function getWebAssemblyNamespaceInstance(namespace) {
    const record = wasmNamespaces.get(namespace);
    return record === undefined ? null : record.instance;
  }

  function checkOptions(options, supported) {
    if (options === null || typeof options !== 'object') throw new TypeError('Expected module options');
    for (const key of Object.keys(options)) {
      if (!supported.includes(key)) throw new TypeError(`Unsupported node-compat module option: ${key}`);
    }
  }

  function resultForImport(value, phase) {
    if (phase === 'source' && records.get(value)?.wasm !== undefined) return sourceForImport(recordFor(value));
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

  // A browser binding can supply its platform Module without leaking the private
  // native backing. Ordinary addon clients continue to receive wasm.source.
  function sourceForImport(record) {
    return record.getSource === undefined ? record.wasm.source : record.getSource();
  }

  return { Module, SourceTextModule, SyntheticModule, WebAssemblyModule,
    resultForImport, getWebAssemblyNamespaceInstance, captureWasmIntrinsics: wasm.captureIntrinsics };
};
