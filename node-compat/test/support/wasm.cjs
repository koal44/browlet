'use strict';

const compat = require('../../addon/index.cjs');

function fixture() {
  const queue = compat.createMicrotaskQueue();
  const realm = compat.createContextHandle({ microtaskQueue: queue });
  return { queue, realm,
    compile: (source, identifier = 'module.js', options = {}) =>
      new compat.SourceTextModule(source, { context: realm, identifier, ...options }),
    compileWasm: (bytes, identifier = 'module.wasm') =>
      new compat.WebAssemblyModule(bytes, { context: realm, identifier }),
    run: source => compat.runInContext(source, realm),
    link(root, graph = new Map()) {
      const seen = new Set();
      function visit(module) {
        if (seen.has(module) || module.status !== 'unlinked') return;
        seen.add(module);
        const dependencies = graph.get(module) ?? [];
        module.linkRequests(dependencies);
        dependencies.forEach((dependency, i) => {
          if (module.moduleRequests[i].phase === 'evaluation') visit(dependency);
        });
      }
      visit(root);
      if (root.status === 'unlinked') root.instantiate();
    },
    evaluate(module) {
      const promise = module.evaluate();
      const result = { state: 'pending', promise };
      const observe = compat.runInContext('(p, done) => p.then(' +
        'value => done("fulfilled", value), error => done("rejected", error))', realm);
      observe(promise, (state, value) => Object.assign(result, { state, value }));
      queue.runMicrotasks();
      return result;
    },
  };
}

module.exports = { fixture, compat };
