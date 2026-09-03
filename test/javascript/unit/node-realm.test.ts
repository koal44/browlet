import { describe, expect, it } from 'vitest';

import {
  NodeRealm, type JavaScriptFunction, nodeRuntime,
} from '../../../src/javascript/index';

describe('Node JavaScript Realm', () => {
  it('captures realm intrinsics and creates realm-owned functions', () => {
    const realm = new NodeRealm();
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
      newTarget: JavaScriptFunction;
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
    const first = new NodeRealm();
    const second = new NodeRealm();
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

    expect(nodeRuntime.getAssociatedRealm(container.nested)).toBe(first);
    expect(nodeRuntime.getAssociatedRealm(function_)).toBe(first);
    expect(nodeRuntime.getAssociatedRealm(foreign)).toBe(second);
    expect(nodeRuntime.getAssociatedRealm({})).toBeUndefined();

    Reflect.set(first.global, 'hasActiveRealm', (value: object) =>
      nodeRuntime.getAssociatedRealm(value) === first);
    expect(first.evaluate(`
      hasActiveRealm(new Proxy({}, {
        getPrototypeOf() { throw new Error('hidden prototype'); }
      }))
    `, 'proxy.js')).toBe(true);
  });

  it('bridges one supplied global object and global-this value', () => {
    const realm = new ConfigurableNodeRealm();
    const globalObject = {};
    const globalThis = { answer: 42 };

    realm.setGlobalObjects(globalObject, globalThis);

    expect(Reflect.get(globalObject, 'Object')).toBe(realm.intrinsics.object);
    expect(Reflect.get(globalObject, 'globalThis')).toBe(globalThis);
    expect(realm.evaluate('globalThis', 'global-this.js')).toBe(globalThis);
    expect(realm.evaluate('answer', 'free-name.js')).toBe(42);
    expect(nodeRuntime.getAssociatedRealm(globalObject)).toBe(realm);
    expect(nodeRuntime.getAssociatedRealm(globalThis)).toBe(realm);
    expect(() => realm.setGlobalObjects({}, {})).toThrow(
      'Realm global objects are already initialized',
    );
  });
});

class ConfigurableNodeRealm extends NodeRealm {
  setGlobalObjects(globalObject: object, globalThis: object): void {
    this.initializeGlobalObjects(globalObject, globalThis);
  }
}
