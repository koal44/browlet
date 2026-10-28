'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { Worker } = require('node:worker_threads');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { assertCollected } = require('./support/gc.cjs');
const { itPassesWith } = require('./support/test-runtime.cjs');
const compat = require('../addon/index.cjs');
const testImport = itPassesWith('dynamicImport');

test('Node and unrelated VM imports retain their loaders', async () => {
  const source = 'data:text/javascript,export default 42';
  assert.equal((await import(source)).default, 42);
  const referrers = [];
  const script = new vm.Script('import("value")', {
    importModuleDynamically(specifier, referrer) {
      assert.equal(specifier, 'value');
      referrers.push(referrer);
      return import(source);
    },
  });
  assert.equal((await script.runInThisContext()).default, 42);
  assert.deepEqual(referrers, [script]);
});

testImport('Script passes the Node callback arguments and uses the importing queue', () => {
  const f = fixture();
  const other = fixture();
  const target = moduleFor(f);
  let call;
  const script = new compat.Script('import("value", { with: { type: "json" } })', {
    importModuleDynamically(...args) { call = args; return target; },
  });
  other.queue.enqueueMicrotask(compat.runInContext('() => { globalThis.ran = true; }', other.context));
  const promise = script.runInContext(f.context);
  assert.equal(Object.getPrototypeOf(promise), f.context.globalProxy.Promise.prototype);
  assert.equal(call[0], 'value');
  assert.equal(call[1], script);
  assert.equal(Object.getPrototypeOf(call[2]), null);
  assert.equal(call[2].type, 'json');
  assert.equal(call[3], 'evaluation');
  const result = observe(f, promise);
  assert.equal(result.settled, false);
  f.queue.runMicrotasks();
  assert.equal(result.value, target.namespace);
  assert.equal(result.value.value, 42);
  assert.equal(other.context.globalProxy.ran, undefined);
});

testImport('SourceTextModule and runInContext expose the same callback contract', () => {
  const f = fixture({ importModuleDynamically: () => assert.fail('Used the context fallback instead of script metadata') });
  const target = moduleFor(f);
  let referrer;
  const root = new compat.SourceTextModule('export const loaded = import("value");', {
    context: f.context,
    importModuleDynamically(specifier, module, attributes, phase) {
      assert.equal(specifier, 'value');
      assert.deepEqual(Object.keys(attributes), []);
      assert.equal(phase, 'evaluation');
      referrer = module;
      return target.namespace;
    },
  });
  root.linkRequests([]);
  root.instantiate();
  const evaluation = observe(f, root.evaluate());
  const result = observe(f, root.namespace.loaded);
  f.queue.runMicrotasks();
  assert.equal(referrer, root);
  assert.equal(evaluation.error, undefined);
  assert.equal(result.value, target.namespace);
  const second = observe(f, compat.runInContext('import("value")', f.context, {
    importModuleDynamically(_specifier, script) {
      assert.ok(script instanceof compat.Script);
      return target;
    },
  }));
  f.queue.runMicrotasks();
  assert.equal(second.value, target.namespace);
});

testImport('context fallback uses the importing context, callback arguments, and queue', () => {
  let target, call;
  const f = fixture({ importModuleDynamically(...args) { call = args; return target; } });
  target = moduleFor(f);
  const other = fixture({ importModuleDynamically: () => assert.fail('Used the caller context') });
  const load = compat.runInContext('() => import("value", { with: { type: "json" } })', f.context);
  const invoke = compat.runInContext('fn => fn()', other.context);
  const promise = invoke(load);
  assert.equal(Object.getPrototypeOf(promise), f.context.globalProxy.Promise.prototype);
  assert.equal(call[0], 'value');
  assert.equal(call[1], f.context);
  assert.equal(Object.getPrototypeOf(call[2]), null);
  assert.equal(call[2].type, 'json');
  assert.equal(call[3], 'evaluation');
  const result = observe(f, promise);
  other.queue.runMicrotasks();
  assert.equal(result.settled, false);
  f.queue.runMicrotasks();
  assert.equal(result.value, target.namespace);
});

