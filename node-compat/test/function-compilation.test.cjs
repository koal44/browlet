'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const compat = require('../addon/index.cjs');
const { assertCollected } = require('./support/gc.cjs');
const { itPassesWith } = require('./support/test-runtime.cjs');

test('compileFunction uses the requested context, live object scopes and source name', () => {
  const context = compat.createContextHandle();
  const scope = { foo: 5 };
  const fn = compat.compileFunction('return [foo, event, this];', ['event'], {
    parsingContext: context, contextExtensions: [scope], name: 'onstorage', filename: 'handler.js',
  });
  assert.equal(Object.getPrototypeOf(fn), context.globalProxy.Function.prototype);
  assert.equal(fn.name, 'onstorage');
  assert.equal(fn.toString(), 'function onstorage(event) {\nreturn [foo, event, this];\n}');
  const receiver = {};
  const result = fn.call(receiver, 3);
  assert.equal(result[0], 5);
  assert.equal(result[1], 3);
  assert.equal(result[2], receiver);
  scope.foo = 6;
  assert.equal(fn()[0], 6);
  assert.throws(() => compat.compileFunction('return }', [], { parsingContext: context }),
    error => Object.getPrototypeOf(error) === context.globalProxy.SyntaxError.prototype);
  const failure = compat.compileFunction('throw new Error("handler");', [], {
    parsingContext: context, filename: 'handler.js', lineOffset: 6, columnOffset: 2,
  });
  assert.throws(() => failure(), error => {
    assert.match(error.stack, /handler\.js:7:/u);
    return true;
  });
});

test('compileFunction validates inputs and refuses detached contexts', () => {
  const context = compat.createContextHandle();
  for (const [source, parameters, options] of [
    [5, [], {}], ['return 1;', [null], {}], ['return 1;', [], { contextExtensions: [null] }],
    ['return 1;', [], { lineOffset: 0.5 }], ['return 1;', [], { cachedData: Buffer.alloc(0) }],
  ]) {
    assert.throws(() => compat.compileFunction(source, parameters, { ...options, parsingContext: context }));
  }
  context.detachGlobal();
  assert.throws(() => compat.compileFunction('return 1;', [], { parsingContext: context }),
    { code: 'ERR_CONTEXT_NOT_INITIALIZED' });
});

test('Proxy-scoped functions retain exact source without a self-name binding or substitute receiver', () => {
  const context = compat.createContextHandle();
  const global = context.globalProxy;
  const accesses = [];
  const method = function() { return this; };
  const scope = new Proxy({ onclick: 5, method, get receiver() { return this; } }, {
    has(target, key) { accesses.push(key); return Reflect.has(target, key); },
    get(target, key, receiver) { accesses.push(key); return Reflect.get(target, key, receiver); },
  });
  const body = 'return [onclick, method(), method, receiver, event, this];';
  const fn = compat.compileFunction(body, ['event'], {
    parsingContext: context, contextExtensions: [scope], name: 'onclick',
  });
  assert.deepEqual(accesses, []);
  assert.equal(Object.getPrototypeOf(fn), global.Function.prototype);
  assert.equal(fn.name, 'onclick');
  assert.equal(global.Function.prototype.toString.call(fn), `function onclick(event) {\n${body}\n}`);
  const receiver = {};
  assert.deepEqual(Array.from(fn.call(receiver, 7)), [5, scope, method, scope, 7, receiver]);
  delete scope.onclick;
  global.onclick = 9;
  assert.equal(fn()[0], 9);
});

