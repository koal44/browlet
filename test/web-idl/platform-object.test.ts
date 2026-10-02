import { describe, expect, it } from 'vitest';

import { TestRealm as Realm } from './test-realm';
import { DefinitionAssembly } from '../../src/web-idl/assembly';
import { BindingWorld } from '../../src/web-idl/binding/world';
import { RealmBinding } from '../../src/web-idl/binding/realm';
import {
  defineCallbackFunction, defineEnumeration, defineInterface, defineTypedef,
  idlType, observableArray, type AttributeMember, type MaplikeMember,
} from '../../src/web-idl/core/index';
import {
  getImplementationObject, getImplementationRecord, getPlatformObject, getPlatformRecord,
  stampImplementation, isStampedImplInstance, isStampedPlatformObject,
} from '../../src/web-idl/binding/platform-object';

describe('Web IDL platform-object identity and state', () => {
  it('reads the shared stamped record without a registry', () => {
    const assembly = new DefinitionAssembly([defineInterface({ name: 'Example', members: [] })]);
    const binding = new RealmBinding(assembly, new Realm(), new BindingWorld([]), (ctx) => ({ realm: ctx.realm }));
    const assembled = binding.resolveInterface('Example');
    const implInst = stampImplementation({}, assembled, binding);
    const record = getImplementationRecord(implInst);

    expect(record?.implInst).toBe(implInst);
    expect(record?.binding).toBe(binding);
    expect(record?.platformObject).toBeUndefined();

    const platformObject = {};
    expect(binding.initializePlatformObject(platformObject, assembled, implInst)).toBe(record);
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
    const firstAssembly = new DefinitionAssembly([derivedIDL, baseIDL]);
    const secondAssembly = new DefinitionAssembly([derivedIDL, baseIDL]);
    const baseAssembled = secondAssembly.interfaces.get('Base');
    const derivedAssembled = firstAssembly.interfaces.get('Derived');
    const secondDerivedAssembled = secondAssembly.interfaces.get('Derived');
    const world = new BindingWorld([]);
    const first = new RealmBinding(
      firstAssembly,
      new Realm(),
      world,
      (ctx) => ({ realm: ctx.realm }),
    );
    const second = new RealmBinding(
      secondAssembly,
      new Realm(),
      world,
      (ctx) => ({ realm: ctx.realm }),
    );
    const object = {};
    const implInst = {};

    if (!baseAssembled || !derivedAssembled || !secondDerivedAssembled) {
      throw new Error('Missing assembled interface');
    }

    const record = first.initializePlatformObject(object, derivedAssembled, implInst);

    expect(first.isPlatformObject(object)).toBe(true);
    expect(isStampedImplInstance(implInst)).toBe(true);
    expect(isStampedImplInstance(object)).toBe(false);
    expect(isStampedPlatformObject(object)).toBe(true);
    expect(second.isPlatformObject(object)).toBe(true);
    expect(second.implements(object, secondDerivedAssembled)).toBe(true);
    expect(second.implements(object, baseAssembled)).toBe(true);
    expect(getPlatformRecord(object)).toBe(record);
    expect(record.implInst).toBe(implInst);
    expect(record.platformObject).toBe(object);
    expect(record.assembled).toBe(derivedAssembled);
    expect(record.realm).toBe(first.realm);
    expect(Reflect.ownKeys(object)).toEqual([]);
    expect(second.isPlatformObject({})).toBe(false);

    const authorObject = Object.create(
      second.getImplementationBinding(secondDerivedAssembled).getInterfacePrototypeObject(),
    ) as object;
    expect(second.isPlatformObject(authorObject)).toBe(false);
    expect(second.implements(authorObject, secondDerivedAssembled)).toBe(false);
    expect(second.implements(authorObject, baseAssembled)).toBe(false);
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
      (ctx) => ({ realm: ctx.realm }),
    );

    expect(binding.install()).toEqual(new Map());
    expect(Object.hasOwn(realm.global, choice.name)).toBe(false);
    expect(Object.hasOwn(realm.global, callback.name)).toBe(false);
    expect(Object.hasOwn(realm.global, alias.name)).toBe(false);
  });

  it('returns the same instance with stamped state before projection', () => {
    const assembly = new DefinitionAssembly([defineInterface({ name: 'Example', members: [] })]);
    const assembled = assembly.interfaces.get('Example');
    if (!assembled) throw new Error('Missing assembled interface');
    const world = new BindingWorld([]);
    const binding = new RealmBinding(assembly, new Realm(), world, (ctx) => ({ realm: ctx.realm }));
    const value = Object.freeze({ count: 1 });

    expect(isStampedImplInstance(value)).toBe(false);
    const implInst = stampImplementation(value, assembled, binding);
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
    binding.initializePlatformObject(platformObject, assembled, implInst);
    expect(isStampedImplInstance(platformObject)).toBe(false);
    expect(getImplementationObject(platformObject)).toBe(implInst);
    expect(getPlatformObject(implInst)).toBe(platformObject);
  });

  it('looks up implementation records without inspecting proxy properties or prototypes', () => {
    const assembly = new DefinitionAssembly([defineInterface({ name: 'ProxyExample', members: [] })]);
    const assembled = assembly.interfaces.get('ProxyExample');
    if (!assembled) throw new Error('Missing assembled interface');
    const world = new BindingWorld([]);
    const binding = new RealmBinding(assembly, new Realm(), world, (ctx) => ({ realm: ctx.realm }));
    const trap = (): never => { throw new Error('Proxy trap invoked'); };
    const { proxy, revoke } = Proxy.revocable({}, {
      get: trap, getPrototypeOf: trap, defineProperty: trap, has: trap,
    });

    expect(getImplementationRecord(proxy)).toBeUndefined();
    expect(isStampedImplInstance(proxy)).toBe(false);
    const record = binding.initializePlatformObject({}, assembled, proxy);
    expect(isStampedImplInstance(proxy)).toBe(true);
    expect(getImplementationRecord(proxy)).toBe(record);
    revoke();
    expect(isStampedImplInstance(proxy)).toBe(true);
    expect(getImplementationRecord(proxy)).toBe(record);
    expect(getPlatformObject(proxy)).toBe(record.platformObject);
  });

  it('shares a record without changing frozen implementation and platform objects', () => {
    const assembly = new DefinitionAssembly([defineInterface({ name: 'FrozenExample', members: [] })]);
    const assembled = assembly.interfaces.get('FrozenExample');
    if (!assembled) throw new Error('Missing assembled interface');
    const world = new BindingWorld([]);
    const binding = new RealmBinding(assembly, new Realm(), world, (ctx) => ({ realm: ctx.realm }));
    const implInst = Object.freeze({ count: 1 });
    const platformObject = Object.freeze({ authorProperty: true });
    const keys = Reflect.ownKeys(platformObject);
    const descriptors = Object.getOwnPropertyDescriptors(platformObject);
    const prototype = Reflect.getPrototypeOf(platformObject);
    stampImplementation(implInst, assembled, binding);
    const record = getImplementationRecord(implInst);

    expect(isStampedPlatformObject(platformObject)).toBe(false);
    expect(binding.initializePlatformObject(platformObject, assembled, implInst)).toBe(record);
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
    const assembly = new DefinitionAssembly([defineInterface({ name: 'Example', members: [] })]);
    const assembled = assembly.interfaces.get('Example');
    if (!assembled) throw new Error('Missing assembled interface');
    const world = new BindingWorld([]);
    const binding = new RealmBinding(assembly, new Realm(), world, (ctx) => ({ realm: ctx.realm }));
    const implInst = {};
    if (stamped) stampImplementation(implInst, assembled, binding);

    expect(() => binding.initializePlatformObject(implInst, assembled, implInst))
      .toThrow('Implementation and platform objects must be distinct');
    expect(isStampedImplInstance(implInst)).toBe(stamped);
    expect(isStampedPlatformObject(implInst)).toBe(false);
  });

  it('reads a platform proxy record without invoking traps, including after revocation', () => {
    const assembly = new DefinitionAssembly([defineInterface({ name: 'ProxyExample', members: [] })]);
    const assembled = assembly.interfaces.get('ProxyExample');
    if (!assembled) throw new Error('Missing assembled interface');
    const world = new BindingWorld([]);
    const binding = new RealmBinding(assembly, new Realm(), world, (ctx) => ({ realm: ctx.realm }));
    const target = {};
    const trap = (): never => { throw new Error('Proxy trap invoked'); };
    const { proxy, revoke } = Proxy.revocable(target, {
      get: trap, getPrototypeOf: trap, defineProperty: trap, has: trap,
    });
    const implInst = {};
    const record = binding.initializePlatformObject(proxy, assembled, implInst);

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
    const assembly = new DefinitionAssembly([defineInterface({ name: 'Example', members: [] })]);
    const assembled = assembly.interfaces.get('Example');
    if (!assembled) throw new Error('Missing assembled interface');
    const firstWorld = new BindingWorld([]);
    const secondWorld = new BindingWorld([]);
    const first = new RealmBinding(assembly, new Realm(), firstWorld, (ctx) => ({ realm: ctx.realm }));
    const second = new RealmBinding(assembly, new Realm(), secondWorld, (ctx) => ({ realm: ctx.realm }));
    const platformObject = {};
    const implInst = {};
    const record = first.initializePlatformObject(platformObject, assembled, implInst);
    const secondImplInst = {};

    expect(second.isPlatformObject(platformObject)).toBe(false);
    expect(second.implements(platformObject, assembled)).toBe(false);
    expect(() => second.initializePlatformObject(platformObject, assembled, secondImplInst))
      .toThrow('Platform object is already associated');
    expect(isStampedImplInstance(secondImplInst)).toBe(false);
    expect(getPlatformRecord(platformObject)).toBe(record);
    expect(second.isPlatformObject(platformObject)).toBe(false);
    expect(() => stampImplementation(platformObject, assembled, second))
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
    expect(changedRecord?.assembled)
      .toBe(originalRecord?.assembled);
    expect(changedRecord?.realm).toBe(second.realm);
    expect(Reflect.getPrototypeOf(object))
      .toBe(second.getImplementationBinding(second.resolveInterface('RealmMutable')).getInterfacePrototypeObject());
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
      .toBe(second.getImplementationBinding(second.resolveInterface('RealmPrototypeFallback')).getInterfacePrototypeObject());
    expect(getPlatformRecord(object)?.realm).toBe(first.realm);
  });
});

function createRealmBindings(
  interfaceIDL: ReturnType<typeof defineInterface>,
): { first: RealmBinding; second: RealmBinding; } {
  class RealmTestImpl {}
  const world = new BindingWorld([interfaceIDL]);
  const firstContext = world.register(new Realm(), (ctx) => ({ realm: ctx.realm }));
  const secondContext = world.register(new Realm(), (ctx) => ({ realm: ctx.realm }));
  const first = world.getRealmBinding(firstContext.realm)!;
  const second = world.getRealmBinding(secondContext.realm)!;
  for (const binding of [first, second]) {
    binding.getImplementationBinding(binding.resolveInterface(interfaceIDL.name)).createImplementation = () => new RealmTestImpl();
  }
  return { first, second };
}
