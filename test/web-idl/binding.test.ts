import { describe, expect, it } from 'vitest';

import { TestRealm as Realm } from './test-realm';
import { assembleDefinitions } from '../../src/web-idl/assembly';
import { RealmBinding } from '../../src/web-idl/binding';
import {
  defineCallbackFunction, defineEnumeration, defineInterface, defineTypedef,
  idlType, observableArray, type AttributeMember, type MaplikeMember,
} from '../../src/web-idl/declaration/index';
import { PlatformObjectRegistry } from '../../src/web-idl/platform-object';
import { registerDefinitionBindings } from '../../src/web-idl/projection';

describe('Web IDL JavaScript binding foundation', () => {
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
    const first = new RealmBinding(
      firstDefinitions,
      new Realm(),
      platformObjects,
    );
    const second = new RealmBinding(
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
    expect(record.platformObject).toBe(object);
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
      name: 'AuditCallback',
      returns: idlType.undefined,
      arguments: [],
    });
    const alias = defineTypedef({
      name: 'AuditAlias',
      type: idlType.DOMString,
    });
    const realm = new Realm();
    const binding = new RealmBinding(
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
      name: 'RealmMutable',
      exposed: '*',
      members: [numbers, entries],
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

  it('uses the newTarget realm when its prototype is not an object', () => {
    const interfaceIDL = defineInterface({
      name: 'RealmPrototypeFallback',
      exposed: '*', members: [],
    });
    const { first, second } = createRealmBindings(interfaceIDL);
    registerDefinitionBindings(first);
    registerDefinitionBindings(second);
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

function createRealmBindings(
  interfaceIDL: ReturnType<typeof defineInterface>,
): { first: RealmBinding; second: RealmBinding; } {
  const platformObjects = new PlatformObjectRegistry();
  return {
    first: new RealmBinding(
      assembleDefinitions([interfaceIDL]),
      new Realm(),
      platformObjects,
    ),
    second: new RealmBinding(
      assembleDefinitions([interfaceIDL]),
      new Realm(),
      platformObjects,
    ),
  };
}