test('identical Proxy-scoped compilations keep each function scope, name, parameters and realm', () => {
  const contexts = [compat.createContextHandle(), compat.createContextHandle()];
  const retained = [];
  let accesses = 0;
  for (let index = 0; index < 12; index++) {
    const context = contexts[index % 2];
    const scope = new Proxy({ foo: index, onclick: index + 1 }, {
      has(target, key) { accesses++; return Reflect.has(target, key); },
      get(target, key, receiver) { accesses++; return Reflect.get(target, key, receiver); },
    });
    const name = ['onclick', 'onerror', 'arguments'][index % 3];
    const body = 'return [event, foo, onclick, this];';
    const fn = compat.compileFunction(body, ['event'], {
      parsingContext: context, contextExtensions: [scope], name,
    });
    retained.push({ fn, context, scope, name, body, index });
  }
  assert.equal(accesses, 0, 'Compilation must not consult author scopes');
  for (const { fn, context, scope, name, body, index } of retained) {
    assert.equal(fn.name, name);
    assert.equal(fn.toString(), `function ${name}(event) {\n${body}\n}`);
    assert.equal(Object.getPrototypeOf(fn), context.globalProxy.Function.prototype);
    assert.deepEqual(Array.from(fn.call(scope, 7)), [7, index, index + 1, scope]);
    scope.foo = 900;
    assert.equal(fn()[1], 900);
  }
  const options = { parsingContext: contexts[0], contextExtensions: [new Proxy({}, {})], name: 'onclick' };
  const first = compat.compileFunction('return value;', ['value', 'unused'], options);
  const second = compat.compileFunction('return value;', ['unused', 'value'], options);
  assert.equal(first(3, 7), 3);
  assert.equal(second(3, 7), 7);
  assert.equal(first(3, 7), 3);
});

test('Proxy-scoped host compilation ignores replaced eval and does not run the body', () => {
  const context = compat.createContextHandle();
  const global = context.globalProxy;
  global.calls = 0;
  global.eval = () => { throw new Error('Author eval must not compile the handler'); };
  const scope = new Proxy({ eval: () => 7 }, {});
  const fn = compat.compileFunction('calls++; return eval("5");', [], {
    parsingContext: context, contextExtensions: [scope], name: 'onclick',
  });
  assert.equal(global.calls, 0);
  assert.equal(fn(), 7);
  const reloaded = require('../addon/vm.cjs')(require('./support/native-vm.cjs'), () => {}).methods;
  assert.equal(reloaded.compileFunction('return eval("5");', [], {
    parsingContext: context, contextExtensions: [scope], name: 'onclick',
  })(), 7);
  delete scope.eval;
  assert.throws(fn, /Author eval/u);
  for (const source of ['}; globalThis.escaped = true; function other() {', '"use strict"; with ({}) {}']) {
    assert.throws(() => compat.compileFunction(source, [], {
      parsingContext: context, contextExtensions: [scope], name: 'onclick',
    }), global.SyntaxError);
  }
  assert.equal(global.escaped, undefined);
});

test('Proxy-scoped compilation validates generated names and handles unnamed and arguments functions', () => {
  const context = compat.createContextHandle();
  const scope = new Proxy({ foo: 5 }, {});
  const options = { parsingContext: context, contextExtensions: [scope] };
  for (const name of [undefined, '', 'arguments', 'eval', 'onévent']) {
    const fn = compat.compileFunction('return foo;', [], { ...options, name });
    assert.equal(fn.name, name ?? '');
    assert.equal(fn.toString(), `function ${name ?? ''}() {\nreturn foo;\n}`);
    assert.equal(fn(), 5);
  }
  for (const name of ['not-an-identifier', 'f() {}; globalThis.escaped = true; function g']) {
    assert.throws(() => compat.compileFunction('return 5;', [], { ...options, name }), TypeError);
  }
  for (const value of [null, 5]) {
    assert.throws(() => compat.compileFunction('return 5;', [], {
      ...options, name: 'onclick', contextExtensions: [scope, value],
    }), TypeError);
  }
  assert.equal(context.globalProxy.escaped, undefined);
});

test('Proxy-scoped compilation validates names without coercing author objects', () => {
  const context = compat.createContextHandle();
  const options = { parsingContext: context, contextExtensions: [new Proxy({}, {})] };
  let coerced = false;
  for (const name of [null, 5, { toString() { coerced = true; return 'onclick'; } }]) {
    assert.throws(() => compat.compileFunction('return 5;', [], { ...options, name }),
      { code: 'ERR_INVALID_ARG_TYPE' });
  }
  assert.equal(coerced, false);
});

