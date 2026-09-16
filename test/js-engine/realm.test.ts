import { describe, expect, it } from 'vitest';
import { itPassesWith } from '../test-runtime';

import {
  JSRealm, type JSFunction, createMicrotaskQueue, getAssociatedRealm,
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
    const result = Reflect.apply(callable, receiver, ['a', 'b']);
    expect(result.argumentsList).toEqual(['a', 'b']);
    expect(result.newTarget).toBeUndefined();
    expect(result.thisArgument).toBe(receiver);
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
    expect(Reflect.get(Reflect.get(constructible, 'prototype') as object, 'constructor'))
      .toBe(constructible);
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

    expect(getAssociatedRealm(container.nested)).toBe(first);
    expect(getAssociatedRealm(function_)).toBe(first);
    expect(getAssociatedRealm(foreign)).toBe(second);
    expect(getAssociatedRealm({})).toBeUndefined();

    Reflect.set(first.global, 'hasActiveRealm', (value: object) =>
      getAssociatedRealm(value) === first);
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
    expect(getAssociatedRealm(globalObject)).toBe(realm);
    expect(getAssociatedRealm(globalThis)).toBe(realm);
    expect(() => realm.setGlobalObjects({}, {})).toThrow(
      'Realm global objects are already initialized',
    );
  });

  itPassesWith('functionRealms')('keeps a function realm after its prototype chain changes', () => {
    const first = new JSRealm();
    const second = new JSRealm();
    second.evaluate('globalThis.target = function () {}; undefined;', 'target.js');
    const target = Reflect.get(second.global, 'target') as object;
    Reflect.setPrototypeOf(target, first.intrinsics.functionPrototype);

    expect(getAssociatedRealm(target)).toBe(second);
  });

  it('does not assign a foreign function to the realm that returns it', () => {
    const first = new JSRealm();
    const second = new JSRealm();
    const target = second.evaluate('(function () {})', 'target.js') as object;
    Reflect.set(first.global, 'foreignTarget', target);

    expect(first.evaluate('foreignTarget', 'return-target.js')).toBe(target);
    expect(getAssociatedRealm(target)).toBe(second);
  });

  it('retains the realm of evaluated values without prototype evidence', () => {
    const realm = new JSRealm();
    for (const source of [
      'Object.create(null)',
      'Object.freeze(Object.create(null))',
      'Object.setPrototypeOf(function () {}, null)',
      'new Proxy(function () {}, { getPrototypeOf() { throw new Error("hidden"); } })',
    ]) {
      const value = realm.evaluate(source, 'no-prototype.js') as object;
      expect(getAssociatedRealm(value)).toBe(realm);
    }
  });

  itPassesWith('functionRealms')('recognizes a callable proxy without invoking its getPrototypeOf trap', () => {
    const first = new JSRealm();
    const second = new JSRealm();
    const target = second.evaluate('(function () {})', 'target.js') as object;
    const calls: string[] = [];
    Reflect.set(first.global, 'foreignTarget', target);
    Reflect.set(first.global, 'record', (name: string) => { calls.push(name); });
    first.evaluate(`
      globalThis.proxy = new Proxy(foreignTarget, {
        getPrototypeOf() { record('getPrototypeOf'); return Function.prototype; },
      });
      undefined;
    `, 'proxy.js');

    const realm = getAssociatedRealm(Reflect.get(first.global, 'proxy') as object);
    expect(calls).toEqual([]);
    expect(realm).toBe(second);
  });

  it('creates realm-owned ordinary and iterator-result objects', () => {
    const realm = new JSRealm();
    const prototype = realm.createOrdinaryObject(null);
    const object = realm.createOrdinaryObject(prototype);
    expect(Reflect.getPrototypeOf(object)).toBe(prototype);
    expect(getAssociatedRealm(object)).toBe(realm);

    const result = realm.createIteratorResultObject('value', false);
    expect(result).toEqual({ value: 'value', done: false });
    expect(Reflect.getPrototypeOf(result))
      .toBe(realm.intrinsics.objectPrototype);
  });

  it('keeps allocation ownership across foreign prototypes and repeated evaluation', () => {
    const first = new JSRealm();
    const second = new JSRealm();
    const callable = first.createFunction(() => undefined, { length: 0, name: 'retained' });
    Object.setPrototypeOf(callable, null);

    for (const value of [
      first.createOrdinaryObject(second.intrinsics.objectPrototype),
      first.createOrdinaryObject(null),
      callable,
    ]) {
      const keys = Reflect.ownKeys(value);
      const prototype = Object.getPrototypeOf(value) as object | null;
      Object.freeze(value);
      Reflect.set(second.global, 'foreignValue', value);

      expect(getAssociatedRealm(value)).toBe(first);
      expect(second.evaluate('foreignValue', 'foreign-allocation.js')).toBe(value);
      expect(second.evaluate('foreignValue', 'foreign-allocation-again.js')).toBe(value);
      expect(getAssociatedRealm(value)).toBe(first);
      expect(Reflect.ownKeys(value)).toEqual(keys);
      expect(Object.getPrototypeOf(value)).toBe(prototype);
    }
  });
});

