'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { setImmediate: nextTurn } = require('node:timers/promises');
const vm = require('node:vm');
const { Worker } = require('node:worker_threads');
const { assertCollected } = require('./support/gc.cjs');
const { itPassesWith } = require('./support/test-runtime.cjs');
const compat = require('../addon/index.cjs');
const setClock = compat.setTemporalHostSystemUTCEpochNanosecondsCallback;
const testTemporal = itPassesWith('temporalClock');
const timestamp = 1234567890123456789n;

testTemporal('Temporal reads a live context clock without replacing its methods or Node clocks', () => {
  const f = fixture();
  const other = compat.createContextHandle();
  const originalNow = f.evaluate('Temporal.Now.instant');
  let value = timestamp;
  setClock(f.context.realm, function(...args) {
    assert.equal(this, undefined);
    assert.equal(args.length, 0);
    return value++;
  });
  assert.equal(f.evaluate('Temporal.Now.instant'), originalNow);
  assert.equal(originalNow().epochNanoseconds, timestamp);
  assert.equal(originalNow().epochNanoseconds, timestamp + 1n);
  assert.notEqual(compat.runInContext('Temporal.Now.instant().epochNanoseconds', other), timestamp);
  assert.notEqual(globalThis.Temporal.Now.instant().epochNanoseconds, timestamp);
  assert.notEqual(f.evaluate('Date.now()'), Number(timestamp / 1000000n));
});

testTemporal('all Temporal.Now clock readers use the installed clock', () => {
  const f = fixture();
  setClock(f.context.realm, () => timestamp);
  const expected = globalThis.Temporal.Instant.fromEpochNanoseconds(timestamp).toZonedDateTimeISO('UTC');
  for (const [expression, result] of [
    ['instant()', expected.toInstant().toString()],
    ["zonedDateTimeISO('UTC')", expected.toString()],
    ["plainDateTimeISO('UTC')", expected.toPlainDateTime().toString()],
    ["plainDateISO('UTC')", expected.toPlainDate().toString()],
    ["plainTimeISO('UTC')", expected.toPlainTime().toString()],
  ]) assert.equal(f.evaluate(`Temporal.Now.${expression}.toString()`), result, expression);
});

testTemporal('clock readings preserve signed nanoseconds through both int64 endpoints', () => {
  const f = fixture();
  let value;
  setClock(f.context.realm, () => value);
  for (value of [timestamp, 0n, -1n, -timestamp, -(2n ** 63n), 2n ** 63n - 1n]) {
    assert.equal(f.evaluate('Temporal.Now.instant().epochNanoseconds'), value);
  }
});

testTemporal('Node VM contexts accept the same clock registration', () => {
  const context = vm.createContext({});
  const realm = compat.getRealm(vm.runInContext('({})', context));
  setClock(realm, () => timestamp);
  assert.equal(vm.runInContext('Temporal.Now.instant().epochNanoseconds', context), timestamp);
  setClock(realm, undefined);
  assert.notEqual(vm.runInContext('Temporal.Now.instant().epochNanoseconds', context), timestamp);
});

testTemporal('borrowed Temporal.Now methods use their own context clock', () => {
  const first = fixture();
  const second = fixture();
  setClock(first.context.realm, () => timestamp);
  setClock(second.context.realm, () => -timestamp);
  const borrowed = first.evaluate('Temporal.Now.instant');
  second.context.globalProxy.borrowed = borrowed;
  assert.equal(second.evaluate('borrowed().epochNanoseconds'), timestamp);
  assert.equal(second.evaluate('Temporal.Now.instant().epochNanoseconds'), -timestamp);
  assert.equal(borrowed().epochNanoseconds, timestamp);
});

testTemporal('replacing and removing clocks leaves other contexts unchanged', () => {
  const first = fixture();
  const second = fixture();
  setClock(first.context.realm, () => timestamp);
  setClock(second.context.realm, () => -timestamp);
  setClock(first.context.realm, () => 0n);
  assert.equal(first.evaluate('Temporal.Now.instant().epochNanoseconds'), 0n);
  assert.equal(second.evaluate('Temporal.Now.instant().epochNanoseconds'), -timestamp);
  setClock(first.context.realm, undefined);
  setClock(first.context.realm, undefined);
  assert.notEqual(first.evaluate('Temporal.Now.instant().epochNanoseconds'), 0n);
  assert.equal(second.evaluate('Temporal.Now.instant().epochNanoseconds'), -timestamp);
});

testTemporal('clock state stays with retained Temporal methods when a global proxy is reused', () => {
  const f = fixture();
  setClock(f.context.realm, () => timestamp);
  const now = f.evaluate('Temporal.Now.instant');
  f.context.detachGlobal();
  const replacement = compat.createContextHandle({ reuseGlobalProxyFrom: f.context });
  assert.equal(replacement.globalProxy, f.context.globalProxy);
  assert.notEqual(compat.runInContext('Temporal.Now.instant().epochNanoseconds', replacement), timestamp);
  setClock(replacement.realm, () => -timestamp);
  assert.equal(now().epochNanoseconds, timestamp);
  assert.equal(compat.runInContext('Temporal.Now.instant().epochNanoseconds', replacement), -timestamp);
  setClock(f.context.realm, undefined);
  assert.notEqual(now().epochNanoseconds, timestamp);
  assert.equal(compat.runInContext('Temporal.Now.instant().epochNanoseconds', replacement), -timestamp);
});

