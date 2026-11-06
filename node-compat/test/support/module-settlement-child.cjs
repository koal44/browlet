'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const { promiseHooks, getHeapStatistics } = require('node:v8');
const compat = require('../../addon/index.cjs');
const reports = [];
process.on('uncaughtException', error => reports.push(error));

/** Exercise rejection reporting after the evaluation and hook paths warm up. */
async function run() {
  const scenario = process.argv[2];
  let notifications = 0;
  const queue = compat.createMicrotaskQueue(() => { notifications++; });
  if (scenario === 'timeout' || scenario === 'notification') {
    const context = compat.createContextHandle({ microtaskQueue: queue });
    if (scenario === 'timeout') {
      assert.throws(() => vm.runInNewContext('while (true) Promise.resolve(1)', {}, { timeout: 30 }),
        { code: 'ERR_SCRIPT_EXECUTION_TIMEOUT' });
    }
    const state = compat.runInContext(`
      let resolve;
      const promise = new Promise(fulfill => { resolve = fulfill; });
      ({ resolve, promise });
    `, context);
    state.resolve(3);
    assert.equal(notifications, 1, 'ordinary settlement must notify synchronously');
    assert.equal(compat.getPromiseResult(state.promise), 3);
    queue.runMicrotasks();
    return;
  }
  if (scenario === 'throwing-hook') {
    const failure = new Error('genuine hook failure');
    let target;
    const stop = promiseHooks.onSettled(promise => { if (promise === target) throw failure; });
    let resolve;
    target = new Promise(fulfill => { resolve = fulfill; });
    resolve();
    stop();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(reports, [failure], 'a genuine hook exception must still report exactly once');
    return;
  }
  const node = scenario !== 'addon';
  const context = node ? vm.createContext({}) : compat.createContextHandle({ microtaskQueue: queue });
  if (!node) compat.setExceptionReporter(context, error => reports.push(error));
  const Module = node ? vm.SourceTextModule : compat.SourceTextModule;
  const prepare = async source => {
    const module_ = new Module(source, { context });
    if (node) await module_.link(() => {});
    else { module_.linkRequests([]); module_.instantiate(); }
    return module_;
  };
  // Instrumentation can inspect native state at Promise creation. Observing
  // settlement must not expose an unrelated module's pending exception to it.
  const stopInit = scenario === 'nested-init' ? undefined : promiseHooks.onInit(() => { getHeapStatistics(); });
  const warm = await prepare('export const value = 1;');
  for (let i = 0; i < 20000; i++) {
    const result = warm.evaluate();
    if (node) await result;
  }
  const failures = [new Error('handled module rejection'), { marker: 1 }, Symbol('failure'), 'failure', 42, null, undefined, false];
  for (const failure of failures) {
    if (node) context.failure = failure;
    else context.globalProxy.failure = failure;
    const module_ = await prepare('throw failure');
    let armed = true;
    const stopNested = scenario === 'nested-init' ? promiseHooks.onSettled(() => {
      if (!armed) return;
      armed = false;
      // A native init filter would expose the same pending-exception bug here.
      new Promise(() => {});
    }) : undefined;
    const result = module_.evaluate();
    if (node) await assert.rejects(result, error => Object.is(error, failure));
    else {
      result.catch(() => {});
      queue.runMicrotasks();
      assert.strictEqual(compat.getPromiseResult(result), failure);
    }
    stopNested?.();
    if (scenario === 'nested-init') assert.equal(armed, false);
    assert.equal(module_.status, 'errored');
    assert.strictEqual(module_.error, failure);
  }
  await new Promise(resolve => setImmediate(resolve));
  stopInit?.();
  assert.deepEqual(reports, [], 'handled module rejection must not also be an uncaught report');
  console.log('handled module rejection produced no uncaught report');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
