'use strict';

const assert = require('node:assert/strict');
const { dirname, sep } = require('node:path');
const { setImmediate: nextTurn } = require('node:timers/promises');

async function main() {
  const entry = require.resolve('../../addon/index.cjs');
  const first = createGeneration(require(entry), 42);
  const gate = Promise.withResolvers();
  const pendingScript = new first.compat.Script('import("pending")', {
    importModuleDynamically: () => gate.promise,
  });
  const pending = first.observe(pendingScript.runInContext(first.context));

  // Keep the native binary loaded while replacing every JavaScript adapter.
  const directory = dirname(entry) + sep;
  for (const filename of Object.keys(require.cache)) {
    if (filename.startsWith(directory) && filename.endsWith('.cjs')) delete require.cache[filename];
  }
  const second = createGeneration(require(entry), 73);
  gate.resolve(first.target);
  assert.equal(await first.finish(pending), 42);

  for (const generation of [first, second]) {
    const { compat, context, script, module, observe, finish } = generation;
    assert.equal(await finish(observe(script.runInContext(context))), generation.answer);
    assert.equal(await finish(observe(module.namespace.load())), generation.answer);
    assert.equal(await finish(observe(compat.runInContext('import("context")', context))), generation.answer);
    assert.deepEqual(generation.referrers, [script, module, context]);
  }
  assert.equal((await import('data:text/javascript,export default 91')).default, 91);
}

function createGeneration(compat, answer) {
  const queue = compat.createMicrotaskQueue();
  const referrers = [];
  const load = (_specifier, referrer) => { referrers.push(referrer); return target; };
  const context = compat.createContextHandle({ microtaskQueue: queue, importModuleDynamically: load });
  const target = new compat.SyntheticModule(['answer'], function() { this.setExport('answer', answer); }, { context });
  target.evaluate();
  const script = new compat.Script('import("script")', { importModuleDynamically: load });
  const module = new compat.SourceTextModule('export const load = () => import("module");', {
    context, importModuleDynamically: load,
  });
  module.linkRequests([]);
  module.instantiate();
  module.evaluate();
  queue.runMicrotasks();

  function observe(promise) {
    const state = { settled: false };
    compat.observePromise(promise, context.globalProxy.Promise,
      value => { state.settled = true; state.value = value; },
      error => { state.settled = true; state.error = error; });
    return state;
  }

  async function finish(state) {
    for (let turn = 0; turn < 10 && !state.settled; turn++) {
      await nextTurn();
      queue.runMicrotasks();
    }
    assert.equal(state.settled, true, 'Import must settle');
    assert.equal(state.error, undefined);
    return state.value.answer;
  }

  return { compat, context, target, script, module, answer, referrers, observe, finish };
}

main().catch(error => { console.error(error); process.exitCode = 1; });
