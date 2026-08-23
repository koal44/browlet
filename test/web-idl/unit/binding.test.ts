import { describe, expect, it } from 'vitest';

import { Realm } from '../../../src/browlet/realm';
import { assembleDefinitions } from '../../../src/web-idl/assembly';
import { JavaScriptBinding } from '../../../src/web-idl/binding';
import {
  defineCallbackFunction, defineEnumeration, defineInterface, defineTypedef,
  idlType, observableArray, type AttributeMember, type MaplikeMember,
} from '../../../src/web-idl/definition';
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
    const firstDefinitions = assembleDefinitions([derivedIDL, baseIDL]);
    const secondDefinitions = assembleDefinitions([derivedIDL, baseIDL]);
    const base = secondDefinitions.getInterface('Base');
    const derived = firstDefinitions.getInterface('Derived');
    const secondDerived = secondDefinitions.getInterface('Derived');
    const platformObjects = new PlatformObjectRegistry();
    const first = new JavaScriptBinding(
      firstDefinitions,
      new Realm(),
      platformObjects,
    );
    const second = new JavaScriptBinding(
      secondDefinitions,
      new Realm(),
      platformObjects,
    );
    const object = {};

    if (!base || !derived || !secondDerived) {
      throw new Error('Missing assembled interface');
    }

    const record = first.associatePlatformObject(object, derived);

    expect(first.isPlatformObject(object)).toBe(true);
    expect(second.isPlatformObject(object)).toBe(true);
    expect(second.implements(object, secondDerived)).toBe(true);
    expect(second.implements(object, base)).toBe(true);
    expect(second.getPlatformObjectRecord(object)).toBe(record);
    expect(record.implementation).toBe(object);
    expect(record.object).toBe(object);
    expect(record.primaryInterface).toBe(derived);
    expect(record.realm).toBe(first.realm);
    expect(Reflect.ownKeys(object)).toEqual([]);
    expect(second.isPlatformObject({})).toBe(false);

    const authorObject = Object.create(
      second.getInterfacePrototypeObject(secondDerived),
    ) as object;
    expect(second.isPlatformObject(authorObject)).toBe(false);
    expect(second.implements(authorObject, secondDerived)).toBe(false);
    expect(second.implements(authorObject, base)).toBe(false);
  });

  it('does not expose type-only definitions as realm globals', () => {
    const choice = defineEnumeration({
      name: 'AuditChoice',
      values: ['first', 'second'],
    });
    const callback = defineCallbackFunction({
      arguments: [],
      name: 'AuditCallback',
      returns: idlType.undefined,
    });
    const alias = defineTypedef({
      name: 'AuditAlias',
      type: idlType.DOMString,
    });
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([choice, callback, alias]),
      realm,
      new PlatformObjectRegistry(),
    );

    expect(binding.install()).toEqual(new Map());
    expect(Object.hasOwn(realm.global, choice.name)).toBe(false);
    expect(Object.hasOwn(realm.global, callback.name)).toBe(false);
    expect(Object.hasOwn(realm.global, alias.name)).toBe(false);
  });

  it('changes a platform object realm without replacing its state', () => {
    const numbers = {
      kind: 'attribute',
      name: 'numbers',
      type: observableArray(idlType.long),
    } satisfies AttributeMember;
    const entries = {
      key: idlType.DOMString,
      kind: 'maplike',
      value: idlType.long,
    } satisfies MaplikeMember;
    const interfaceIDL = defineInterface({
      exposed: '*',
      members: [numbers, entries],
      name: 'RealmMutable',
    });
    const { first, second } = createRealmBindings(interfaceIDL);
    const object = first.createPlatformObject('RealmMutable');
    const originalRecord = first.getPlatformObjectRecord(object);
    const array = Reflect.get(object, 'numbers') as unknown[];
    array.push(1);
    const set = Reflect.get(object, 'set') as unknown;
    if (typeof set !== 'function') throw new Error('Missing maplike set method');
    Reflect.apply(set, object, ['answer', 42]);

    second.changePlatformObjectRealm(object);

    const changedRecord = second.getPlatformObjectRecord(object);
    expect(changedRecord).toBe(originalRecord);
    expect(changedRecord?.primaryInterface)
      .toBe(originalRecord?.primaryInterface);
    expect(changedRecord?.realm).toBe(second.realm);
    expect(Reflect.getPrototypeOf(object))
      .toBe(second.getInterfacePrototypeObject('RealmMutable'));
    expect(Reflect.get(object, 'numbers')).toBe(array);
    expect(array).toEqual([1]);
    const get = Reflect.get(object, 'get') as unknown;
    if (typeof get !== 'function') throw new Error('Missing maplike get method');
    expect(Reflect.apply(get, object, ['answer'])).toBe(42);
  });

  it.fails('uses the newTarget realm when its prototype is not an object', () => {
    const interfaceIDL = defineInterface({
      exposed: '*', members: [], name: 'RealmPrototypeFallback',
    });
    const { first, second } = createRealmBindings(interfaceIDL);
    const newTarget = second.realm.createFunction(
      () => undefined,
      { constructible: true, length: 0, name: 'Derived' },
    );
    Reflect.set(newTarget, 'prototype', null);

    const object = first.createPlatformObject(
      'RealmPrototypeFallback',
      newTarget,
    );

    expect(Reflect.getPrototypeOf(object))
      .toBe(second.getInterfacePrototypeObject('RealmPrototypeFallback'));
    expect(first.getPlatformObjectRecord(object)?.realm).toBe(first.realm);
  });
});

function createBinding(realm: Realm): JavaScriptBinding {
  return new JavaScriptBinding(
    assembleDefinitions([]),
    realm,
    new PlatformObjectRegistry(),
  );
}

function createRealmBindings(
  interfaceIDL: ReturnType<typeof defineInterface>,
): { first: JavaScriptBinding; second: JavaScriptBinding; } {
  const platformObjects = new PlatformObjectRegistry();
  return {
    first: new JavaScriptBinding(
      assembleDefinitions([interfaceIDL]),
      new Realm(),
      platformObjects,
    ),
    second: new JavaScriptBinding(
      assembleDefinitions([interfaceIDL]),
      new Realm(),
      platformObjects,
    ),
  };
}
