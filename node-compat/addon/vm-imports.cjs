'use strict';

// VM compilation metadata and context extras retain the registry's weak keys.
module.exports = (native, registry) => {
  native.installDynamicImportRouter((id, specifier, attributes, phase) => {
    if (phase !== 'evaluation' && phase !== 'source') {
      throw new Error(`Unsupported node-compat dynamic import phase: ${phase}`);
    }
    const { callback, referrer } = registry.get(id);
    return Reflect.apply(callback, undefined, [specifier, referrer, attributes, phase]);
  }, (value, phase, id) => {
    // Module result conversion belongs to the loader's original addon instance.
    const { convertResult } = registry.get(id);
    return convertResult(value, phase);
  });
};