itPassesWith('codeGeneration')('Proxy-scoped host compilation restores the author string-compilation policy', () => {
  const context = compat.createContextHandle();
  const global = context.globalProxy;
  let calls = 0;
  compat.setModifyCodeGenerationFromStringsCallback(context.realm, () => { calls++; return false; });
  try {
    const options = { parsingContext: context, contextExtensions: [new Proxy({}, {})], name: 'onclick' };
    const fn = compat.compileFunction('return eval("5");', [], options);
    assert.equal(calls, 0);
    assert.throws(fn, global.EvalError);
    assert.equal(calls, 1);
    assert.throws(() => compat.compileFunction('return }', [], options), global.SyntaxError);
    assert.throws(fn, global.EvalError);
    assert.equal(calls, 2);
  } finally {
    compat.setModifyCodeGenerationFromStringsCallback(context.realm, undefined);
  }
});

itPassesWith('dynamicImport')('identical Proxy-scoped compilations preserve context loaders and explicit import referrers', () => {
  const queue = compat.createMicrotaskQueue();
  const calls = [];
  const create = value => {
    let target;
    const context = compat.createContextHandle({ microtaskQueue: queue,
      importModuleDynamically(_specifier, referrer) { calls.push(referrer); return target; },
    });
    target = new compat.SyntheticModule(['value'], function() { this.setExport('value', value); }, { context });
    target.evaluate();
    return { context, target };
  };
  const a = create(5);
  const b = create(7);
  const compile = (context, importModuleDynamically) => compat.compileFunction('return import("target");', [], {
    parsingContext: context, contextExtensions: [new Proxy({}, {})], name: 'onclick', importModuleDynamically,
  });
  const first = compile(a.context);
  const second = compile(b.context);
  const third = compile(a.context, (_specifier, referrer) => { calls.push(referrer); return b.target; });
  const fourth = compile(a.context, (_specifier, referrer) => { calls.push(referrer); return a.target; });
  const values = [];
  a.context.globalProxy.values = values;
  const observe = compat.runInContext('value => values.push(value.value)', a.context);
  for (const fn of [first, second, third, fourth, first]) fn().then(observe);
  queue.runMicrotasks();
  assert.deepEqual(values, [5, 7, 7, 5, 5]);
  assert.deepEqual(calls, [a.context, b.context, third, fourth, a.context]);
});

itPassesWith('dynamicImport')('a retained Proxy-scoped descendant keeps its original import referrer', async () => {
  const queue = compat.createMicrotaskQueue();
  const context = compat.createContextHandle({ microtaskQueue: queue });
  const target = new compat.SyntheticModule(['foo'], function() { this.setExport('foo', 5); }, { context });
  target.evaluate();
  const referrers = [];
  const retained = (() => {
    const fn = compat.compileFunction('return () => import("nested");', [], {
      parsingContext: context, contextExtensions: [new Proxy({}, {})], name: 'onclick',
      importModuleDynamically(_specifier, referrer) { referrers.push(referrer); return target; },
    });
    return { child: fn(), original: new WeakRef(fn) };
  })();
  await new Promise(resolve => setImmediate(resolve));
  await global.gc({ type: 'major', execution: 'async' });
  assert.notEqual(retained.original.deref(), undefined);
  retained.child();
  queue.runMicrotasks();
  assert.deepEqual(referrers, [retained.original.deref()]);
});

itPassesWith('dynamicImport')('a pending import completes after its Proxy-scoped function is collected', async () => {
  const queue = compat.createMicrotaskQueue();
  const context = compat.createContextHandle({ microtaskQueue: queue });
  const target = new compat.SyntheticModule(['foo'], function() { this.setExport('foo', 5); }, { context });
  target.evaluate();
  const loading = compat.runInContext('new Promise(resolve => { globalThis.finishLoad = resolve; })', context);
  const values = context.globalProxy.values = [];
  const errors = context.globalProxy.errors = [];
  const reference = (() => {
    const fn = compat.compileFunction('return import("target");', [], {
      parsingContext: context, contextExtensions: [new Proxy({}, {})], name: 'onclick',
      importModuleDynamically: () => loading,
    });
    fn().then(compat.runInContext('value => values.push(value.foo)', context),
      compat.runInContext('error => errors.push(error)', context));
    return new WeakRef(fn);
  })();
  queue.runMicrotasks();
  await assertCollected([reference]);
  context.globalProxy.finishLoad(target);
  queue.runMicrotasks();
  assert.deepEqual(errors, []);
  assert.deepEqual(values, [5]);
});

