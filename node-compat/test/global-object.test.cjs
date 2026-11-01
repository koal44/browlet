'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const compat = require('../addon/index.cjs');
const { assertCollected } = require('./support/gc.cjs');
const records = new WeakMap();

test('global declarations and host reflection share one property store and exact accessor receivers', () => {
  const f = fixture();
  compat.runInContext('var declared = 7;', f.handle);
  assert.equal(f.owner.declared, 7);
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.owner, 'declared'), Object.getOwnPropertyDescriptor(f.proxy, 'declared'));
  const receiver = {};
  let assigned;
  Object.defineProperty(f.owner, 'accessor', {
    get() { return this; }, set(value) { assigned = [this, value]; }, configurable: true,
  });
  assert.equal(f.proxy.accessor, f.proxy);
  assert.equal(Reflect.get(f.proxy, 'accessor', receiver), receiver);
  assert.equal(Reflect.set(f.proxy, 'accessor', 8, receiver), true);
  assert.deepEqual(assigned, [receiver, 8]);
  assert.equal(Reflect.get(f.owner, 'accessor', receiver), receiver);
  assert.equal(Reflect.deleteProperty(f.owner, 'accessor'), true);
  assert.equal(Object.hasOwn(f.proxy, 'accessor'), false);
  assert.throws(() => Reflect.get(f.proxy, 'document', Object.create(f.proxy)), /Invalid fixture receiver/);
});

test('retained bare lookup, explicit proxy lookup, borrowed getters, and host reflection remain distinct', () => {
  const first = fixture();
  const retained = compat.runInContext(`
    var state = 1;
    const getter = Object.getOwnPropertyDescriptor(window, 'document').get;
    ({ bare: () => document, explicit: () => window.document,
       borrowed: () => Reflect.apply(getter, window, []), state: () => state });
  `, first.handle);
  first.handle.detachGlobal();
  const second = fixture(first);
  compat.runInContext('var state = 20;', second.handle);
  assert.equal(first.proxy, second.proxy);
  assert.equal(first.owner.document, first.document);
  assert.equal(retained.bare(), first.document);
  assert.equal(retained.explicit(), second.document);
  assert.equal(retained.borrowed(), second.document);
  Reflect.defineProperty(first.owner, 'state', { value: 2 });
  assert.equal(retained.state(), 2);
  assert.equal(second.proxy.state, 20);
  Reflect.defineProperty(first.owner, 'oldOnly', { value: 3, configurable: true });
  assert.equal(second.owner.oldOnly, undefined);
  assert.ok(Reflect.ownKeys(first.owner).includes('oldOnly'));
  assert.equal(Reflect.deleteProperty(first.owner, 'oldOnly'), true);
  assert.ok(!Reflect.ownKeys(first.owner).some(key => typeof key === 'string' && key.startsWith('__nodeCompatGlobalOwner')));
});

test('ordinary storage reflection excludes child indices while nested accessors retain them', () => {
  const f = fixture();
  const child = {};
  compat.setGlobalObject(f.handle, f.owner, {
    getOwnPropertyDescriptor: index => index === 0 ? { value: child, writable: false, enumerable: true, configurable: true } : undefined,
    set: () => false,
    defineProperty: () => false,
    deleteProperty: index => index !== 0,
    ownKeys: () => [0],
  });
  assert.equal(f.proxy[0], child);
  assert.equal(Reflect.getOwnPropertyDescriptor(f.owner, '0'), undefined);
  Object.defineProperty(f.owner, 'nested', { get() { return f.proxy[0]; }, configurable: true });
  assert.equal(f.owner.nested, child);
  assert.equal(f.proxy.nested, child);
  assert.ok(Reflect.ownKeys(f.proxy).includes('0'));
  assert.ok(!Reflect.ownKeys(f.owner).includes('0'));
});

test('retired global delegates query their original own properties after proxy reuse', () => {
  const first = fixture();
  first.owner.originalOnly = 1;
  const retained = compat.runInContext('() => [originalOnly, typeof replacementOnly]', first.handle);
  const seen = new Map();
  compat.setPropertyHandlers(first.proxy, {
    has(key, hasOwn) { seen.set(key, hasOwn); return false; },
    get() {}, set() {}, getOwnPropertyDescriptor() {}, defineProperty() {}, deleteProperty() {}, ownKeys: () => [],
  });
  first.handle.detachGlobal();
  const second = fixture(first);
  second.owner.replacementOnly = 2;
  seen.clear();

  assert.deepEqual(Array.from(retained()), [1, 'undefined']);
  assert.equal(seen.get('originalOnly'), true);
  assert.equal(seen.get('replacementOnly'), false);
});

