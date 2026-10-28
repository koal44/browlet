'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { getSourceMapsSupport, setSourceMapsSupport, findSourceMap } = require('node:module');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { Worker } = require('node:worker_threads');
const { assertCollected } = require('./support/gc.cjs');
const { fixture } = require('./support/code-generation.cjs');
const { itPassesWith } = require('./support/test-runtime.cjs');
const compat = require('../addon/index.cjs');
const testCodeGeneration = itPassesWith('codeGeneration');

test('unregistered Node and VM contexts keep their existing compilation checks', () => {
  const disabled = vm.createContext({}, { codeGeneration: { strings: false } });
  assert.equal((0, eval)('40 + 2'), 42);
  assert.equal(vm.runInNewContext('Function("return 42")()'), 42);
  for (const source of ['eval("42")', 'Function("return 42")']) {
    assert.throws(() => vm.runInContext(source, disabled), { name: 'EvalError' });
  }
});

testCodeGeneration('native eval keeps direct scope and indirect realm scope', () => {
  const f = fixture();
  const originalEval = f.evaluate('eval');
  const originalFunction = f.evaluate('Function');
  f.context.globalProxy.realmValue = 40;
  assert.equal(f.evaluate('(function () { const local = 40; return eval("local + 2"); })()'), 42);
  assert.equal(f.evaluate('(function () { const realmValue = 0; return (0, eval)("realmValue + 2"); })()'), 42);
  assert.equal(f.calls.length, 2);
  assert.equal(f.evaluate('eval'), originalEval);
  assert.equal(f.evaluate('Function'), originalFunction);
});

testCodeGeneration('host permission blocks eval and all four Function constructors', () => {
  const f = fixture();
  f.setPolicy(() => false);
  for (const source of [
    'eval("42")', '(0, eval)("42")', 'Function("return 42")',
    '(async function () {}).constructor("return 42")',
    '(function* () {}).constructor("yield 42")', '(async function* () {}).constructor("yield 42")',
  ]) assert.throws(() => f.evaluate(source), f.evaluate('EvalError'), source);
  assert.equal(f.calls.length, 6);
});

testCodeGeneration('cached eval and Function sources are checked again after a policy change', () => {
  const f = fixture();
  const run = f.evaluate('source => eval(source)');
  const construct = f.evaluate('Function');
  for (let i = 0; i < 1000; i++) {
    assert.equal(run('40 + 2'), 42);
    assert.equal(construct('return 42')(), 42);
  }
  f.calls.length = 0;
  f.setPolicy(() => false);
  assert.throws(() => run('40 + 2'), f.evaluate('EvalError'));
  assert.throws(() => construct('return 42'), f.evaluate('EvalError'));
  assert.equal(f.calls.length, 2);
});

testCodeGeneration('a callback can observe and delegate unchanged without treating every object as code', () => {
  const f = fixture();
  const calls = [];
  compat.setModifyCodeGenerationFromStringsCallback(f.context.realm, function(...args) {
    assert.equal(this, undefined);
    assert.equal(args.length, 2);
    calls.push(args);
  });
  assert.equal(f.evaluate('eval("42")'), 42);
  assert.equal(f.evaluate('Function("return 42")()'), 42);
  for (const value of [new String('42'), { toString() { throw new Error('Must not stringify'); } }]) {
    f.context.globalProxy.input = value;
    assert.equal(f.evaluate('eval(input)'), value);
    assert.equal(f.evaluate('(0, eval)(input)'), value);
    assert.ok(calls.some(([source]) => source === value));
  }
  // V8 can consult the hook more than once for a non-string eval input.
  assert.equal(calls.every(([, flag]) => typeof flag === 'boolean'), true);
});

testCodeGeneration('normal Script and module compilation bypass the eval/Function gate', () => {
  const f = fixture();
  f.setPolicy(() => false);
  assert.equal(new compat.Script('42').runInContext(f.context), 42);
  const module = new compat.SourceTextModule('export default 42', { context: f.context });
  module.linkRequests([]);
  module.instantiate();
  module.evaluate();
  f.queue.runMicrotasks();
  assert.equal(module.namespace.default, 42);
  assert.equal(f.calls.length, 0);
});

testCodeGeneration('identity-based TrustedScript extraction preserves local scope without stringification', () => {
  const f = fixture();
  f.context.globalProxy.input = f.trusted('local + 2');
  f.context.globalProxy.input.toString = () => { throw new Error('Must not stringify'); };
  f.setPolicy((source, flag, original) => f.sources.has(original));
  assert.equal(f.evaluate('(function () { const local = 40; return eval(input); })()'), 42);
  f.setPolicy(() => false);
  assert.throws(() => f.evaluate('eval(input)'), f.evaluate('EvalError'));
});

