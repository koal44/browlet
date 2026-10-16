'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const compat = require('../addon/index.cjs');
const { assertCollected } = require('./support/gc.cjs');

test('HTMLDDA has the native falsiness, typeof and equality behavior', () => {
  const realm = compat.createContextHandle();
  const value = compat.createHTMLDDA(realm, () => null);
  let coercions = 0;
  value[Symbol.toPrimitive] = () => { coercions++; return 'coerced'; };

  assert.equal(Boolean(value), false);
  assert.equal(!value, true);
  assert.equal(typeof value, 'undefined');
  assert.equal(value == null, true);
  assert.equal(null == value, true);
  assert.equal(value == undefined, true);
  assert.equal(undefined == value, true);
  assert.equal(value === null, false);
  assert.equal(value === undefined, false);
  assert.equal(coercions, 0);
  assert.equal(value == false, false);
  assert.equal(coercions, 1);
  assert.equal(value ?? 'fallback', value);
  assert.equal(value || 'fallback', 'fallback');
  assert.equal(Object(value), value);

  // An outer Proxy changes these checks even when its target is undetectable.
  const proxy = new Proxy(value, {});
  assert.equal(Boolean(proxy), true);
  assert.equal(typeof proxy, 'function');
  assert.equal(proxy == null, false);
});

test('HTMLDDA calls forward exact arguments, return values and exceptions', () => {
  const realm = compat.createContextHandle();
  const result = {};
  const argument = {};
  let received;
  const value = compat.createHTMLDDA(realm, function(...args) {
    assert.equal(this, undefined);
    received = args;
    return result;
  });

  assert.equal(value(), result);
  assert.deepEqual(received, []);
  assert.equal(Reflect.apply(value, { ignored: true }, [argument, undefined, 3]), result);
  assert.deepEqual(received, [argument, undefined, 3]);
  assert.equal(received[0], argument);
  assert.throws(() => Reflect.construct(value, []), TypeError);
  assert.throws(() => Reflect.construct(function() {}, [], value), TypeError);

  const failure = {};
  const throwing = compat.createHTMLDDA(realm, () => { throw failure; });
  assert.throws(() => throwing(), caught => caught === failure);
});

test('HTMLDDA belongs to its supplied realm and accepts the platform prototype', () => {
  const first = compat.createContextHandle();
  const second = compat.createContextHandle();
  const call = compat.runInContext('() => globalThis', second);
  const value = compat.createHTMLDDA(first, call);
  const prototype = compat.runInContext('({ [Symbol.toStringTag]: "HTMLAllCollection" })', first);
  Object.setPrototypeOf(value, prototype);

  assert.equal(Object.getPrototypeOf(value), prototype);
  assert.equal(Object.prototype.toString.call(value), '[object HTMLAllCollection]');
  assert.equal(compat.getRealm(value), first.realm);
  assert.equal(compat.getFunctionRealm(value), first.realm);
  assert.equal(compat.getFunctionRealm(new Proxy(value, {})), first.realm);
  assert.equal(value(), second.globalProxy);

  second.globalProxy.all = value;
  assert.equal(compat.runInContext('typeof all', second), 'undefined');
  assert.equal(compat.runInContext('Boolean(all)', second), false);
  assert.equal(compat.runInContext('all()', second), second.globalProxy);
});

test('HTMLDDA runs property handlers while retaining its native identity', () => {
  const realm = compat.createContextHandle();
  const value = compat.createHTMLDDA(realm, () => null);
  const first = {};
  const second = {};
  const symbol = Symbol('expando');
  const properties = Object.assign(Object.create(null), { 0: first, named: first });
  let keys = 0;
  compat.setPropertyHandlers(value, {
    has: key => Reflect.has(properties, key),
    get: (key, receiver) => Reflect.get(properties, key, receiver),
    set(key, next, receiver) {
      const descriptor = Reflect.getOwnPropertyDescriptor(properties, key);
      if (descriptor?.writable === false) return false;
      // Like Web IDL's setter, explicitly invoke the receiver's [[DefineOwnProperty]].
      return Reflect.defineProperty(receiver, key,
        descriptor ? { value: next } : {
          value: next, writable: true, enumerable: true, configurable: true,
        });
    },
    getOwnPropertyDescriptor: key => Reflect.getOwnPropertyDescriptor(properties, key),
    defineProperty: (key, descriptor) => Reflect.defineProperty(properties, key, descriptor),
    deleteProperty: key => Reflect.deleteProperty(properties, key),
    ownKeys() { keys++; return Reflect.ownKeys(properties); },
  });

  assert.equal(value[0], first);
  assert.equal(value.named, first);
  assert.equal('named' in value, true);
  assert.equal(Object.hasOwn(value, 'named'), true);
  assert.deepEqual(Object.getOwnPropertyDescriptor(value, '0'), {
    value: first, writable: true, enumerable: true, configurable: true,
  });
  assert.deepEqual(Object.keys(value), ['0', 'named']);
  assert.ok(keys > 0);

  properties[0] = second;
  delete properties.named;
  assert.equal(value[0], second);
  assert.equal('named' in value, false);
  value[symbol] = 42;
  assert.equal(properties[symbol], 42);
  assert.equal(value[symbol], 42);
  assert.deepEqual(Reflect.ownKeys(value), ['0', symbol]);
  assert.equal(delete value[symbol], true);
  assert.equal(value[symbol], undefined);
  assert.equal(Object.hasOwn(properties, symbol), false);
  Object.defineProperty(value, 'extra', { value: second, configurable: true });
  assert.equal(properties.extra, second);
  assert.equal(delete value.extra, true);
  assert.equal(Object.hasOwn(properties, 'extra'), false);
  Object.defineProperty(properties, 'fixed', { value: first });
  assert.equal(Reflect.set(value, 'fixed', second), false);
  assert.equal(Reflect.deleteProperty(value, 'fixed'), false);
  assert.equal(Reflect.defineProperty(value, 'fixed', { value: second }), false);
  assert.equal(Reflect.preventExtensions(value), false);
  assert.equal(Object.isExtensible(value), true);
  assert.equal(Boolean(value), false);
  assert.equal(typeof value, 'undefined');
  assert.equal(value == null, true);
});