describe('Realm collection iterators', () => {
  it.each(['map', 'set'] as const)('%s iterator accepts next borrowed from another realm', (kind) => {
    const first = new JSRealm();
    const second = new JSRealm();
    let index = 0;
    const iterator = first.createCollectionIterator(kind, () =>
      first.createIteratorResultObject(++index, false));
    const foreignIterator = second.createCollectionIterator(kind, () =>
      second.createIteratorResultObject(undefined, true));
    const next = Reflect.get(foreignIterator, 'next') as JSFunction;

    expect(Reflect.apply(next, iterator, [])).toEqual({ value: 1, done: false });
    expect(Reflect.apply(Reflect.get(iterator, 'next') as JSFunction, iterator, []))
      .toEqual({ value: 2, done: false });
  });

  it.each(['map', 'set'] as const)('%s iterator state is hidden and survives freezing and prototype changes', (kind) => {
    const realm = new JSRealm();
    const iterator = realm.createCollectionIterator(kind, () =>
      realm.createIteratorResultObject('value', false));
    const prototype = kind === 'map'
      ? realm.intrinsics.iteration.mapIteratorPrototype
      : realm.intrinsics.iteration.setIteratorPrototype;
    const next = Reflect.get(iterator, 'next') as JSFunction;

    expect(Reflect.getPrototypeOf(iterator)).toBe(prototype);
    expect(Reflect.ownKeys(iterator)).toEqual([]);
    Reflect.setPrototypeOf(iterator, null);
    Object.freeze(iterator);
    expect(Reflect.apply(next, iterator, [])).toEqual({ value: 'value', done: false });
    expect(Reflect.ownKeys(iterator)).toEqual([]);
  });

  it.each(['map', 'set'] as const)('%s iteration is lazy, branded, and completes once', (kind) => {
    const realm = new JSRealm();
    let calls = 0;
    const first = realm.createIteratorResultObject('first', false);
    const iterator = realm.createCollectionIterator(kind, () => {
      ++calls;
      expect(() => Reflect.apply(next, iterator, []))
        .toThrow(realm.intrinsics.typeError);
      return calls === 1 ? first : realm.createIteratorResultObject('ignored', true);
    });
    const next = Reflect.get(iterator, 'next') as JSFunction;
    expect(calls).toBe(0);
    expect(Reflect.apply(next, iterator, [])).toBe(first);
    const other = realm.createCollectionIterator(kind, () =>
      realm.createIteratorResultObject(undefined, true));
    expect(Reflect.get(other, 'next')).toBe(next);
    const opposite = realm.createCollectionIterator(kind === 'map' ? 'set' : 'map', () => first);
    for (const receiver of [{}, new Proxy(iterator, {}), opposite]) {
      expect(() => Reflect.apply(next, receiver, [])).toThrow(realm.intrinsics.typeError);
    }
    for (let i = 0; i < 2; ++i) {
      const result = Reflect.apply(next, iterator, []) as object;
      expect(result).toEqual({ value: undefined, done: true });
      expect(Object.getPrototypeOf(result)).toBe(realm.intrinsics.objectPrototype);
    }
    expect(calls).toBe(2);
  });

  it.each(['map', 'set'] as const)('%s iteration stays completed after a callback throws', (kind) => {
    const realm = new JSRealm();
    const failure = new Error('iterator failure');
    let calls = 0;
    const iterator = realm.createCollectionIterator(kind, () => {
      ++calls;
      throw failure;
    });
    const next = Reflect.get(iterator, 'next') as JSFunction;
    const caught: unknown[] = [];
    try {
      Reflect.apply(next, iterator, []);
    } catch (error) {
      caught.push(error);
    }
    expect(caught).toHaveLength(1);
    expect(caught[0]).toBe(failure);
    expect(Reflect.apply(next, iterator, [])).toEqual({ value: undefined, done: true });
    expect(calls).toBe(1);
  });
});

describe('Realm Promise observation', () => {
  it('installs reactions without consulting the promise then property', async () => {
    const microtaskQueue = createMicrotaskQueue();
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
    const queue = createMicrotaskQueue();
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