testCodeGeneration('repeated extraction uses fresh source and reports syntax errors in the target realm', () => {
  const f = fixture();
  const evaluate = f.evaluate('(input) => { const local = 40; return eval(input); }');
  const first = f.trusted('local + 1');
  const second = f.trusted('local + 2');
  for (let i = 0; i < 1000; i++) assert.equal(evaluate(i % 2 ? first : second), i % 2 ? 41 : 42);
  assert.throws(() => evaluate(f.trusted('let = ;')), f.evaluate('SyntaxError'));
});

testCodeGeneration('callback exceptions and invalid results propagate without coercion', () => {
  const f = fixture();
  const sentinel = {};
  f.setPolicy(() => { throw sentinel; });
  for (const source of ['eval("42")', 'Function("return 42")']) {
    assert.throws(() => f.evaluate(source), error => error === sentinel);
  }
  for (const value of [true, null, 42, {}, Promise.resolve('42')]) {
    compat.setModifyCodeGenerationFromStringsCallback(f.context.realm, () => value);
    assert.throws(() => f.evaluate('eval("42")'), {
      name: 'TypeError', message: 'Expected a source string, false, or undefined',
    });
  }
  assert.throws(() => compat.setModifyCodeGenerationFromStringsCallback(f.context.realm, false), TypeError);
  assert.throws(() => compat.setModifyCodeGenerationFromStringsCallback(null, () => {}), TypeError);
});

testCodeGeneration('registered Node contexts retain their own denial after replacement and removal', () => {
  const context = vm.createContext({ input: {} }, { codeGeneration: { strings: false } });
  const realm = compat.getRealm(vm.runInContext('({})', context));
  const evaluate = source => vm.runInContext(source, context);
  const EvalError = evaluate('EvalError');
  compat.setModifyCodeGenerationFromStringsCallback(realm, () => '42');
  for (const source of ['eval(input)', 'eval("42")', 'Function("return 42")']) {
    assert.throws(() => evaluate(source), EvalError);
  }
  compat.setModifyCodeGenerationFromStringsCallback(realm, () => undefined);
  assert.throws(() => evaluate('eval("42")'), EvalError);
  compat.setModifyCodeGenerationFromStringsCallback(realm, undefined);
  assert.throws(() => evaluate('eval("42")'), EvalError);
  assert.throws(() => evaluate('Function("return 42")'), EvalError);
});

testCodeGeneration('registered and unrelated Node eval preserve generated source maps', () => {
  const context = vm.createContext({ input: {} });
  const realm = compat.getRealm(vm.runInContext('({})', context));
  const previous = getSourceMapsSupport();
  setSourceMapsSupport(true, { generatedCode: true });
  try {
    for (const kind of ['host', 'unchanged', 'extracted']) {
      const url = `file:///node-compat-code-generation-${kind}.js`;
      const map = { version: 3, sources: ['original.js'], names: [], mappings: 'AAAA', sourcesContent: ['40 + 2'] };
      const source = `40 + 2\n//# sourceURL=${url}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`;
      compat.setModifyCodeGenerationFromStringsCallback(realm, value => value === context.input ? source : undefined);
      const result = kind === 'host' ? (0, eval)(source) : kind === 'extracted' ?
        vm.runInContext('eval(input)', context) : vm.runInContext(`eval(${JSON.stringify(source)})`, context);
      assert.equal(result, 42);
      assert.deepEqual(findSourceMap(url)?.payload.sourcesContent, ['40 + 2']);
    }
  } finally {
    setSourceMapsSupport(previous.enabled, previous);
    compat.setModifyCodeGenerationFromStringsCallback(realm, undefined);
  }
});

testCodeGeneration('borrowed eval and Function use their own contexts rather than the caller context', () => {
  const first = fixture();
  const second = fixture();
  first.setPolicy(() => false);
  second.context.globalProxy.foreignEval = first.evaluate('eval');
  second.context.globalProxy.foreignFunction = first.evaluate('Function');
  assert.throws(() => second.evaluate('foreignEval("42")'), first.evaluate('EvalError'));
  assert.throws(() => second.evaluate('foreignFunction("return 42")'), first.evaluate('EvalError'));
  assert.equal(first.calls.length, 2);
  assert.equal(second.calls.length, 0);
  assert.equal(second.evaluate('eval("42")'), 42);
});