test('indexed mutations use owner callbacks for supported and unsupported indices', () => {
  const f = fixture();
  const child = {};
  const calls = [];
  compat.setGlobalObject(f.handle, f.owner, {
    getOwnPropertyDescriptor: index => index === 0 ? { value: child, writable: false, enumerable: true, configurable: true } : undefined,
    set(index, value) { calls.push(['set', index, value]); return false; },
    defineProperty(index, descriptor) { calls.push(['define', index, descriptor.value]); return false; },
    deleteProperty(index) { calls.push(['delete', index]); return index !== 0; },
    ownKeys: () => [0],
  });
  for (const index of ['0', '1', '4294967294']) {
    assert.equal(Reflect.set(f.proxy, index, 'assigned'), false);
    assert.equal(Reflect.defineProperty(f.proxy, index, { value: 'defined', configurable: true }), false);
    assert.equal(Reflect.deleteProperty(f.proxy, index), index !== '0');
  }
  assert.deepEqual(calls, [0, 1, 4294967294].flatMap(index => [
    ['set', index, 'assigned'], ['define', index, 'defined'], ['delete', index],
  ]));
  calls.length = 0;
  Object.defineProperty(f.owner, '1', { value: 'stored', writable: true, configurable: true });
  f.owner[1] = 'updated';
  assert.equal(f.owner[1], 'updated');
  assert.equal(Reflect.deleteProperty(f.owner, '1'), true);
  assert.deepEqual(calls, []);
});

for (const kind of ['property', 'lexical']) {
  test(`owner capture preserves colliding author ${kind} names`, () => {
    const first = fixture();
    compat.runInContext('var retainedValue = 1;', first.handle);
    const names = Array.from({ length: 128 }, (_, i) => `__nodeCompatGlobalOwner${i}`);
    if (kind === 'property') {
      for (const name of names) Object.defineProperty(first.proxy, name, { value: 9, configurable: false });
    } else {
      compat.runInContext(`let ${names.map(name => `${name}=9`).join(',')};`, first.handle);
    }
    first.handle.detachGlobal();
    const second = fixture(first);
    compat.runInContext('var retainedValue = 20;', second.handle);
    assert.equal(first.owner.retainedValue, 1);
    assert.equal(second.owner.retainedValue, 20);
    if (kind === 'property') {
      assert.equal(first.owner.__nodeCompatGlobalOwner0, 9);
      assert.equal(first.owner.__nodeCompatGlobalOwner127, 9);
    }
  });
}

test('owner capture skips a lexical name in its temporal dead zone', () => {
  const first = fixture();
  first.proxy.detachForTest = () => first.handle.detachGlobal();
  compat.runInContext('var retainedValue = 1; let __nodeCompatGlobalOwner1 = (detachForTest(), 9);', first.handle);
  const second = fixture(first);
  compat.runInContext('var retainedValue = 20;', second.handle);
  assert.equal(first.owner.retainedValue, 1);
  assert.equal(second.owner.retainedValue, 20);
});

test('retained IDL getters read live owner state without a cache or association notification', () => {
  const first = fixture();
  const retained = compat.runInContext('() => document', first.handle);
  first.handle.detachGlobal();
  const second = fixture(first);
  const updated = {};
  records.get(first.owner).document = updated;
  assert.equal(retained(), updated);
  assert.equal(first.owner.document, updated);
  assert.equal(second.proxy.document, second.document);
});

test('retired global views and registered getters are collected with their contexts', async () => {
  function allocate() {
    const first = fixture();
    const retained = compat.runInContext('() => document', first.handle);
    first.handle.detachGlobal();
    const second = fixture(first);
    assert.equal(retained(), first.document);
    return { oldOwner: new WeakRef(first.owner), newOwner: new WeakRef(second.owner),
      oldHandle: new WeakRef(first.handle), newHandle: new WeakRef(second.handle), reader: new WeakRef(retained) };
  }
  await assertCollected(allocate());
});

function fixture(previous) {
  const handle = compat.createContextHandle({
    reuseGlobalProxyFrom: previous?.handle,
    globalPrototypeChain: ['immutable', 'delegated', 'immutable'],
  });
  const owner = handle.globalObject;
  const proxy = handle.globalProxy;
  const document = {};
  const record = { document };
  records.set(owner, record);
  records.set(proxy, record);
  Object.defineProperty(owner, 'window', { value: proxy });
  function getter() {
    const receiver = records.get(this);
    if (!receiver) throw new TypeError('Invalid fixture receiver');
    return receiver.document;
  }
  compat.registerGlobalGetter(handle, getter);
  Object.defineProperty(owner, 'document', { get: getter, enumerable: true });
  compat.setGlobalObject(handle, owner);
  return { handle, owner, proxy, document };
}
