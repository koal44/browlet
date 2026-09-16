import { describe, expect, it } from 'vitest';

import { TestRealm as Realm } from './test-realm';
import { DefinitionAssembly } from '../../src/web-idl/assembly';
import { BindingWorld } from '../../src/web-idl/binding-world';
import { RealmBinding } from '../../src/web-idl/realm-binding';
import {
  defineCallbackFunction, defineEnumeration, defineInterface, defineTypedef,
  idlType, observableArray, type AttributeMember, type MaplikeMember,
} from '../../src/web-idl/core/index';
import {
  getImplementationObject, getImplementationRecord, getPlatformObject, getPlatformRecord,
  stampImplementation, isStampedImplInstance, isStampedPlatformObject,
} from '../../src/web-idl/platform-object';
import { registerDefinitionBindings } from '../../src/web-idl/implementation-binding';

describe('Web IDL platform-object identity and state', () => {
  it('reads the shared stamped record without a registry', () => {
    const definitions = new DefinitionAssembly([defineInterface({ name: 'Example', members: [] })]);
    const binding = new RealmBinding(definitions, new Realm(), new BindingWorld([]));
    const primaryInterface = binding.resolveInterface('Example');
    const implInst = stampImplementation({}, primaryInterface, binding);
    const record = getImplementationRecord(implInst);

    expect(record?.implInst).toBe(implInst);
    expect(record?.binding).toBe(binding);
    expect(record?.platformObject).toBeUndefined();

    const platformObject = {};
    expect(binding.initializePlatformObject(platformObject, primaryInterface, implInst)).toBe(record);
    expect(getPlatformRecord(platformObject)).toBe(record);
    expect(getImplementationObject(platformObject)).toBe(implInst);
    expect(getPlatformObject(implInst)).toBe(platformObject);
  });

  it('recognizes platform objects and inherited interfaces across realms', () => {
    const baseIDL = defineInterface({ name: 'Base', members: [] });
    const derivedIDL = defineInterface({
      name: 'Derived',
      inherits: 'Base',
      members: [],
    });
    const firstDefinitions = new DefinitionAssembly([derivedIDL, baseIDL]);
    const secondDefinitions = new DefinitionAssembly([derivedIDL, baseIDL]);
    const base = secondDefinitions.getInterface('Base');
    const derived = firstDefinitions.getInterface('Derived');
    const secondDerived = secondDefinitions.getInterface('Derived');
    const world = new BindingWorld([]);
    const first = new RealmBinding(
      firstDefinitions,
      new Realm(),
      world,
    );
    const second = new RealmBinding(
      secondDefinitions,
      new Realm(),
      world,
    );
    const object = {};
    const implInst = {};

    if (!base || !derived || !secondDerived) {
      throw new Error('Missing assembled interface');
    }

    const record = first.initializePlatformObject(object, derived, implInst);

    expect(first.isPlatformObject(object)).toBe(true);
    expect(isStampedImplInstance(implInst)).toBe(true);
    expect(isStampedImplInstance(object)).toBe(false);
    expect(isStampedPlatformObject(object)).toBe(true);
    expect(second.isPlatformObject(object)).toBe(true);
    expect(second.implements(object, secondDerived)).toBe(true);
    expect(second.implements(object, base)).toBe(true);
    expect(getPlatformRecord(object)).toBe(record);
    expect(record.implInst).toBe(implInst);
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
      new DefinitionAssembly([choice, callback, alias]),
      realm,
      new BindingWorld([]),
    );

    expect(binding.install()).toEqual(new Map());
    expect(Object.hasOwn(realm.global, choice.name)).toBe(false);
    expect(Object.hasOwn(realm.global, callback.name)).toBe(false);
    expect(Object.hasOwn(realm.global, alias.name)).toBe(false);
  });

  it('returns the same instance with stamped state before projection', () => {
    const definitions = new DefinitionAssembly([defineInterface({ name: 'Example', members: [] })]);
    const primaryInterface = definitions.getInterface('Example');
    if (!primaryInterface) throw new Error('Missing assembled interface');
    const world = new BindingWorld([]);
    const binding = new RealmBinding(definitions, new Realm(), world);
    const value = Object.freeze({ count: 1 });

    expect(isStampedImplInstance(value)).toBe(false);
    const implInst = stampImplementation(value, primaryInterface, binding);
    expect(implInst).toBe(value);
    expect(implInst.count).toBe(1);
    expect(isStampedImplInstance(implInst)).toBe(true);
    expect(isStampedImplInstance(Object.create(implInst))).toBe(false);
    expect(isStampedImplInstance(null)).toBe(false);
    expect(isStampedImplInstance(1)).toBe(false);
    expect(Object.isFrozen(implInst)).toBe(true);
    expect(Reflect.ownKeys(implInst)).toEqual(['count']);
    expect(getImplementationRecord(implInst)?.implInst).toBe(implInst);
    expect(getPlatformObject(implInst)).toBeUndefined();

    const platformObject = {};
    binding.initializePlatformObject(platformObject, primaryInterface, implInst);
    expect(isStampedImplInstance(platformObject)).toBe(false);
    expect(getImplementationObject(platformObject)).toBe(implInst);
    expect(getPlatformObject(implInst)).toBe(platformObject);
  });

  it('looks up implementation records without inspecting proxy properties or prototypes', () => {
    const definitions = new DefinitionAssembly([defineInterface({ name: 'ProxyExample', members: [] })]);
    const primaryInterface = definitions.getInterface('ProxyExample');
    if (!primaryInterface) throw new Error('Missing assembled interface');
    const world = new BindingWorld([]);
    const binding = new RealmBinding(definitions, new Realm(), world);
    const trap = (): never => { throw new Error('Proxy trap invoked'); };
    const { proxy, revoke } = Proxy.revocable({}, {
      get: trap, getPrototypeOf: trap, defineProperty: trap, has: trap,
    });

    expect(getImplementationRecord(proxy)).toBeUndefined();
    expect(isStampedImplInstance(proxy)).toBe(false);
    const record = binding.initializePlatformObject({}, primaryInterface, proxy);
    expect(isStampedImplInstance(proxy)).toBe(true);
    expect(getImplementationRecord(proxy)).toBe(record);
    revoke();
    expect(isStampedImplInstance(proxy)).toBe(true);
    expect(getImplementationRecord(proxy)).toBe(record);
    expect(getPlatformObject(proxy)).toBe(record.platformObject);
  });

  it('shares a record without changing frozen implementation and platform objects', () => {
    const definitions = new DefinitionAssembly([defineInterface({ name: 'FrozenExample', members: [] })]);
    const primaryInterface = definitions.getInterface('FrozenExample');
    if (!primaryInterface) throw new Error('Missing assembled interface');
    const world = new BindingWorld([]);
    const binding = new RealmBinding(definitions, new Realm(), world);
    const implInst = Object.freeze({ count: 1 });
    const platformObject = Object.freeze({ authorProperty: true });
    const keys = Reflect.ownKeys(platformObject);
    const descriptors = Object.getOwnPropertyDescriptors(platformObject);
    const prototype = Reflect.getPrototypeOf(platformObject);
    stampImplementation(implInst, primaryInterface, binding);
    const record = getImplementationRecord(implInst);

    expect(isStampedPlatformObject(platformObject)).toBe(false);
    expect(binding.initializePlatformObject(platformObject, primaryInterface, implInst)).toBe(record);
    expect(isStampedPlatformObject(platformObject)).toBe(true);
    expect(getPlatformRecord(platformObject)).toBe(record);
    expect(getPlatformObject(implInst)).toBe(platformObject);
    expect(getImplementationObject(platformObject)).toBe(implInst);
    expect(Reflect.ownKeys(platformObject)).toEqual(keys);
    expect(Object.getOwnPropertyDescriptors(platformObject)).toEqual(descriptors);
    expect(Reflect.getPrototypeOf(platformObject)).toBe(prototype);
    expect(Object.isFrozen(platformObject)).toBe(true);
    expect(getPlatformRecord(Object.create(platformObject))).toBeUndefined();
    expect(getPlatformRecord(new Proxy(platformObject, {}))).toBeUndefined();
    expect(isStampedPlatformObject(Object.create(platformObject))).toBe(false);
    expect(isStampedPlatformObject(new Proxy(platformObject, {}))).toBe(false);
    expect(isStampedPlatformObject(null)).toBe(false);
    expect(isStampedPlatformObject(1)).toBe(false);
  });

  it.each([false, true])('rejects one object serving both identities (stamped: %s)', (stamped) => {
    const definitions = new DefinitionAssembly([defineInterface({ name: 'Example', members: [] })]);
    const primaryInterface = definitions.getInterface('Example');
    if (!primaryInterface) throw new Error('Missing assembled interface');
    const world = new BindingWorld([]);
    const binding = new RealmBinding(definitions, new Realm(), world);
    const implInst = {};
    if (stamped) stampImplementation(implInst, primaryInterface, binding);

    expect(() => binding.initializePlatformObject(implInst, primaryInterface, implInst))
      .toThrow('Implementation and platform objects must be distinct');
    expect(isStampedImplInstance(implInst)).toBe(stamped);
    expect(isStampedPlatformObject(implInst)).toBe(false);
  });

  it('reads a platform proxy record without invoking traps, including after revocation', () => {
    const definitions = new DefinitionAssembly([defineInterface({ name: 'ProxyExample', members: [] })]);
    const primaryInterface = definitions.getInterface('ProxyExample');
    if (!primaryInterface) throw new Error('Missing assembled interface');
    const world = new BindingWorld([]);
    const binding = new RealmBinding(definitions, new Realm(), world);
    const target = {};
    const trap = (): never => { throw new Error('Proxy trap invoked'); };
    const { proxy, revoke } = Proxy.revocable(target, {
      get: trap, getPrototypeOf: trap, defineProperty: trap, has: trap,
    });
    const implInst = {};
    const record = binding.initializePlatformObject(proxy, primaryInterface, implInst);

    expect(getPlatformRecord(proxy)).toBe(record);
    expect(isStampedPlatformObject(proxy)).toBe(true);
    expect(getPlatformRecord(target)).toBeUndefined();
    expect(getPlatformRecord(new Proxy(proxy, {}))).toBeUndefined();
    revoke();
    expect(getPlatformRecord(proxy)).toBe(record);
    expect(isStampedPlatformObject(proxy)).toBe(true);
    expect(getImplementationObject(proxy)).toBe(implInst);
  });

  it('rejects reusing a platform object in another world before stamping its new implementation', () => {
    const definitions = new DefinitionAssembly([defineInterface({ name: 'Example', members: [] })]);
    const primaryInterface = definitions.getInterface('Example');
    if (!primaryInterface) throw new Error('Missing assembled interface');
    const firstWorld = new BindingWorld([]);
    const secondWorld = new BindingWorld([]);
    const first = new RealmBinding(definitions, new Realm(), firstWorld);
    const second = new RealmBinding(definitions, new Realm(), secondWorld);
    const platformObject = {};
    const implInst = {};
    const record = first.initializePlatformObject(platformObject, primaryInterface, implInst);
    const secondImplInst = {};

    expect(second.isPlatformObject(platformObject)).toBe(false);
    expect(second.implements(platformObject, primaryInterface)).toBe(false);
    expect(() => second.initializePlatformObject(platformObject, primaryInterface, secondImplInst))
      .toThrow('Platform object is already associated');
    expect(isStampedImplInstance(secondImplInst)).toBe(false);
    expect(getPlatformRecord(platformObject)).toBe(record);
    expect(second.isPlatformObject(platformObject)).toBe(false);
    expect(() => stampImplementation(platformObject, primaryInterface, second))
      .toThrow('Implementation object is already stamped or is a platform object');
    expect(isStampedImplInstance(platformObject)).toBe(false);
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
    const object = first.createPlatformRecord(first.resolveInterface('RealmMutable')).platformObject!;
    const originalRecord = getPlatformRecord(object);
    const array = Reflect.get(object, 'numbers') as unknown[];
    array.push(1);
    const set = Reflect.get(object, 'set') as unknown;
    if (typeof set !== 'function') throw new Error('Missing maplike set method');
    Reflect.apply(set, object, ['answer', 42]);

    second.changePlatformObjectRealm(object);

    const changedRecord = getPlatformRecord(object);
    expect(changedRecord).toBe(originalRecord);
    expect(changedRecord?.primaryInterface)
      .toBe(originalRecord?.primaryInterface);
    expect(changedRecord?.realm).toBe(second.realm);
    expect(Reflect.getPrototypeOf(object))
      .toBe(second.getInterfacePrototypeObject(second.resolveInterface('RealmMutable')));
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

    const object = first.createPlatformRecord(
      first.resolveInterface('RealmPrototypeFallback'),
      newTarget,
    ).platformObject!;

    expect(Reflect.getPrototypeOf(object))
      .toBe(second.getInterfacePrototypeObject(second.resolveInterface('RealmPrototypeFallback')));
    expect(getPlatformRecord(object)?.realm).toBe(first.realm);
  });
});

function createRealmBindings(
  interfaceIDL: ReturnType<typeof defineInterface>,
): { first: RealmBinding; second: RealmBinding; } {
  class RealmTestImpl {}
  const world = new BindingWorld([]);
  const definitions = new DefinitionAssembly([interfaceIDL]);
  const first = new RealmBinding(definitions, new Realm(), world);
  const second = new RealmBinding(definitions, new Realm(), world);
  for (const binding of [first, second]) {
    binding.getDefinitionBinding(interfaceIDL).createImplementation = () => new RealmTestImpl();
  }
  return { first, second };
}