testCodeGeneration('replacement and removal affect only their context, including a reused global proxy', () => {
  const f = fixture();
  const realm = f.context.realm;
  const retained = f.evaluate('() => eval("42")');
  const EvalError = f.evaluate('EvalError');
  f.setPolicy(() => false);
  f.context.detachGlobal();
  const replacement = compat.createContextHandle({ reuseGlobalProxyFrom: f.context });
  assert.equal(replacement.globalProxy, f.context.globalProxy);
  assert.equal(compat.runInContext('eval("42")', replacement), 42);
  compat.setModifyCodeGenerationFromStringsCallback(replacement.realm, () => '43');
  assert.equal(compat.runInContext('eval("42")', replacement), 43);
  assert.throws(retained, EvalError);
  compat.setModifyCodeGenerationFromStringsCallback(realm, undefined);
  assert.equal(retained(), 42);
  assert.equal(compat.runInContext('eval("42")', replacement), 43);
  compat.setModifyCodeGenerationFromStringsCallback(replacement.realm, undefined);
  assert.equal(compat.runInContext('eval("42")', replacement), 42);
});

testCodeGeneration('callbacks may reenter another registered context or remove themselves', () => {
  const first = fixture();
  const second = fixture();
  compat.setModifyCodeGenerationFromStringsCallback(second.context.realm, () => '43');
  compat.setModifyCodeGenerationFromStringsCallback(first.context.realm, () => {
    const result = second.evaluate('eval("42")');
    compat.setModifyCodeGenerationFromStringsCallback(first.context.realm, undefined);
    return String(result);
  });
  assert.equal(first.evaluate('eval("42")'), 43);
  assert.equal(first.evaluate('eval("42")'), 42);
});

testCodeGeneration('retained functions retain their callback while discarded context cycles collect', async () => {
  function allocate(retain) {
    const f = fixture();
    const record = { f };
    const callback = () => { record.called = true; return '42'; };
    compat.setModifyCodeGenerationFromStringsCallback(f.context.realm, callback);
    return { fn: retain ? f.evaluate('() => eval("0")') : undefined,
      references: { callback: new WeakRef(callback), record: new WeakRef(record), context: new WeakRef(f.context),
        realm: new WeakRef(f.context.realm), global: new WeakRef(f.context.globalProxy) } };
  }
  const retained = allocate(true);
  await nextTurn();
  await global.gc({ type: 'major', execution: 'async', flavor: 'last-resort' });
  assert.ok(retained.references.callback.deref());
  assert.equal(retained.fn(), 42);
  assert.equal(retained.references.record.deref().called, true);
  await assertCollected(allocate(false).references);
});

testCodeGeneration('replaced and removed callbacks collect while their context remains alive', async () => {
  const f = fixture();
  function install() {
    const record = { marker: 42 };
    const callback = () => String(record.marker);
    compat.setModifyCodeGenerationFromStringsCallback(f.context.realm, callback);
    return { callback: new WeakRef(callback), record: new WeakRef(record) };
  }
  const replaced = install();
  const removed = install();
  await assertCollected(replaced);
  assert.equal(f.evaluate('eval("0")'), 42);
  compat.setModifyCodeGenerationFromStringsCallback(f.context.realm, undefined);
  await assertCollected(removed);
  assert.equal(f.evaluate('eval("0")'), 0);
});

itPassesWith('codeGeneration', 'hostHooks')('string compilation coexists with Promise hooks and explicit queues', () => {
  const f = fixture();
  const trace = [];
  let intercepted = 0;
  f.context.globalProxy.record = value => trace.push(value);
  compat.setHostHooks({ enqueuePromiseJob(job) {
    if (compat.getRealm(job) === f.context.realm) intercepted++;
    return false;
  } });
  f.evaluate('eval("Promise.resolve().then(() => record(42))")');
  assert.equal(intercepted, 1);
  assert.deepEqual(trace, []);
  f.queue.runMicrotasks();
  assert.deepEqual(trace, [42]);
});

testCodeGeneration('workers keep independent compilation callbacks through teardown', { timeout: 15000 }, async testContext => {
  const source = `
    const { workerData, parentPort } = require('node:worker_threads');
    const vm = require('node:vm');
    const compat = require(workerData);
    const context = compat.createContextHandle();
    compat.setModifyCodeGenerationFromStringsCallback(context.realm, () => false);
    try { compat.runInContext('eval("42")', context); throw new Error('Compilation was allowed'); }
    catch (error) { if (error.name !== 'EvalError') throw error; }
    if (vm.runInNewContext('eval("42")') !== 42) throw new Error('Node evaluation changed');
    globalThis.retained = context;
    global.gc();
    parentPort.postMessage(42);
  `;
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve, reject) => {
      const worker = new Worker(source, { eval: true, workerData: require.resolve('../addon/index.cjs') });
      testContext.after(() => worker.terminate());
      let value;
      worker.once('message', message => { value = message; });
      worker.once('error', reject);
      worker.once('exit', code => code === 0 && value === 42 ? resolve() : reject(new Error(`Worker exited ${code} with value ${value}`)));
    });
  }
});
