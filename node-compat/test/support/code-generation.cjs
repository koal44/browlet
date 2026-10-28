'use strict';

const compat = require('../../addon/index.cjs');

// Host-owned identity and stored source stand in for the later Binding/HTML
// TrustedScript hookup. These fixtures do not implement Trusted Types policy.
exports.fixture = function fixture() {
  const queue = compat.createMicrotaskQueue();
  const context = compat.createContextHandle({ microtaskQueue: queue });
  const evaluate = source => compat.runInContext(source, context);
  const sources = new WeakMap();
  const calls = [];
  let policy = () => true;
  const callback = (value, isCodeLike) => {
    calls.push([value, isCodeLike]);
    const source = typeof value === 'string' ? value : sources.get(value);
    if (source === undefined) return undefined;
    return policy(source, isCodeLike, value) ? source : false;
  };
  compat.setModifyCodeGenerationFromStringsCallback(context.realm, callback);
  return {
    context, queue, evaluate, sources, calls, callback,
    setPolicy(steps) { policy = steps; },
    trusted(source) {
      const value = { toString: () => source };
      sources.set(value, source);
      return value;
    },
  };
};
