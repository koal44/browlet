'use strict';

const assert = require('node:assert/strict');
const { promiseHooks } = require('node:v8');
const compat = require('../../addon/index.cjs');
const mode = process.argv[2];
const reports = [];
const moduleFailure = new Error('module rejection');
const hookFailure = mode === 'same-error' ? moduleFailure : new Error('genuine hook failure');
process.on('uncaughtException', error => reports.push(error));

async function run() {
  let target;
  let capture = false;
  let stopHook;
  const addHook = () => promiseHooks.onSettled(promise => {
    if (promise === target) throw hookFailure;
  });
  if (mode === 'same-error') stopHook = addHook();
  const queue = compat.createMicrotaskQueue(() => {
    if (mode === 'callback') throw hookFailure;
  });
  if (mode === 'hook-last') stopHook = addHook();
  const context = compat.createContextHandle({ microtaskQueue: queue });
  compat.setExceptionReporter(context, error => reports.push(error));
  context.globalProxy.failure = moduleFailure;
  const warm = new compat.SourceTextModule('export const value = 1;', { context });
  warm.linkRequests([]);
  warm.instantiate();
  for (let i = 0; i < 20000; i++) warm.evaluate();
  queue.runMicrotasks();
  await new Promise(resolve => setImmediate(resolve));
  reports.length = 0;

  if (mode === 'callback') {
    const fulfill = compat.runInContext('let fulfill; new Promise(resolve => { fulfill = resolve; }); fulfill', context);
    fulfill();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(reports, [hookFailure], 'a genuine queue-notification error must report');
  } else {
    const source = mode === 'top-level-await' ? 'await 0; throw failure' : 'throw failure';
    const failing = new compat.SourceTextModule(source, { context });
    failing.linkRequests([]);
    failing.instantiate();
    const stopInit = promiseHooks.onInit(promise => { if (capture && !target) target = promise; });
    capture = true;
    const result = failing.evaluate();
    capture = false;
    stopInit();
    assert.equal(result, target);
    result.catch(() => {});
    queue.runMicrotasks();
    assert.equal(compat.getPromiseResult(result), moduleFailure);
    assert.equal(failing.status, 'errored');
    assert.equal(failing.error, moduleFailure);
    stopHook?.();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(reports, mode === 'top-level-await' ? [] : [hookFailure],
      'keep genuine hook reports, including one deliberately throwing the same error object');
  }
  console.log(mode + ': correct rejection and reporting');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