testImport('one unbound script without metadata selects each execution context fallback', () => {
  const contexts = [1, 2].map(value => {
    let target;
    const f = fixture({ importModuleDynamically(_specifier, referrer) {
      assert.equal(referrer, f.context);
      return target;
    } });
    target = moduleFor(f, value);
    return f;
  });
  const script = new compat.Script('import("value")');
  const results = contexts.map(f => observe(f, script.runInContext(f.context)));
  contexts[0].queue.runMicrotasks();
  assert.equal(results[0].value.value, 1);
  assert.equal(results[1].settled, false);
  contexts[1].queue.runMicrotasks();
  assert.equal(results[1].value.value, 2);
});

testImport('context fallback leaves Node-owned generated code with its Node loader', async () => {
  const f = fixture({ importModuleDynamically: () => assert.fail('Intercepted Node metadata') });
  const requests = [];
  let completion;
  for (const [compile, source] of [
    [f.context.globalProxy.Function, `return compile("return import('node:path')")();`],
    [f.context.globalProxy.eval, `return compile("import('node:path')");`],
  ]) {
    const invoke = vm.compileFunction(source, ['compile'], {
      importModuleDynamically(specifier) {
        requests.push(specifier);
        completion = import(specifier);
        return completion;
      },
    });
    const promise = invoke(compile);
    assert.equal(Object.getPrototypeOf(promise), f.context.globalProxy.Promise.prototype);
    const result = observe(f, promise);
    await completion;
    await nextTurn();
    f.queue.runMicrotasks();
    assert.equal(result.error, undefined);
    assert.equal(result.value.default, require('node:path'));
  }
  assert.deepEqual(requests, ['node:path', 'node:path']);
});

