import { describe, expect, it } from 'vitest';
import { itPassesWith } from '../test-runtime';

import {
  JSRealm, type JSFunction, jsRuntime,
} from '../../src/js-engine/index';

describe('JavaScript Realm', () => {
  it('captures realm intrinsics and creates realm-owned functions', () => {
    const realm = new JSRealm();
    const Array_ = realm.intrinsics.array;
    const BigInt_ = realm.intrinsics.bigInt;
    const Number_ = realm.intrinsics.number;
    const Object_ = realm.intrinsics.object;
    const String_ = realm.intrinsics.string;
    const TypeError_ = realm.intrinsics.typeError;
    const receiver = {};
    const callable = realm.createFunction(
      (thisArgument, argumentsList, newTarget) => ({
        argumentsList,
        newTarget,
        thisArgument,
      }),
      { length: 2, name: 'perform' },
    );
    const constructible = realm.createFunction(
      (_thisArgument, argumentsList, newTarget) => ({
        argumentsList,
        newTarget,
      }),
      { constructible: true, length: 1, name: 'Example' },
    );

    expect(Array_).toBe(Reflect.get(realm.global, 'Array'));
    expect(BigInt_).toBe(Reflect.get(realm.global, 'BigInt'));
    expect(Number_).toBe(Reflect.get(realm.global, 'Number'));
    expect(Object_).toBe(Reflect.get(realm.global, 'Object'));
    expect(Object_).not.toBe(Object);
    expect(String_).toBe(Reflect.get(realm.global, 'String'));
    expect(realm.intrinsics.objectPrototype).toBe(Object_.prototype);
    expect(realm.intrinsics.functionPrototype)
      .toBe(realm.intrinsics.function.prototype);
    expect(callable).toBeInstanceOf(realm.intrinsics.function);
    expect(Object.hasOwn(callable, 'prototype')).toBe(false);
    expect({ length: callable.length, name: callable.name }).toEqual({
      length: 2,
      name: 'perform',
    });
    expect(Reflect.apply(callable, receiver, ['a', 'b'])).toEqual({
      argumentsList: ['a', 'b'],
      newTarget: undefined,
      thisArgument: receiver,
    });
    expect(Reflect.apply(callable, undefined, [])).toMatchObject({
      thisArgument: undefined,
    });

    const instance = Reflect.construct(constructible, ['value']) as {
      argumentsList: unknown[];
      newTarget: JSFunction;
    };
    expect(Object.hasOwn(constructible, 'prototype')).toBe(true);
    expect(Object.getPrototypeOf(constructible))
      .toBe(realm.intrinsics.functionPrototype);
    expect(Reflect.get(constructible, 'prototype'))
      .toBeInstanceOf(realm.intrinsics.object);
    expect(instance.argumentsList).toEqual(['value']);
    expect(instance.newTarget).toBe(constructible);

    Reflect.set(realm.global, 'Array', Array);
    Reflect.set(realm.global, 'BigInt', BigInt);
    Reflect.set(realm.global, 'Number', Number);
    Reflect.set(realm.global, 'Object', Object);
    Reflect.set(realm.global, 'String', String);
    Reflect.set(realm.global, 'TypeError', TypeError);
    expect(realm.intrinsics.array).toBe(Array_);
    expect(realm.intrinsics.bigInt).toBe(BigInt_);
    expect(realm.intrinsics.number).toBe(Number_);
    expect(realm.intrinsics.object).toBe(Object_);
    expect(realm.intrinsics.string).toBe(String_);
    expect(realm.intrinsics.typeError).toBe(TypeError_);
  });

  it('isolates evaluation and recognizes objects across the shared runtime', () => {
    const first = new JSRealm();
    const second = new JSRealm();
    first.evaluate('globalThis.answer = 41', 'first.js');
    second.evaluate('globalThis.answer = 42', 'second.js');

    expect(first.evaluate('this', 'first-global.js')).toBe(first.global);
    expect(second.evaluate('this', 'second-global.js')).toBe(second.global);
    expect(first.evaluate('answer', 'first.js')).toBe(41);
    expect(second.evaluate('answer', 'second.js')).toBe(42);
    expect(first.intrinsics.object).not.toBe(second.intrinsics.object);

    const container = first.evaluate('({ nested: {} })', 'object.js') as {
      nested: object;
    };
    const function_ = first.createFunction(() => undefined, {
      length: 0,
      name: 'created',
    });
    const foreign = second.evaluate('({})', 'foreign.js') as object;

    expect(jsRuntime.getAssociatedRealm(container.nested)).toBe(first);
    expect(jsRuntime.getAssociatedRealm(function_)).toBe(first);
    expect(jsRuntime.getAssociatedRealm(foreign)).toBe(second);
    expect(jsRuntime.getAssociatedRealm({})).toBeUndefined();

    Reflect.set(first.global, 'hasActiveRealm', (value: object) =>
      jsRuntime.getAssociatedRealm(value) === first);
    expect(first.evaluate(`
      hasActiveRealm(new Proxy({}, {
        getPrototypeOf() { throw new Error('hidden prototype'); }
      }))
    `, 'proxy.js')).toBe(true);
  });

  it('bridges one supplied global object and global-this value', () => {
    const realm = new ConfigurableRealm();
    const globalObject = {};
    const globalThis = { answer: 42 };

    realm.setGlobalObjects(globalObject, globalThis);

    expect(Reflect.get(globalObject, 'Object')).toBe(realm.intrinsics.object);
    expect(Reflect.get(globalObject, 'globalThis')).toBe(globalThis);
    expect(realm.evaluate('globalThis', 'global-this.js')).toBe(globalThis);
    expect(realm.evaluate('answer', 'free-name.js')).toBe(42);
    expect(jsRuntime.getAssociatedRealm(globalObject)).toBe(realm);
    expect(jsRuntime.getAssociatedRealm(globalThis)).toBe(realm);
    expect(() => realm.setGlobalObjects({}, {})).toThrow(
      'Realm global objects are already initialized',
    );
  });

  it('creates realm-owned ordinary and iterator-result objects', () => {
    const realm = new JSRealm();
    const prototype = realm.createOrdinaryObject(null);
    const object = realm.createOrdinaryObject(prototype);
    expect(Reflect.getPrototypeOf(object)).toBe(prototype);
    expect(realm.runtime.getAssociatedRealm(object)).toBe(realm);

    const result = realm.createIteratorResultObject('value', false);
    expect(result).toEqual({ value: 'value', done: false });
    expect(Reflect.getPrototypeOf(result))
      .toBe(realm.intrinsics.objectPrototype);
  });
});

