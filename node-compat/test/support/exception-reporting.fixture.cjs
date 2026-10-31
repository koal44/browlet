'use strict';

const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const { setImmediate: nextTurn } = require('node:timers/promises');
const compat = require('../../addon/index.cjs');
const { assertCollected } = require('./gc.cjs');

async function main() {
  const mode = process.argv[2];
  const original = process._fatalException;
  const queue = compat.createMicrotaskQueue();
  const a = compat.createContextHandle({ microtaskQueue: queue });
  const b = compat.createContextHandle({ microtaskQueue: queue });
  const runA = source => compat.runInContext(source, a);
  const runB = source => compat.runInContext(source, b);
  const nodeErrors = [];
  const monitored = [];
  const pageErrors = [];
  process.on('uncaughtExceptionMonitor', error => monitored.push(error));
  if (mode === 'primary') process.setUncaughtExceptionCaptureCallback(error => nodeErrors.push(error));
  else process.on('uncaughtException', error => nodeErrors.push(error));
  compat.setExceptionReporter(a, error => pageErrors.push(error));
  compat.setExceptionReporter(b, () => { assert.fail('callback realm must not receive the registry error'); });
  const native = require('./native-vm.cjs');
  if (!native.getEnteredExceptionReporter) {
    assert.equal(process._fatalException, original, 'the custom Node hook must not replace the private handler');
  }

  if (mode === 'collection') {
    const references = (() => {
      const context = compat.createContextHandle({ microtaskQueue: queue });
      const reporter = () => context;
      compat.setExceptionReporter(context, reporter);
      return { context: new WeakRef(context), reporter: new WeakRef(reporter),
        object: new WeakRef(compat.runInContext('({})', context)) };
    })();
    await assertCollected(references);
  } else if (mode === 'reporter-failure') {
    const failure = new Error('internal reporter failure');
    compat.setExceptionReporter(a, () => { throw failure; });
    a.globalProxy.fail = runB('() => { throw 42; }');
    runA('globalThis.registry = new FinalizationRegistry(fail); registry.register({}, 1);');
    await until(() => nodeErrors.length === 1);
    assert.deepEqual(nodeErrors, [failure]);
    assert.deepEqual(monitored, [failure]);
  } else {
    for (const reason of [undefined, null, 42, Symbol('cleanup'), new Error('cleanup')]) {
      b.globalProxy.reason = reason;
      a.globalProxy.fail = runB('held => { globalThis.calls++; throw reason; }');
      runB('globalThis.calls = 0');
      const registry = runA(`
        globalThis.token = {};
        globalThis.registry = new FinalizationRegistry(fail);
        registry.register({}, 1, token);
        registry.register({}, 2, token);
        registry;
      `);
      compat.setExceptionReporter(a, error => {
        pageErrors.push(error);
        assert.equal(registry.unregister(a.globalProxy.token), true);
      });
      // Invalid replacement must leave the existing reporter installed.
      assert.throws(() => compat.setExceptionReporter(a, {}), TypeError);
      await until(() => pageErrors.length === 1);
      assert.equal(pageErrors.pop(), reason);
      assert.equal(runB('calls'), 1, 'report before another cleanup pass consumes remaining cells');
      assert.deepEqual(nodeErrors, []);
      assert.deepEqual(monitored, []);
    }

    if (mode !== 'abort') {
      // A Node-owned registry must stay with Node even with a VM-created callback
      // throwing the same Error that just belonged to an owned cleanup.
      const reason = b.globalProxy.reason;
      const registry = new FinalizationRegistry(runB('() => { throw reason; }'));
      registry.register({}, 1);
      await until(() => nodeErrors.length === 1);
      assert.deepEqual(nodeErrors, [reason]);
      assert.deepEqual(monitored, [reason]);
      assert.deepEqual(pageErrors, []);
      assert(registry, 'retain registry until native cleanup is observed');

      // Removing the reporter restores Node's behavior for that context.
      compat.setExceptionReporter(a, undefined);
      runA('globalThis.registry = new FinalizationRegistry(fail); registry.register({}, 1);');
      await until(() => nodeErrors.length === 2);
      assert.deepEqual(nodeErrors, [reason, reason]);
      assert.deepEqual(monitored, nodeErrors);

      // A later ordinary Node exception, including its async context, is intact.
      const storage = new AsyncLocalStorage();
      let store;
      if (mode === 'primary') process.setUncaughtExceptionCaptureCallback(null);
      process.on('uncaughtException', () => { store = storage.getStore(); });
      if (mode === 'primary') process.on('uncaughtException', error => nodeErrors.push(error));
      storage.run('host task', () => setImmediate(() => { throw reason; }));
      await until(() => nodeErrors.length === 3);
      assert.equal(store, 'host task');
      assert.deepEqual(monitored, nodeErrors);
    }
  }
  console.log(`PASS: ${mode}`);
}

async function until(predicate) {
  const deadline = performance.now() + 5000;
  do {
    await nextTurn();
    await global.gc({ type: 'major', execution: 'async' });
    await nextTurn();
    if (predicate()) return;
  } while (performance.now() < deadline);
  assert.fail('Native cleanup/reporting was not observed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