test('HTMLDDA allocation rejects invalid arguments and detached contexts', () => {
  const realm = compat.createContextHandle();
  assert.throws(() => compat.createHTMLDDA({}, () => null), {
    code: 'ERR_INVALID_ARG_TYPE',
  });
  assert.throws(() => compat.createHTMLDDA(realm, {}), {
    code: 'ERR_INVALID_ARG_TYPE',
  });
  realm.detachGlobal();
  assert.throws(() => compat.createHTMLDDA(realm, () => null), {
    code: 'ERR_CONTEXT_NOT_INITIALIZED',
  });
});

test('HTMLDDA leaves ordinary accessors and alternate receivers to V8', () => {
  const value = compat.createHTMLDDA(compat.createContextHandle(), () => null);
  const names = new Map([['entry', 1], ['length', 99]]);
  const prototype = { length: 2 };
  Object.setPrototypeOf(value, prototype);
  compat.setPropertyHandlers(value, {
    has: (key, hasOwn) => !hasOwn && !(key in prototype) && names.has(key),
    get: key => names.get(key),
    set: key => names.has(key) ? false : undefined,
    getOwnPropertyDescriptor: (key, hasOwn) => !hasOwn && !(key in prototype) && names.has(key) ? {
      value: names.get(key), configurable: true, enumerable: false, writable: false,
    } : undefined,
    getPropertyAttributes(key, hasOwn) {
      const descriptor = this.getOwnPropertyDescriptor(key, hasOwn);
      if (descriptor) descriptor.writable = true;
      return descriptor;
    },
    defineProperty: (key, descriptor, hasOwn) => !hasOwn && names.has(key) ? false : undefined,
    deleteProperty: key => names.has(key) ? false : undefined,
    ownKeys: () => [...names.keys()].filter(key => !(key in prototype)),
  });
  let setterThis;
  let setterValue;
  Object.defineProperty(value, 'accessor', {
    get() { return this; },
    set(next) { setterThis = this; setterValue = next; },
    configurable: true,
  });
  const other = {};
  const child = Object.create(value);
  assert.equal(value.accessor, value);
  assert.equal(Reflect.get(value, 'accessor', other), other);
  assert.equal(child.accessor, child);
  assert.equal(Reflect.set(value, 'accessor', 1, other), true);
  assert.equal(setterThis, other);
  assert.equal(setterValue, 1);
  assert.equal(Reflect.set(value, 'extra', 2, other), true);
  assert.equal(other.extra, 2);
  assert.equal(Object.hasOwn(value, 'extra'), false);
  value.extra = 3;
  assert.equal(value.extra, 3);
  assert.equal(delete value.extra, true);
  assert.equal(Object.hasOwn(value, 'extra'), false);
  assert.equal(value.entry, 1);
  assert.equal(value.length, 2);
  assert.equal(Object.hasOwn(value, 'length'), false);
  // SPEC_CLASH(htmlallcollection-property-order): V8/Chromium put ordinary
  // properties before virtual names; Web IDL, Firefox and WebKit reverse them.
  assert.deepEqual(Object.getOwnPropertyNames(value), ['accessor', 'entry']);
  assert.equal(Reflect.set(value, 'entry', 5), false);
  assert.equal(Reflect.set(value, 'entry', 5, other), true);
  assert.equal(other.entry, 5);
  assert.equal(value.entry, 1);
  assert.equal(Object.getOwnPropertyDescriptor(value, 'entry').writable, false);
  assert.equal(Reflect.deleteProperty(value, 'entry'), false);
  assert.equal(Boolean(value), false);
});

test('HTMLDDA retains its callback and delegate only while reachable', async () => {
  function allocate() {
    const realm = compat.createContextHandle();
    const call = compat.runInContext('() => 42', realm);
    const value = compat.createHTMLDDA(realm, call);
    const delegate = { owner: value };
    compat.setPropertyDelegate(value, delegate);
    return {
      realm: new WeakRef(realm),
      value: new WeakRef(value),
      call: new WeakRef(call),
      delegate: new WeakRef(delegate),
    };
  }
  await assertCollected(allocate());
});
