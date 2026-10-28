'use strict';

// Compilation metadata or context extras retain the symbol; the weak association
// keeps the callback and Node-shaped referrer alive while that owner can import.
module.exports = (native, resultForImport) => {
  const loaders = new WeakMap();
  native.installDynamicImportRouter((id, specifier, attributes, phase) => {
    if (phase !== 'evaluation' && phase !== 'source') {
      throw new Error(`Unsupported node-compat dynamic import phase: ${phase}`);
    }
    const { callback, referrer } = loaders.get(id);
    return Reflect.apply(callback, undefined, [specifier, referrer, attributes, phase]);
  }, resultForImport);

  return (callback, referrer) => {
    const id = Symbol();
    loaders.set(id, { callback, referrer });
    return id;
  };
};
