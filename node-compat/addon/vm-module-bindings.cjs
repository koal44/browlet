'use strict';

/**
 * Create an optional native-global resolver for this module record's graph.
 * Read its supplied evaluation edges at lookup time, after linking. Returning
 * undefined leaves vm-wasm.cjs on its ordinary namespace-value import path.
 */
module.exports = (native, root) => {
  // HACK: vm-module-bindings.cc owns the version-guarded private layout reads.
  // Keep their JavaScript consumer here so a public binding-identity API can
  // replace the predicate, or the resolver can be removed at its one call site.
  if (!native.haveSameModuleBinding) return undefined;

  return (namespace, name) => {
    // V8 has resolved aliases, star exports and ambiguity. Follow evaluation
    // edges to find a known Wasm export with that exact binding; equal values
    // and copied JavaScript exports must not recover a native Global.
    const pending = [root];
    const seen = new Set();
    while (pending.length) {
      const record = pending.pop();
      if (seen.has(record)) continue;
      seen.add(record);
      if (record.wasm !== undefined) {
        const candidate = native.moduleNamespace(record.handle);
        for (const exported of record.wasm.globalExports) {
          if (native.haveSameModuleBinding(namespace, name, candidate, exported)) {
            return { module: record.wasm, name: exported };
          }
        }
      }
      record.dependencies?.forEach((dependency, i) => {
        if (record.requests[i].phase === 'evaluation') pending.push(dependency);
      });
    }
  };
};
