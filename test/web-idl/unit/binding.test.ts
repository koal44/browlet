import { describe, expect, it } from 'vitest';

import { Realm } from '../../../src/browlet/realm';
import { assembleDefinitions } from '../../../src/web-idl/assembly';
import { defineInterface } from '../../../src/web-idl/definition';
import { JavaScriptBinding } from '../../../src/web-idl/binding';
import { PlatformObjectRegistry } from '../../../src/web-idl/platform-object';

describe('Web IDL JavaScript binding foundation', () => {
  it('creates callable and constructible functions in the target realm', () => {
    const realm = new Realm();
    const binding = createBinding(realm);
    const receiver = {};
    const callable = binding.realm.createFunction(
      (thisArgument, argumentsList, newTarget) => ({
        argumentsList,
        newTarget,
        thisArgument,
      }),
      { length: 2, name: 'perform' },
    );
    const constructible = binding.realm.createFunction(
      (_thisArgument, argumentsList, newTarget) => ({
        argumentsList,
        newTarget,
      }),
      { constructible: true, length: 1, name: 'Example' },
    );

    expect(callable).toBeInstanceOf(realm.intrinsics.function);
    expect(callable).not.toBeInstanceOf(Function);
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
    const unboundResult = Reflect.apply(callable, undefined, []) as {
      thisArgument: unknown;
    };
    expect(unboundResult.thisArgument).toBeUndefined();

    const instance = Reflect.construct(constructible, ['value']) as {
      argumentsList: unknown[];
      newTarget: unknown;
    };
    expect(constructible).toBeInstanceOf(realm.intrinsics.function);
    expect(Object.hasOwn(constructible, 'prototype')).toBe(true);
    expect(Object.getPrototypeOf(constructible))
      .toBe(realm.intrinsics.functionPrototype);
    expect(Reflect.get(constructible, 'prototype'))
      .toBeInstanceOf(realm.intrinsics.object);
    expect(instance.argumentsList).toEqual(['value']);
    expect(instance.newTarget).toBe(constructible);
  });

  it('captures core intrinsics before realm globals can change', () => {
    const realm = new Realm();
    const Array_ = realm.intrinsics.array;
    const BigInt_ = realm.intrinsics.bigInt;
    const Number_ = realm.intrinsics.number;
    const Object_ = realm.intrinsics.object;
    const String_ = realm.intrinsics.string;
    const TypeError_ = realm.intrinsics.typeError;

    expect(Array_).toBe(Reflect.get(realm.global, 'Array'));
    expect(BigInt_).toBe(Reflect.get(realm.global, 'BigInt'));
    expect(Number_).toBe(Reflect.get(realm.global, 'Number'));
    expect(Object_).toBe(Reflect.get(realm.global, 'Object'));
    expect(Object_).not.toBe(Object);
    expect(String_).toBe(Reflect.get(realm.global, 'String'));
    expect(realm.intrinsics.objectPrototype).toBe(Object_.prototype);
    expect(realm.intrinsics.functionPrototype)
      .toBe(realm.intrinsics.function.prototype);

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

  it('recognizes platform objects and inherited interfaces across realms', () => {
    const baseIDL = defineInterface({ name: 'Base', members: [] });
    const derivedIDL = defineInterface({
      name: 'Derived',
      inherits: 'Base',
      members: [],
    });
    const definitions = assembleDefinitions([derivedIDL, baseIDL]);
    const base = definitions.getInterface('Base');
    const derived = definitions.getInterface('Derived');
    const platformObjects = new PlatformObjectRegistry();
    const first = new JavaScriptBinding(
      definitions,
      new Realm(),
      platformObjects,
    );
    const second = new JavaScriptBinding(
      definitions,
      new Realm(),
      platformObjects,
    );
    const object = {};

    if (!base || !derived) throw new Error('Missing assembled interface');

    const record = first.associatePlatformObject(object, derived);

    expect(first.isPlatformObject(object)).toBe(true);
    expect(second.isPlatformObject(object)).toBe(true);
    expect(second.implements(object, derived)).toBe(true);
    expect(second.implements(object, base)).toBe(true);
    expect(second.getPlatformObjectRecord(object)).toBe(record);
    expect(record.implementation).toBe(object);
    expect(record.object).toBe(object);
    expect(record.primaryInterface).toBe(derived);
    expect(record.realm).toBe(first.realm);
    expect(Reflect.ownKeys(object)).toEqual([]);
    expect(second.isPlatformObject({})).toBe(false);
  });
});

function createBinding(realm: Realm): JavaScriptBinding {
  return new JavaScriptBinding(
    assembleDefinitions([]),
    realm,
    new PlatformObjectRegistry(),
  );
}
