'use strict';

// Compilation metadata or context extras retain the symbol; the weak association
// keeps the callback and Node-shaped referrer alive while that owner can import.
module.exports = (native, resultForImport) => {
  const loaders = new WeakMap();
  // Reloads reuse the environment's router and its weak loader associations.
  const registry = native.installDynamicImportRouter((id, specifier, attributes, phase) => {
    if (phase !== 'evaluation' && phase !== 'source') {
      throw new Error(`Unsupported node-compat dynamic import phase: ${phase}`);
    }
    const { callback, referrer } = loaders.get(id);
    return Reflect.apply(callback, undefined, [specifier, referrer, attributes, phase]);
  }, (value, phase, id) => {
    // Module result conversion belongs to the loader's original addon instance.
    const { convertResult } = loaders.get(id);
    return convertResult(value, phase);
  }, {
    register(callback, referrer, convertResult) {
      const id = Symbol();
      loaders.set(id, { callback, referrer, convertResult });
      return id;
    },
    // The native compilation metadata retains our loader symbol at index 1.
    // Only our own weakly registered identities can resolve to a VM object.
    getReferrer(options) { return loaders.get(options[1])?.referrer ?? null; },
  });

  return {
    register: (callback, referrer) => registry.register(callback, referrer, resultForImport),
    getReferrer: registry.getReferrer,
  };
};