test('missing script and context loaders retain Node\'s rejection', async () => {
  const f = fixture();
  const result = observe(f, compat.runInContext('import("unregistered")', f.context));
  f.queue.runMicrotasks();
  await nextTurn();
  f.queue.runMicrotasks();
  assert.equal(result.error.code, 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING');
});

test('invalid context import options do not consume a detached global proxy', () => {
  const first = compat.createContextHandle();
  first.detachGlobal();
  assert.throws(() => compat.createContextHandle({ reuseGlobalProxyFrom: first, importModuleDynamically: 0 }), {
    name: 'TypeError', message: 'Expected importModuleDynamically to be a function',
  });
  const second = compat.createContextHandle({ reuseGlobalProxyFrom: first });
  assert.equal(second.globalProxy, first.globalProxy);
});

testImport('async loaders can wait for top-level await and preserve namespace identity', () => {
  const f = fixture();
  const target = new compat.SourceTextModule('await new Promise(r => globalThis.release = r); export const value = 42;', {
    context: f.context,
  });
  target.linkRequests([]);
  target.instantiate();
  const finish = compat.runInContext('(done, module) => done.then(() => module)', f.context);
  const completion = finish(target.evaluate(), target);
  const script = new compat.Script('import("value")', { importModuleDynamically: () => completion });
  const result = observe(f, script.runInContext(f.context));
  f.queue.runMicrotasks();
  assert.equal(result.settled, false);
  f.context.globalProxy.release();
  f.queue.runMicrotasks();
  assert.equal(result.value, target.namespace);
  const again = observe(f, script.runInContext(f.context));
  f.queue.runMicrotasks();
  assert.equal(again.value, result.value);
});

testImport('synthetic modules export their original values through dynamic import', () => {
  const f = fixture();
  const value = {};
  const target = new compat.SyntheticModule(['default'], function() { this.setExport('default', value); }, {
    context: f.context,
  });
  const evaluation = observe(f, target.evaluate());
  const result = observe(f, new compat.Script('import("data")', {
    importModuleDynamically: () => target,
  }).runInContext(f.context));
  f.queue.runMicrotasks();
  assert.equal(evaluation.error, undefined);
  assert.equal(result.value.default, value);
});

testImport('throws, rejected loads, evaluation errors, and invalid results reject import()', () => {
  const f = fixture();
  const failure = {};
  f.context.globalProxy.failure = failure;
  const failed = new compat.SourceTextModule('throw failure;', { context: f.context });
  failed.linkRequests([]);
  failed.instantiate();
  observe(f, failed.evaluate());
  const reject = compat.runInContext('reason => Promise.reject(reason)', f.context);
  for (const callback of [() => { throw failure; }, () => reject(failure), () => failed]) {
    const result = observe(f, new compat.Script('import("bad")', { importModuleDynamically: callback }).runInContext(f.context));
    f.queue.runMicrotasks();
    assert.equal(result.error, failure);
  }
  const invalid = observe(f, new compat.Script('import("bad")', { importModuleDynamically: () => ({}) }).runInContext(f.context));
  f.queue.runMicrotasks();
  assert.equal(invalid.error.code, 'ERR_VM_MODULE_NOT_MODULE');
});

testImport('specifier coercion fails before calling the host loader', () => {
  const f = fixture();
  const result = observe(f, new compat.Script('import({ toString() { throw 42; } })', {
    importModuleDynamically: () => assert.fail('Must not call the loader'),
  }).runInContext(f.context));
  f.queue.runMicrotasks();
  assert.equal(result.error, 42);
});

testImport('same-name scripts retain distinct loaders through direct and indirect eval', () => {
  const f = fixture({ importModuleDynamically: () => assert.fail('Eval lost its script metadata') });
  const first = moduleFor(f, 1), second = moduleFor(f, 2);
  for (const expression of ['import("value")', `eval("import('value')")`,
    `(0, eval)("import('value')")`]) {
    const scripts = [first, second].map(target => new compat.Script(expression, {
      filename: 'same.js', importModuleDynamically: () => target,
    }));
    const results = scripts.map(script => observe(f, script.runInContext(f.context)));
    f.queue.runMicrotasks();
    assert.deepEqual(results.map(result => result.value.value), [1, 2], expression);
  }
});

for (const [name, api] of [['node', vm], ['compat', compat]]) {
  const testFunction = name === 'compat'
    ? itPassesWith('dynamicImport', 'functionImportReferrer') : itPassesWith('functionImportReferrer');
  // Approved expected failure: Node 26/custom return [1, 1], including Node's
  // own API. Disabling the compilation cache makes both custom paths pass.
  testFunction(`${name}: Function-created imports retain their creating script's loader`, async () => {
    const f = name === 'compat' ? fixture() : { context: vm.createContext() };
    const targets = [1, 2].map(value => {
      const module = new api.SourceTextModule(`export const value = ${value};`, { context: f.context });
      module.linkRequests([]);
      module.instantiate();
      return module;
    });
    for (const target of targets) {
      if (name === 'compat') observe(f, target.evaluate());
      else await target.evaluate();
    }
    const scripts = targets.map(target => new api.Script(`Function("return import('${name}-value')")()`, {
      filename: 'generated.js', importModuleDynamically: () => target,
    }));
    let values;
    if (name === 'compat') {
      const results = scripts.map(script => observe(f, script.runInContext(f.context)));
      f.queue.runMicrotasks();
      for (const result of results) {
        assert.equal(result.error, undefined);
        assert.equal(result.settled, true);
      }
      values = results.map(result => result.value.value);
    } else {
      values = await Promise.all(scripts.map(async script => (await script.runInContext(f.context)).value));
    }
    assert.deepEqual(values, [1, 2]);
  });
}

testImport('unbound scripts allocate import promises in their execution context', () => {
  const first = fixture(), second = fixture();
  const target = moduleFor(second);
  const script = new compat.Script('() => import("value")', { importModuleDynamically: () => target });
  const fn = script.runInContext(second.context);
  first.context.globalProxy.borrowed = fn;
  const promise = compat.runInContext('borrowed()', first.context);
  assert.equal(Object.getPrototypeOf(promise), second.context.globalProxy.Promise.prototype);
  const result = observe(second, promise);
  second.queue.runMicrotasks();
  assert.equal(result.value, target.namespace);
});

testImport('a retained function keeps its callback and public referrer alive', async () => {
  const f = fixture();
  const target = moduleFor(f);
  let observed;
  function allocate() {
    const script = new compat.Script('() => import("value")', {
      importModuleDynamically(_specifier, referrer) { observed = referrer; return target; },
    });
    return { fn: script.runInContext(f.context), referrer: new WeakRef(script) };
  }
  const { fn, referrer } = allocate();
  await global.gc({ type: 'major', execution: 'async', flavor: 'last-resort' });
  const result = observe(f, fn());
  f.queue.runMicrotasks();
  assert.equal(result.value, target.namespace);
  assert.equal(observed, referrer.deref());
  assert.ok(observed instanceof compat.Script);
});

testImport('unreachable referrer and loader cycles are collectible', async () => {
  function allocate(kind) {
    const f = fixture();
    const record = { f };
    const callback = () => record.target;
    let referrer;
    if (kind === 'script') {
      referrer = new compat.Script('() => import("unused")', { importModuleDynamically: callback });
      referrer.runInContext(f.context);
    } else {
      referrer = new compat.SourceTextModule('export const load = () => import("unused");', {
        context: f.context, importModuleDynamically: callback,
      });
      referrer.linkRequests([]);
      referrer.instantiate();
      observe(f, referrer.evaluate());
    }
    record.referrer = referrer;
    f.queue.runMicrotasks();
    return { referrer: new WeakRef(referrer), record: new WeakRef(record), callback: new WeakRef(callback),
      context: new WeakRef(f.context), global: new WeakRef(f.context.globalProxy) };
  }
  for (const kind of ['script', 'module']) {
    const references = allocate(kind);
    await new Promise(resolve => setImmediate(resolve));
    await global.gc({ type: 'major', execution: 'async', flavor: 'last-resort' });
    await assertCollected(references);
  }
});

testImport('functions retain their context fallback and unreachable callback cycles collect', async () => {
  function allocate(retainFunction) {
    const record = {};
    const callback = (_specifier, referrer) => {
      assert.equal(referrer, record.f.context);
      return record.target;
    };
    const f = fixture({ importModuleDynamically: callback });
    record.f = f;
    record.target = moduleFor(f);
    f.queue.runMicrotasks();
    const references = { record: new WeakRef(record), callback: new WeakRef(callback),
      context: new WeakRef(f.context), global: new WeakRef(f.context.globalProxy) };
    return { references, queue: f.queue,
      fn: retainFunction ? compat.runInContext('() => import("retained")', f.context) : undefined };
  }
  const retained = allocate(true);
  await nextTurn();
  await global.gc({ type: 'major', execution: 'async', flavor: 'last-resort' });
  const context = retained.references.context.deref();
  assert.ok(context, 'A retained function keeps its context and loader alive');
  const result = observe({ context }, retained.fn());
  retained.queue.runMicrotasks();
  assert.equal(result.value.value, 42);
  const discarded = allocate(false);
  await assertCollected(discarded.references);
});

testImport('worker teardown preserves independent native and Node import routing', { timeout: 10000 }, async testContext => {
  const source = `
    const { workerData, parentPort } = require('node:worker_threads');
    const { setImmediate: nextTurn } = require('node:timers/promises');
    const compat = require(workerData);
    const queue = compat.createMicrotaskQueue();
    const load = () => import('data:text/javascript,export default 42');
    const context = compat.createContextHandle({ microtaskQueue: queue, importModuleDynamically: load });
    const script = new compat.Script('import("value")', {
      importModuleDynamically: load
    });
    const states = [{}, {}];
    const observe = compat.runInContext('(promise, state) => promise.then(ns => { state.value = ns.default; }, error => { state.error = error; })', context);
    observe(script.runInContext(context), states[0]);
    observe(compat.runInContext('import("value")', context), states[1]);
    (async () => {
      const deadline = performance.now() + 5000;
      while (states.some(state => state.value === undefined && state.error === undefined) && performance.now() < deadline) {
        await nextTurn();
        queue.runMicrotasks();
      }
      for (const state of states) {
        if (state.error) throw state.error;
        if (state.value !== 42) throw new Error('Import did not complete with the expected value');
      }
      parentPort.postMessage(42);
    })();
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

function fixture(options = {}) {
  const queue = compat.createMicrotaskQueue();
  return { queue, context: compat.createContextHandle({ microtaskQueue: queue, ...options }) };
}

function moduleFor(f, value = 42) {
  const module = new compat.SourceTextModule(`export const value = ${value};`, { context: f.context });
  module.linkRequests([]);
  module.instantiate();
  observe(f, module.evaluate());
  return module;
}

function observe(f, promise) {
  const state = { settled: false };
  compat.runInContext('(promise, state) => promise.then(value => { state.settled = true; state.value = value; }, error => { state.settled = true; state.error = error; })', f.context)(promise, state);
  return state;
}