describe('Realm Promise observation', () => {
  it('installs reactions without consulting the promise then property', async () => {
    const microtaskQueue = jsRuntime.createMicrotaskQueue();
    const realm = new JSRealm(microtaskQueue);
    const promise = new realm.intrinsics.promise.constructor((resolve) => {
      resolve('fulfilled');
    });
    const values: unknown[] = [];
    const onFulfilled = realm.createFunction(
      (_thisArgument, [value]) => { values.push(value); },
      { length: 1, name: '' },
    );
    expect(Reflect.defineProperty(promise, 'then', {
      value() { throw new Error('author then was called'); },
    })).toBe(true);

    realm.observePromise(promise, onFulfilled, undefined);
    microtaskQueue.performMicrotaskCheckpoint();
    await Promise.resolve();

    expect(values).toEqual(['fulfilled']);
  });

  itPassesWith('v26+', 'explicitQueues')('does not consult author-defined promise constructors', () => {
    const realm = new JSRealm();
    const promise = new realm.intrinsics.promise.constructor(() => undefined);
    expect(Reflect.defineProperty(promise, 'constructor', {
      get() { throw new Error('author constructor was consulted'); },
    })).toBe(true);

    expect(() => realm.observePromise(
      promise,
      undefined,
      undefined,
    )).not.toThrow();
  });

  itPassesWith('v26+', 'explicitQueues')('places native observation of a Node promise on the supplied realm queue', async () => {
    const queue = jsRuntime.createMicrotaskQueue();
    const realm = new JSRealm(queue);
    const { promise, resolve } = Promise.withResolvers<string>();
    const seen: unknown[] = [];
    expect(Reflect.defineProperty(promise, 'constructor', {
      get() { throw new Error('author constructor was consulted'); },
    })).toBe(true);
    realm.observePromise(promise, (value) => { seen.push(value); }, undefined);
    resolve('observed');
    void Promise.resolve().then(() => seen.push('Node'));
    expect(seen).toEqual([]);
    queue.performMicrotaskCheckpoint();
    expect(seen).toEqual(['observed']);
    await Promise.resolve();
    expect(seen).toEqual(['observed', 'Node']);
  });
});

class ConfigurableRealm extends JSRealm {
  setGlobalObjects(globalObject: object, globalThis: object): void {
    this.initializeGlobalObjects(globalObject, globalThis);
  }
}
