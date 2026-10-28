'use strict';

// Node's module object model over the addon's context handles. Loading remains
// the host's responsibility; these objects retain supplied dependencies only.
module.exports = native => {
  const records = new WeakMap();
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
      checkOptions(options, ['context', 'identifier', 'lineOffset']);
      const { context, lineOffset = 0, identifier = `vm:module(${nextIdentifier++})` } = options;
      super(context, identifier, () => native.compileModule(source, context, identifier, lineOffset));
      const record = recordFor(this);
      record.requests = Object.freeze(native.moduleRequests(record.handle).map(request => Object.freeze({
        __proto__: null,
        specifier: request.specifier,
        attributes: Object.freeze(Object.fromEntries(request.attributes.map(({ key, value }) => [key, value]))),
        phase: request.phase,
      })));
    }

    get moduleRequests() { return recordFor(this).requests; }

    linkRequests(modules) {
      const record = recordFor(this);
      if (this.status !== 'unlinked') throw new Error('Module must be unlinked');
      if (!Array.isArray(modules) || modules.length !== record.requests.length) {
        throw new TypeError('Supply one module per request, in request order');
      }
      for (const module of modules) {
        if (recordFor(module).context !== record.context) {
          throw new Error('Modules must belong to the same context');
        }
      }
      record.dependencies = modules.slice();
    }

    instantiate() {
      if (this.status !== 'unlinked') throw new Error('Module must be unlinked');
      const graph = new Map();
      const linkedRecords = [];
      const visit = module => {
        const record = recordFor(module);
        if (graph.has(record.handle) || module.status !== 'unlinked') return;
        const dependencies = record.dependencies ?? [];
        if (dependencies.length !== record.requests.length) {
          throw new Error('Supply module dependencies with linkRequests() before instantiation');
        }
        graph.set(record.handle, dependencies.map(dependency => recordFor(dependency).handle));
        linkedRecords.push(record);
        for (const dependency of dependencies) visit(dependency);
      };
      visit(this);
      native.linkModule(recordFor(this).handle, graph);
      // V8 now retains the linked graph. Host module objects need not stay alive.
      for (const record of linkedRecords) record.dependencies = undefined;
    }
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

  return { Module, SourceTextModule, SyntheticModule };
};
