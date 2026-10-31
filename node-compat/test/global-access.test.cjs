'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const { test } = require('node:test');
const { Worker } = require('node:worker_threads');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { addonBuild } = require('../node-base.cjs');
const compat = require('../addon/index.cjs');
const { assertCollected } = require('./support/gc.cjs');
const { itPassesWith } = require('./support/test-runtime.cjs');

test('global access is opt-in and validates the native target before registration', () => {
  const ordinary = compat.createContextHandle({ globalPrototypeChain: ['immutable'] });
  assert.throws(() => compat.createContextHandle({ globalAccess: true }), /prototype layout/);
  assert.throws(() => guarded({ globalAccess: 1 }), /boolean/);
  for (const target of [undefined, null, {}, ordinary.globalProxy]) {
    assert.throws(() => compat.setGlobalAccess(target, () => ({ allow: true })), TypeError);
  }
  const target = guarded();
  assert.throws(() => compat.setGlobalAccess(target.globalProxy, undefined), TypeError);
  assert.equal(compat.runInContext('this === globalThis', target), true);
  compat.runInContext('var answer = 42', target);
  assert.equal(target.globalProxy.answer, 42);
});

for (const stage of ['load', 'ordinary', 'invalid', 'guarded', 'repeated']) {
  test(`Promise lookup workaround is restricted to guarded Node 24 globals: ${stage}`, () => {
    const child = spawnSync(process.execPath, ['--trace-protector-invalidation', '-e', `
      const assert = require('node:assert/strict');
      const descriptor = Object.getOwnPropertyDescriptor(Promise.prototype, 'then');
      const compat = require(process.argv[1]);
      const stage = process.argv[2];
      if (stage === 'ordinary') compat.createContextHandle({ globalPrototypeChain: ['immutable'] });
      if (stage === 'invalid') assert.throws(() => compat.createContextHandle({ globalAccess: true }));
      if (stage === 'guarded' || stage === 'repeated') {
        const options = { globalPrototypeChain: ['immutable'], globalAccess: true };
        const first = compat.createContextHandle(options);
        const then = first.globalProxy.Promise.prototype.then;
        if (stage === 'repeated') {
          const second = compat.createContextHandle(options);
          assert.equal(first.globalProxy.Promise.prototype.then, then);
          assert.equal(second.globalProxy.Function.prototype.toString.call(second.globalProxy.Promise.prototype.then),
            'function then() { [native code] }');
        }
      }
      assert.deepEqual(Object.getOwnPropertyDescriptor(Promise.prototype, 'then'), descriptor);
    `, require.resolve('../addon/index.cjs'), stage], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const invalidations = (child.stdout + child.stderr).match(/Invalidating protector cell PromiseThenLookupChain/g) ?? [];
    const affected = process.versions.node.startsWith('24.') && (stage === 'guarded' || stage === 'repeated');
    assert.equal(invalidations.length, affected ? 1 : 0, child.stdout + child.stderr);
  });
}

test('unconnected guarded globals fail closed for another context', () => {
  const caller = compat.createContextHandle();
  caller.globalProxy.target = guarded().globalProxy;
  assert.throws(() => compat.runInContext('target.document', caller), /has not been connected/);
});

test('global access selects the executing and borrowed builtin realms', () => {
  const caller = compat.createContextHandle();
  const intermediary = compat.createContextHandle();
  const target = guarded();
  const seen = [];
  compat.setGlobalAccess(target.globalProxy, realm => ({
    allow: false, get() { seen.push(realm); return 42; },
  }));
  caller.globalProxy.target = intermediary.globalProxy.target = target.globalProxy;
  caller.globalProxy.borrowed = intermediary.globalProxy.Reflect;
  caller.globalProxy.read = compat.runInContext('() => target.answer', intermediary);
  assert.equal(compat.runInContext('target.answer', caller), 42);
  assert.equal(compat.runInContext('read()', caller), 42);
  assert.equal(compat.runInContext('borrowed.get(target, "answer")', caller), 42);
  assert.deepEqual(seen, [caller.realm, intermediary.realm, intermediary.realm]);
});

test('a separate Node VM context does not receive the composition host exemption', () => {
  const target = guarded();
  let seen;
  compat.setGlobalAccess(target.globalProxy, realm => ({ allow: false, get() { seen = realm; return 'denied view'; } }));
  const caller = vm.createContext({ target: target.globalProxy });
  assert.equal(vm.runInContext('target.answer', caller), 'denied view');
  assert.equal(seen, compat.getRealm(vm.runInContext('Object.prototype', caller)));
});

test('foreign enumeration accepts one list of indices, names, and symbols', () => {
  const caller = compat.createContextHandle();
  const target = guarded();
  const symbol = Symbol('foreign key');
  const keys = ['0', '1', '4294967294', 'answer', '01', '-0', '4294967295', symbol];
  compat.setGlobalAccess(target.globalProxy, () => ({ allow: false, ownKeys: () => keys }));
  caller.globalProxy.target = target.globalProxy;
  assert.deepEqual(Array.from(compat.runInContext('Reflect.ownKeys(target)', caller)), keys);
});

test('foreign queries use descriptors while definition and deletion use the denial callback', () => {
  const caller = compat.createContextHandle();
  const target = guarded();
  const reason = new Error('denied mutation');
  compat.setGlobalAccess(target.globalProxy, () => ({
    allow: false,
    getOwnPropertyDescriptor: key => key === 'answer'
      ? { value: 42, writable: false, enumerable: false, configurable: true } : undefined,
    deny() { throw reason; },
  }));
  caller.globalProxy.target = target.globalProxy;
  assert.equal(compat.runInContext('"answer" in target', caller), true);
  assert.equal(compat.runInContext('Object.getOwnPropertyDescriptor(target, "answer").writable', caller), false);
  assert.throws(() => compat.runInContext('Reflect.defineProperty(target, "newKey", { value: 17 })', caller), error => error === reason);
  assert.throws(() => compat.runInContext('Reflect.deleteProperty(target, "answer")', caller), error => error === reason);
});

for (const operation of ['Reflect.setPrototypeOf(target, null)', 'Reflect.preventExtensions(target)']) {
  test(`dispatches native mutation denial in the accessing realm: ${operation}`, () => {
    const caller = compat.createContextHandle();
    const intermediary = compat.createContextHandle();
    const target = guarded();
    const reason = new Error('host denial');
    const seen = [];
    compat.setGlobalAccess(target.globalProxy, realm => ({
      allow: false, deny() { seen.push(realm); throw reason; },
    }));
    caller.globalProxy.target = target.globalProxy;
    caller.globalProxy.borrowed = intermediary.globalProxy.Reflect;
    assert.throws(() => compat.runInContext(operation, caller), error => error === reason);
    assert.throws(() => compat.runInContext(operation.replace('Reflect.', 'borrowed.'), caller), error => error === reason);
    assert.deepEqual(seen, [caller.realm, intermediary.realm]);
  });

  test(`preserves an exception already thrown by the access check: ${operation}`, () => {
    const caller = compat.createContextHandle();
    const target = guarded();
    const reason = new Error('original check failure');
    compat.setGlobalAccess(target.globalProxy, () => { throw reason; });
    caller.globalProxy.target = target.globalProxy;
    assert.throws(() => compat.runInContext(operation, caller), error => error === reason);
  });
}

test('proxy reuse preserves the guarded layout and installs a new context policy', () => {
  const caller = compat.createContextHandle();
  const first = guarded();
  const proxy = first.globalProxy;
  compat.setGlobalAccess(proxy, () => ({ allow: false, get: () => 'old' }));
  caller.globalProxy.target = proxy;
  assert.equal(compat.runInContext('target.value', caller), 'old');
  first.detachGlobal();
  assert.throws(() => compat.createContextHandle({
    reuseGlobalProxyFrom: first, globalPrototypeChain: ['immutable'],
  }), /same global prototype layout/);
  const second = guarded({ reuseGlobalProxyFrom: first });
  assert.equal(second.globalProxy, proxy);
  compat.setGlobalAccess(proxy, () => ({ allow: false, get: () => 'new' }));
  assert.equal(compat.runInContext('target.value', caller), 'new');
});

test('guard selectors and captured globals collect with their contexts', async () => {
  function allocate() {
    const context = guarded();
    const proxy = context.globalProxy;
    const select = () => ({ allow: false, get: () => proxy });
    compat.setGlobalAccess(proxy, select);
    return { context: new WeakRef(context), proxy: new WeakRef(proxy), selector: new WeakRef(select) };
  }
  await assertCollected(allocate());
});

test('worker registration and teardown leave the parent isolate guard active', async () => {
  const caller = compat.createContextHandle();
  const target = guarded();
  compat.setGlobalAccess(target.globalProxy, () => ({ allow: false, get: () => 'parent' }));
  caller.globalProxy.target = target.globalProxy;
  for (let i = 0; i < 2; i++) {
    const worker = new Worker(`
      const { workerData } = require('node:worker_threads');
      const assert = require('node:assert/strict');
      const compat = require(workerData);
      const caller = compat.createContextHandle();
      const target = compat.createContextHandle({ globalPrototypeChain: ['immutable'], globalAccess: true });
      compat.setGlobalAccess(target.globalProxy, () => ({ allow: false, deny() { throw new Error('worker denial'); } }));
      caller.globalProxy.target = target.globalProxy;
      assert.throws(() => compat.runInContext('Reflect.preventExtensions(target)', caller), /worker denial/);
    `, { eval: true, workerData: require.resolve('../addon/index.cjs') });
    await new Promise((resolve, reject) => {
      worker.once('error', reject);
      worker.once('exit', code => code === 0 ? resolve() : reject(new Error(`Worker exited with ${code}`)));
    });
    assert.equal(compat.runInContext('target.value', caller), 'parent');
  }
});

test('repeated addon initialization in one isolate can tear down cleanly', () => {
  const child = spawnSync(process.execPath, ['-e', `
    const binding = process.argv[1];
    const first = { exports: {} };
    const second = { exports: {} };
    process.dlopen(first, binding);
    process.dlopen(second, binding);
  `, join(addonBuild(process.env.NODE_BASE), 'node-compat.node')], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
});

itPassesWith('addonReload')('reloading the JavaScript addon entry point preserves context creation', () => {
  const child = spawnSync(process.execPath, ['-e', `
    const entry = process.argv[1];
    const options = { globalPrototypeChain: ['immutable'], globalAccess: true };
    require(entry).createContextHandle(options);
    delete require.cache[require.resolve(entry)];
    require(entry).createContextHandle(options);
  `, require.resolve('../addon/index.cjs')], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
});

test('observes a host Promise using a guarded Window queue', () => {
  const queue = compat.createMicrotaskQueue();
  const context = guarded({ microtaskQueue: queue });
  const anchor = compat.runInContext('Promise', context);
  const seen = [];
  compat.observePromise(Promise.resolve(42), anchor, value => { seen.push(value); });
  assert.deepEqual(seen, []);
  queue.runMicrotasks();
  assert.deepEqual(seen, [42]);
});

test('observes another guarded Window Promise on the observer queue', () => {
  const sourceQueue = compat.createMicrotaskQueue();
  const observerQueue = compat.createMicrotaskQueue();
  const source = guarded({ microtaskQueue: sourceQueue });
  const observer = guarded({ microtaskQueue: observerQueue });
  const promise = compat.runInContext('Promise.resolve(42)', source);
  const anchor = compat.runInContext('Promise', observer);
  const seen = [];
  compat.observePromise(promise, anchor, value => { seen.push(value); });
  observerQueue.runMicrotasks();
  assert.deepEqual(seen, [42]);
});

test('host reactions can allocate a Promise owned by another guarded Window', () => {
  const queue = compat.createMicrotaskQueue();
  const observer = guarded({ microtaskQueue: queue });
  const destination = guarded();
  const anchor = compat.runInContext('Promise', observer);
  const DestinationPromise = compat.runInContext('Promise', destination);
  const seen = [];
  compat.observePromise(Promise.resolve(42), anchor, value => {
    new DestinationPromise(resolve => { resolve(value); });
    seen.push(value);
  });
  queue.runMicrotasks();
  assert.deepEqual(seen, [42]);
});

test('retains a Node-owned import loader in a guarded Window Function', async () => {
  const queue = compat.createMicrotaskQueue();
  const context = guarded({ microtaskQueue: queue });
  compat.setGlobalAccess(context.globalProxy, () => ({ allow: true }));
  const target = new vm.SyntheticModule(['answer'], function() { this.setExport('answer', 42); });
  await target.link(() => { throw new Error('Synthetic modules have no imports'); });
  await target.evaluate();
  const construct = vm.compileFunction('return make("return import(\'host-owned\');");', ['make'], {
    importModuleDynamically: () => Promise.resolve(target),
  });
  const load = construct(context.globalProxy.Function);
  let result;
  compat.observePromise(load(), context.globalProxy.Promise,
    value => { result = { value }; }, reason => { result = { reason }; });
  for (let turn = 0; turn < 10 && !result; turn++) {
    await new Promise(setImmediate);
    queue.runMicrotasks();
  }
  assert.equal(result?.reason, undefined);
  assert.equal(result?.value.answer, 42);
});

test('preserves a Node-owned import rejection across a guarded Window', async () => {
  const queue = compat.createMicrotaskQueue();
  const context = guarded({ microtaskQueue: queue });
  compat.setGlobalAccess(context.globalProxy, () => ({ allow: true }));
  const reason = new Error('loader rejection');
  const construct = vm.compileFunction('return make("return import(\'host-rejection\');");', ['make'], {
    importModuleDynamically: () => { throw reason; },
  });
  const load = construct(context.globalProxy.Function);
  let result;
  compat.observePromise(load(), context.globalProxy.Promise,
    value => { result = { value }; }, reason => { result = { reason }; });
  for (let turn = 0; turn < 10 && !result; turn++) {
    await new Promise(setImmediate);
    queue.runMicrotasks();
  }
  assert.equal(result?.reason, reason);
});

test('observes host rejection on a guarded Window queue and preserves a thrown reason', () => {
  const queue = compat.createMicrotaskQueue();
  const context = guarded({ microtaskQueue: queue });
  const anchor = compat.runInContext('Promise', context);
  const reason = new Error('original reason');
  const seen = [];
  const observation = compat.observePromise(Promise.reject(reason), anchor, undefined, value => {
    seen.push(value);
    throw value;
  });
  observation.catch(() => {});
  queue.runMicrotasks();
  assert.deepEqual(seen, [reason]);
  assert.equal(compat.getPromiseResult(observation), reason);
});

function guarded(options = {}) {
  return compat.createContextHandle({ globalPrototypeChain: ['immutable'], globalAccess: true, ...options });
}