testTemporal('clock callbacks can read another context and remove themselves', () => {
  const first = fixture();
  const second = fixture();
  setClock(second.context.realm, () => timestamp);
  setClock(first.context.realm, () => {
    const result = second.evaluate('Temporal.Now.instant().epochNanoseconds');
    setClock(first.context.realm, undefined);
    return result;
  });
  assert.equal(first.evaluate('Temporal.Now.instant().epochNanoseconds'), timestamp);
  assert.notEqual(first.evaluate('Temporal.Now.instant().epochNanoseconds'), timestamp);
});

testTemporal('retained Temporal methods retain clocks while discarded context cycles collect', async () => {
  function allocate(retain) {
    const f = fixture();
    const record = { f, value: timestamp };
    const callback = () => record.value;
    setClock(f.context.realm, callback);
    return { now: retain ? f.evaluate('Temporal.Now.instant') : undefined,
      references: { callback: new WeakRef(callback), record: new WeakRef(record),
        context: new WeakRef(f.context), realm: new WeakRef(f.context.realm),
        global: new WeakRef(f.context.globalProxy) } };
  }
  const retained = allocate(true);
  await nextTurn();
  await global.gc({ type: 'major', execution: 'async', flavor: 'last-resort' });
  assert.ok(retained.references.callback.deref());
  assert.equal(retained.now().epochNanoseconds, timestamp);
  await assertCollected(allocate(false).references);
});

testTemporal('replaced and removed clocks collect while their context remains alive', async () => {
  const f = fixture();
  function install() {
    const record = { value: timestamp };
    const callback = () => record.value;
    setClock(f.context.realm, callback);
    return { callback: new WeakRef(callback), record: new WeakRef(record) };
  }
  const replaced = install();
  const removed = install();
  await assertCollected(replaced);
  assert.equal(f.evaluate('Temporal.Now.instant().epochNanoseconds'), timestamp);
  setClock(f.context.realm, undefined);
  await assertCollected(removed);
  assert.notEqual(f.evaluate('Temporal.Now.instant().epochNanoseconds'), timestamp);
});

testTemporal('reading the clock does not run an explicit microtask checkpoint', () => {
  const f = fixture();
  const trace = [];
  f.context.globalProxy.record = value => trace.push(value);
  setClock(f.context.realm, () => {
    f.evaluate('Promise.resolve().then(() => record(42))');
    return timestamp;
  });
  assert.equal(f.evaluate('Temporal.Now.instant().epochNanoseconds'), timestamp);
  assert.deepEqual(trace, []);
  f.queue.runMicrotasks();
  assert.deepEqual(trace, [42]);
});

testTemporal('invalid registration arguments throw without changing an installed clock', () => {
  const f = fixture();
  setClock(f.context.realm, () => timestamp);
  for (const value of [false, null, 0n, {}]) {
    assert.throws(() => setClock(f.context.realm, value), TypeError);
  }
  assert.throws(() => setClock(null, () => timestamp), TypeError);
  assert.equal(f.evaluate('Temporal.Now.instant().epochNanoseconds'), timestamp);
});

testTemporal('workers keep context clocks separate through teardown', { timeout: 15000 }, async testContext => {
  assert.equal(typeof setClock, 'function');
  const source = `
    const { workerData, parentPort } = require('node:worker_threads');
    const compat = require(workerData);
    const context = compat.createContextHandle();
    compat.setTemporalHostSystemUTCEpochNanosecondsCallback(context.realm, () => 42n);
    const result = compat.runInContext('Temporal.Now.instant().epochNanoseconds', context);
    if (Temporal.Now.instant().epochNanoseconds === 42n) throw new Error('Node clock changed');
    globalThis.retained = context;
    global.gc();
    parentPort.postMessage(result);
  `;
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve, reject) => {
      const worker = new Worker(source, { eval: true, workerData: require.resolve('../addon/index.cjs') });
      testContext.after(() => worker.terminate());
      let value;
      worker.once('message', message => { value = message; });
      worker.once('error', reject);
      worker.once('exit', code => code === 0 && value === 42n ? resolve() : reject(new Error(`Worker exited ${code} with value ${value}`)));
    });
  }
});

testTemporal('clock contract violations stop execution rather than supply a fabricated reading', () => {
  assert.equal(typeof setClock, 'function');
  for (const [mode, message] of [
    ['throw', 'Clock callback must not throw'],
    ['number', 'Clock callback must return a bigint'],
    ['promise', 'Clock callback must return a bigint'],
    ['positive-overflow', 'Clock callback must return signed 64-bit nanoseconds'],
    ['negative-overflow', 'Clock callback must return signed 64-bit nanoseconds'],
  ]) {
    const child = spawnSync(process.execPath, [join(__dirname, 'support/temporal-contract.fixture.cjs'), mode], {
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    assert.ifError(child.error);
    assert.notEqual(child.status, 0);
    assert.ok(child.stderr.includes(message), child.stderr);
    assert.doesNotMatch(child.stdout, /^continued$/mu);
    assert.doesNotMatch(child.stdout, /^caught$/mu);
  }
});

function fixture() {
  const queue = compat.createMicrotaskQueue();
  const context = compat.createContextHandle({ microtaskQueue: queue });
  return { context, queue, evaluate: source => compat.runInContext(source, context) };
}
