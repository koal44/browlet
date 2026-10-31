'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const compat = require('../addon/index.cjs');
const { assertCollected } = require('./support/gc.cjs');

test('exotic dispatch observes author functions and borrowed builtin realms before trap entry', () => {
  const a = compat.createContextHandle();
  const b = compat.createContextHandle();
  const c = compat.createContextHandle();
  const observed = [];
  const object = compat.createExoticObject(c.realm, realm => {
    observed.push(realm);
    return { getPrototypeOf: () => null };
  });
  assert.equal(compat.getRealm(object), c.realm);
  a.globalProxy.object = b.globalProxy.object = object;
  a.globalProxy.foreignReflect = b.globalProxy.Reflect;
  a.globalProxy.call = compat.runInContext('() => Reflect.getPrototypeOf(object)', b);
  assert.equal(compat.runInContext('call()', a), null);
  assert.equal(compat.runInContext('Reflect.getPrototypeOf(object)', a), null);
  assert.equal(compat.runInContext('foreignReflect.getPrototypeOf(object)', a), null);
  assert.deepEqual(observed, [b.realm, a.realm, b.realm]);
});

test('native targets validate changing frozen descriptors and keys, including indices and symbols', () => {
  const a = compat.createContextHandle();
  const b = compat.createContextHandle();
  const symbol = Symbol('frozen');
  const storage = Object.defineProperties({}, {
    frozen: { value: 17 }, 0: { value: 23 }, [symbol]: { value: 31 },
  });
  const foreign = { value: () => 42, writable: false, enumerable: false, configurable: true };
  const object = compat.createExoticObject(b.realm, realm => ({
    get: (_target, key) => realm === a.realm ? foreign.value : storage[key],
    getOwnPropertyDescriptor: (_target, key) => realm === a.realm
      ? key === 'frozen' ? foreign : undefined : Reflect.getOwnPropertyDescriptor(storage, key),
    ownKeys: () => realm === a.realm ? ['frozen'] : Reflect.ownKeys(storage),
  }));
  a.globalProxy.object = b.globalProxy.object = object;
  assert.equal(compat.runInContext('object.frozen', a), foreign.value);
  assert.equal(compat.runInContext('object.frozen', b), 17);
  assert.equal(compat.runInContext('object[0]', b), 23);
  assert.equal(compat.runInContext('Object.getOwnPropertyDescriptor(object, "0").configurable', b), false);
  assert.equal(compat.runInContext('Object.getOwnPropertyDescriptor(object, "missing")', b), undefined);
  assert.deepEqual(Array.from(compat.runInContext('Reflect.ownKeys(object)', a)), ['frozen']);
  assert.deepEqual(Array.from(compat.runInContext('Reflect.ownKeys(object)', b)), ['0', 'frozen', symbol]);
});

test('exotic get/set preserve exact receivers and nested calls retain independent realm selection', () => {
  const a = compat.createContextHandle();
  const b = compat.createContextHandle();
  const observed = [];
  const object = compat.createExoticObject(b.realm, realm => ({
    get(_target, _key, receiver) {
      observed.push(['get', realm, receiver]);
      return realm === a.realm ? compat.runInContext('Reflect.get(object, "nested", receiver)', b) : 7;
    },
    set(_target, _key, _value, receiver) { observed.push(['set', realm, receiver]); return true; },
    getOwnPropertyDescriptor: () => undefined,
  }));
  const receiver = {};
  a.globalProxy.object = b.globalProxy.object = object;
  a.globalProxy.receiver = b.globalProxy.receiver = receiver;
  assert.equal(compat.runInContext('Reflect.get(object, "key", receiver)', a), 7);
  assert.equal(compat.runInContext('Reflect.set(object, "key", 9, receiver)', a), true);
  assert.deepEqual(observed, [['get', a.realm, receiver], ['get', b.realm, receiver], ['set', a.realm, receiver]]);
});

test('exotic callbacks preserve exceptions and selector failures', () => {
  const context = compat.createContextHandle();
  const failure = {};
  const object = compat.createExoticObject(context.realm, () => { throw failure; });
  assert.throws(() => Reflect.getPrototypeOf(object), thrown => thrown === failure);
  assert.throws(() => compat.createExoticObject(context.realm, {}), TypeError);
  const invalid = compat.createExoticObject(context.realm, () => undefined);
  assert.throws(() => Reflect.getPrototypeOf(invalid), TypeError);
});

test('exotic objects, stores, selectors, and owner contexts are collectible', async () => {
  function allocate() {
    const context = compat.createContextHandle();
    const storage = {};
    const select = () => ({ getOwnPropertyDescriptor: (_target, key) => Reflect.getOwnPropertyDescriptor(storage, key) });
    const object = compat.createExoticObject(context.realm, select);
    return { context: new WeakRef(context), storage: new WeakRef(storage), select: new WeakRef(select), object: new WeakRef(object) };
  }
  await assertCollected(allocate());
});

test('a retained realm can allocate an exotic object after its global is detached and reused', () => {
  const original = compat.createContextHandle();
  const realm = original.realm;
  const anchor = original.globalProxy.Object.prototype;
  original.detachGlobal();
  const replacement = compat.createContextHandle({ reuseGlobalProxyFrom: original });
  const object = compat.createExoticObject(anchor, () => ({ getPrototypeOf: () => anchor }));
  assert.equal(compat.getRealm(object), realm);
  assert.notEqual(compat.getRealm(object), replacement.realm);
  assert.equal(Reflect.getPrototypeOf(object), anchor);
});