itPassesWith('dynamicImport')('discarded Proxy-scoped functions release loader-owned contexts', async () => {
  const references = (() => {
    const context = compat.createContextHandle();
    const target = new compat.SyntheticModule([], () => {}, { context });
    const loader = () => target;
    const fn = compat.compileFunction('return import("target");', [], {
      parsingContext: context, contextExtensions: [new Proxy({}, {})], name: 'onclick',
      importModuleDynamically: loader,
    });
    return [new WeakRef(fn), new WeakRef(loader), new WeakRef(target), new WeakRef(context.globalProxy)];
  })();
  await assertCollected(references);
});

test('identical Proxy-scoped compilation does not retain discarded siblings or their contexts', async () => {
  const compile = (context, scope) => compat.compileFunction('return foo;', [], {
    parsingContext: context, contextExtensions: [scope], name: 'onclick',
  });
  const context = compat.createContextHandle();
  const kept = compile(context, new Proxy({ foo: 5 }, {}));
  const references = (() => {
    const sameScope = new Proxy({ foo: 7 }, {});
    const sameRealm = compile(context, sameScope);
    const otherContext = compat.createContextHandle();
    const otherScope = new Proxy({ foo: 9 }, {});
    const otherRealm = compile(otherContext, otherScope);
    assert.equal(sameRealm(), 7);
    assert.equal(otherRealm(), 9);
    return [sameScope, sameRealm, otherScope, otherRealm, otherContext.globalProxy].map(value => new WeakRef(value));
  })();
  await assertCollected(references);
  assert.equal(kept(), 5);
});

for (const proxy of [false, true]) {
  test(`host-compiled functions explicitly clear ScriptOrModule attribution (Proxy scope: ${proxy})`, () => {
    const context = compat.createContextHandle();
    const observed = [];
    compat.setPromiseRejectionTracker(context, (_promise, operation, code) => {
      if (operation === 'reject') observed.push(code);
    });
    context.globalProxy.compile = () => compat.compileFunction('Promise.reject(5);', [], {
      parsingContext: context, name: 'onclick', contextExtensions: proxy ? [new Proxy({}, {})] : [],
    });
    const script = new compat.Script('compile()();');
    script.runInContext(context);
    assert.deepEqual(observed, [null]);
  });

  itPassesWith('dynamicImport')(`compileFunction uses explicit imports or the context fallback with the correct referrer (Proxy scope: ${proxy})`, () => {
    const queue = compat.createMicrotaskQueue();
    const calls = [];
    let target;
    const context = compat.createContextHandle({ microtaskQueue: queue,
      importModuleDynamically(specifier, referrer) { calls.push([specifier, referrer]); return target; },
    });
    target = new compat.SyntheticModule(['foo'], function() { this.setExport('foo', 5); }, { context });
    target.evaluate();
    const options = { parsingContext: context, name: 'onclick', contextExtensions: proxy ? [new Proxy({}, {})] : [] };
    const fallback = compat.compileFunction('return import("fallback");', [], options);
    const explicit = compat.compileFunction('return import("explicit");', [], {
      ...options,
      importModuleDynamically(specifier, referrer) { calls.push([specifier, referrer]); return target; },
    });
    const values = context.globalProxy.values = [];
    const observe = compat.runInContext('value => values.push(value.foo)', context);
    fallback().then(observe);
    explicit().then(observe);
    queue.runMicrotasks();
    assert.deepEqual(calls, [['fallback', context], ['explicit', explicit]]);
    assert.deepEqual(values, [5, 5]);
  });

  test(`discarded compiled functions, scopes and contexts can be collected (Proxy scope: ${proxy})`, async () => {
    const references = (() => {
      const context = compat.createContextHandle();
      const scope = proxy ? new Proxy({ foo: 5 }, {}) : { foo: 5 };
      const fn = compat.compileFunction('return foo;', [], { parsingContext: context, contextExtensions: [scope], name: 'onclick' });
      return [new WeakRef(fn), new WeakRef(scope), new WeakRef(context.globalProxy)];
    })();
    await assertCollected(references);
  });
}
