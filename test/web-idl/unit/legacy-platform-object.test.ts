import { describe, expect, it } from 'vitest';

import { Realm } from '../../../src/browlet/realm';
import { assembleDefinitions } from '../../../src/web-idl/assembly';
import { JavaScriptBinding } from '../../../src/web-idl/binding';
import {
  defineInterface, idlType, type AttributeMember, type ConstructorMember,
  type InterfaceDefinition, type OperationMember, type StringifierMember,
} from '../../../src/web-idl/declaration/index';
import { ImplementationRegistry } from '../../../src/web-idl/registry';
import { PlatformObjectRegistry } from '../../../src/web-idl/platform-object';

describe('Web IDL legacy platform objects', () => {
  it('projects supported indices as read-only virtual own properties', () => {
    const constructor = constructorMember();
    const getter = indexedGetter('item', idlType.DOMString);
    const length = {
      kind: 'attribute',
      name: 'length',
      readonly: true,
      type: idlType.unsignedLong,
    } satisfies AttributeMember;
    const interfaceIDL = legacyInterface(
      'ReadOnlyIndexed',
      [constructor, getter, length],
    );
    const values = new WeakMap<object, string[]>();
    const implementations = new ImplementationRegistry();
    implementations.setConstructorSteps(constructor, function() {
      values.set(this, ['zero', 'one']);
    });
    implementations.setIndexedPropertySteps(getter, {
      getSupportedPropertyIndices() {
        return new Set(values.get(this)?.keys());
      },
    });
    implementations.setOperationSteps(getter, function(index) {
      return values.get(this as object)?.[index as number];
    });
    implementations.setAttributeSteps(length, {
      get() { return values.get(this as object)?.length ?? 0; },
    });

    const { binding, realm } = createBinding(interfaceIDL, implementations);
    const Interface = binding.getInterfaceObject('ReadOnlyIndexed');
    const object = construct(Interface);

    expect(Reflect.get(object, '0')).toBe('zero');
    expect(Reflect.get(object, '2')).toBeUndefined();
    expect(Reflect.has(object, '1')).toBe(true);
    expect(Reflect.has(object, '2')).toBe(false);
    expect(Object.getOwnPropertyDescriptor(object, '0')).toEqual({
      configurable: true,
      enumerable: true,
      value: 'zero',
      writable: false,
    });
    expect(Object.keys(object)).toEqual(['0', '1']);
    expect(Reflect.get(Interface.prototype, Symbol.iterator)).toBe(
      realm.intrinsics.iteration.arrayValues,
    );
    expect(Array.from(object as Iterable<unknown>)).toEqual(['zero', 'one']);
    expect(call(Interface.prototype, 'item', object, 1)).toBe('one');

    expect(Reflect.set(object, '0', 'changed')).toBe(false);
    expect(Reflect.defineProperty(object, '2', { value: 'new' })).toBe(false);
    expect(Reflect.deleteProperty(object, '0')).toBe(false);
    expect(Reflect.deleteProperty(object, '2')).toBe(true);
    expect(Reflect.preventExtensions(object)).toBe(false);

    expect(Reflect.set(object, 'label', 'ordinary')).toBe(true);
    expect(Reflect.set(object, '01', 'not an index')).toBe(true);
    expect(Reflect.set(object, '-0', 'not an index')).toBe(true);
    expect(Reflect.set(object, '4294967294', 'index')).toBe(false);
    expect(Reflect.set(object, '4294967295', 'not an index')).toBe(true);
    const symbol = Symbol('ordinary');
    expect(Reflect.set(object, symbol, 'symbol')).toBe(true);
    expect(Reflect.ownKeys(object)).toEqual([
      '0', '1', 'label', '01', '-0', '4294967295', symbol,
    ]);
  });

  it('converts values and invokes a named indexed setter', () => {
    const constructor = constructorMember();
    const getter = indexedGetter('item', idlType.long);
    const setter = indexedSetter(
      'setItem',
      idlType.byte,
      [noArguments('Clamp')],
    );
    const interfaceIDL = legacyInterface(
      'WritableIndexed',
      [constructor, getter, setter],
    );
    const values = new WeakMap<object, Map<number, number>>();
    const implementations = new ImplementationRegistry();
    implementations.setConstructorSteps(constructor, function() {
      values.set(this, new Map([[0, 1]]));
    });
    implementations.setIndexedPropertySteps(getter, {
      getSupportedPropertyIndices() {
        return new Set(values.get(this)?.keys());
      },
    });
    implementations.setOperationSteps(getter, function(index) {
      return values.get(this as object)?.get(index as number);
    });
    implementations.setOperationSteps(setter, function(index, value) {
      values.get(this as object)?.set(index as number, value as number);
    });

    const { binding } = createBinding(interfaceIDL, implementations);
    const Interface = binding.getInterfaceObject('WritableIndexed');
    const object = construct(Interface);
    const implementation = binding.platformObjects.getImplementationObject(
      object,
    );
    if (!implementation) throw new Error('Missing implementation target');

    expect(Reflect.set(object, '0', 300)).toBe(true);
    expect(Reflect.set(object, '2', '8.7')).toBe(true);
    expect(Reflect.get(object, '0')).toBe(127);
    expect(Reflect.get(object, '2')).toBe(9);
    expect(Reflect.ownKeys(object)).toEqual(['0', '2']);

    expect(Reflect.defineProperty(object, '1', { writable: true })).toBe(true);
    expect(Reflect.get(object, '1')).toBe(0);
    expect(Reflect.defineProperty(object, '3', {
      get: () => 3,
    })).toBe(false);

    const child = Object.create(object) as object;
    expect(Reflect.set(child, '0', 11)).toBe(true);
    expect(Reflect.getOwnPropertyDescriptor(child, '0')?.value).toBe(11);
    expect(values.get(implementation)?.get(0)).toBe(127);
  });

  it('distinguishes new and existing anonymous indexed assignments', () => {
    const constructor = constructorMember();
    const getter = indexedGetter(undefined, idlType.DOMString);
    const setter = indexedSetter(undefined, idlType.DOMString);
    const interfaceIDL = legacyInterface(
      'AnonymousIndexed',
      [constructor, getter, setter],
    );
    const values = new WeakMap<object, Map<number, string>>();
    const invocations: string[] = [];
    const implementations = new ImplementationRegistry();
    implementations.setConstructorSteps(constructor, function() {
      values.set(this, new Map([[0, 'initial']]));
    });
    implementations.setOperationSteps(getter, function(index) {
      return values.get(this as object)?.get(index as number);
    });
    implementations.setIndexedPropertySteps(getter, {
      getSupportedPropertyIndices() {
        return new Set(values.get(this)?.keys());
      },
      setExisting(index, value) {
        invocations.push(`existing:${String(index)}`);
        values.get(this)?.set(index, value as string);
      },
      setNew(index, value) {
        invocations.push(`new:${String(index)}`);
        values.get(this)?.set(index, value as string);
      },
    });

    const { binding } = createBinding(interfaceIDL, implementations);
    const object = construct(binding.getInterfaceObject('AnonymousIndexed'));

    expect(Reflect.set(object, '0', 'updated')).toBe(true);
    expect(Reflect.set(object, '1', 'created')).toBe(true);
    expect(invocations).toEqual(['existing:0', 'new:1']);
    expect(Reflect.get(object, '0')).toBe('updated');
    expect(Reflect.get(object, '1')).toBe('created');
  });

  it('uses the indexed operations from the derived-most interface', () => {
    const baseGetter = indexedGetter('baseItem', idlType.DOMString);
    const derivedGetter = indexedGetter('derivedItem', idlType.DOMString);
    const constructor = constructorMember();
    const base = legacyInterface('IndexedBase', [baseGetter]);
    const derived = defineInterface({
      exposed: '*',
      inherits: 'IndexedBase',
      members: [constructor, derivedGetter],
      name: 'IndexedDerived',
    });
    const implementations = new ImplementationRegistry();
    implementations.setConstructorSteps(constructor, () => undefined);
    implementations.setIndexedPropertySteps(baseGetter, {
      getSupportedPropertyIndices: () => new Set([0]),
    });
    implementations.setIndexedPropertySteps(derivedGetter, {
      getSupportedPropertyIndices: () => new Set([1]),
    });
    implementations.setOperationSteps(baseGetter, () => 'base');
    implementations.setOperationSteps(derivedGetter, () => 'derived');

    const binding = new JavaScriptBinding(
      assembleDefinitions([derived, base]),
      new Realm(),
      new PlatformObjectRegistry(),
      implementations,
    );
    const object = construct(binding.getInterfaceObject('IndexedDerived'));

    expect(Reflect.has(object, '0')).toBe(false);
    expect(Reflect.get(object, '1')).toBe('derived');
    expect(Reflect.ownKeys(object)).toEqual(['1']);
  });

  it('exposes only named properties that are not shadowed', () => {
    const constructor = constructorMember();
    const getter = namedGetter('namedItem', idlType.DOMString);
    const length = {
      kind: 'attribute', name: 'length', readonly: true,
      type: idlType.unsignedLong,
    } satisfies AttributeMember;
    const interfaceIDL = legacyInterface(
      'ReadOnlyNamed',
      [constructor, getter, length],
    );
    const values = new WeakMap<object, Map<string, string>>();
    const implementations = new ImplementationRegistry();
    implementations.setConstructorSteps(constructor, function() {
      values.set(this, new Map([
        ['alpha', 'named alpha'],
        ['length', 'named length'],
        ['toString', 'named toString'],
      ]));
    });
    implementations.setNamedPropertySteps(getter, {
      getSupportedPropertyNames() {
        return new Set(values.get(this)?.keys());
      },
    });
    implementations.setOperationSteps(getter, function(name) {
      return values.get(this as object)?.get(name as string);
    });
    implementations.setAttributeSteps(length, {
      get() { return values.get(this as object)?.size ?? 0; },
    });

    const { binding } = createBinding(interfaceIDL, implementations);
    const Interface = binding.getInterfaceObject('ReadOnlyNamed');
    const object = construct(Interface);

    expect(Reflect.get(object, 'alpha')).toBe('named alpha');
    expect(Reflect.get(object, 'length')).toBe(3);
    expect(Reflect.get(object, 'toString')).toBeTypeOf('function');
    expect(Object.getOwnPropertyDescriptor(object, 'alpha')).toEqual({
      configurable: true,
      enumerable: true,
      value: 'named alpha',
      writable: false,
    });
    expect(Reflect.ownKeys(object)).toEqual(['alpha']);
    expect(Object.keys(object)).toEqual(['alpha']);
    expect(Reflect.set(object, 'alpha', 'shadow')).toBe(false);
    expect(Reflect.defineProperty(object, 'alpha', { value: 'shadow' }))
      .toBe(false);
    expect(Reflect.deleteProperty(object, 'alpha')).toBe(false);

    expect(Reflect.set(object, 'ordinary', 'value')).toBe(true);
    expect(Reflect.get(object, 'ordinary')).toBe('value');
    expect(Reflect.deleteProperty(object, 'ordinary')).toBe(true);
  });

  it('ignores named properties objects when checking prototype shadowing', () => {
    const constructor = constructorMember();
    const globalGetter = namedGetter('globalItem', idlType.DOMString);
    const legacyGetter = namedGetter('legacyItem', idlType.DOMString);
    const window = defineInterface({
      exposed: ['Window'],
      extendedAttributes: [{
        kind: 'identifier', name: 'Global', value: 'Window',
      }],
      members: [globalGetter],
      name: 'Window',
    });
    const legacy = legacyInterface(
      'LegacyNamed',
      [constructor, legacyGetter],
    );
    const implementations = new ImplementationRegistry();
    implementations.setConstructorSteps(constructor, () => undefined);
    implementations.setNamedPropertySteps(globalGetter, {
      getSupportedPropertyNames: () => new Set(['shared']),
    });
    implementations.setNamedPropertySteps(legacyGetter, {
      getSupportedPropertyNames: () => new Set(['shared']),
    });
    implementations.setOperationSteps(globalGetter, () => 'global');
    implementations.setOperationSteps(legacyGetter, () => 'legacy');

    const definitions = assembleDefinitions([window, legacy]);
    const globalBinding = new JavaScriptBinding(
      definitions,
      new Realm({ globalNames: ['Window'] }),
      new PlatformObjectRegistry(),
      implementations,
    );
    const legacyBinding = new JavaScriptBinding(
      definitions,
      new Realm({ globalNames: ['Window'] }),
      new PlatformObjectRegistry(),
      implementations,
    );
    const global = globalBinding.projectGlobalObject({}, 'Window').object;
    const globalPrototype = Reflect.getPrototypeOf(global);
    const namedProperties = globalPrototype &&
      Reflect.getPrototypeOf(globalPrototype);
    if (!namedProperties) throw new Error('Missing named properties object');

    const object = construct(legacyBinding.getInterfaceObject('LegacyNamed'));
    expect(Reflect.setPrototypeOf(object, namedProperties)).toBe(true);
    expect(Reflect.get(object, 'shared')).toBe('legacy');
  });

  it('applies override-built-ins, unenumerable names, and named methods', () => {
    const constructor = constructorMember();
    const getter = namedGetter('namedItem', idlType.any);
    const setter = namedSetter('setNamedItem', idlType.long);
    const deleter = namedDeleter('removeNamedItem', idlType.boolean);
    const length = {
      kind: 'attribute', name: 'length', readonly: true,
      type: idlType.unsignedLong,
    } satisfies AttributeMember;
    const fixed = {
      extendedAttributes: [noArguments('LegacyUnforgeable')],
      kind: 'attribute',
      name: 'fixed',
      readonly: true,
      type: idlType.DOMString,
    } satisfies AttributeMember;
    const interfaceIDL = defineInterface({
      exposed: '*',
      extendedAttributes: [
        noArguments('LegacyOverrideBuiltIns'),
        noArguments('LegacyUnenumerableNamedProperties'),
      ],
      members: [constructor, getter, setter, deleter, length, fixed],
      name: 'OverridingNamed',
    });
    const values = new WeakMap<object, Map<string, unknown>>();
    const implementations = new ImplementationRegistry();
    implementations.setConstructorSteps(constructor, function() {
      values.set(this, new Map([
        ['alpha', 'named alpha'],
        ['length', 'named length'],
        ['toString', 'named toString'],
        ['fixed', 'named fixed'],
        ['locked', 'locked'],
      ]));
    });
    implementations.setNamedPropertySteps(getter, {
      getSupportedPropertyNames() {
        return new Set(values.get(this)?.keys());
      },
    });
    implementations.setOperationSteps(getter, function(name) {
      return values.get(this as object)?.get(name as string);
    });
    implementations.setOperationSteps(setter, function(name, value) {
      values.get(this as object)?.set(name as string, value);
    });
    implementations.setOperationSteps(deleter, function(name) {
      if (name === 'locked') return false;
      return values.get(this as object)?.delete(name as string) ?? false;
    });
    implementations.setAttributeSteps(length, { get: () => 5 });
    implementations.setAttributeSteps(fixed, { get: () => 'fixed attribute' });

    const { binding } = createBinding(interfaceIDL, implementations);
    const Interface = binding.getInterfaceObject('OverridingNamed');
    const object = construct(Interface);

    expect(Reflect.get(object, 'alpha')).toBe('named alpha');
    expect(Reflect.get(object, 'length')).toBe('named length');
    expect(Reflect.get(object, 'toString')).toBe('named toString');
    expect(Reflect.get(object, 'fixed')).toBe('fixed attribute');
    expect(Object.getOwnPropertyDescriptor(object, 'alpha')?.enumerable)
      .toBe(false);
    expect(Reflect.ownKeys(object)).toEqual([
      'alpha', 'length', 'toString', 'locked', 'fixed',
    ]);
    expect(Object.keys(object)).toEqual(['fixed']);

    expect(Reflect.set(object, 'created', '7.9')).toBe(true);
    expect(Reflect.get(object, 'created')).toBe(7);
    expect(Reflect.defineProperty(object, 'defined', { value: 8.9 })).toBe(true);
    expect(Reflect.get(object, 'defined')).toBe(8);
    expect(Reflect.defineProperty(object, 'accessor', { get: () => 1 }))
      .toBe(false);
    expect(Reflect.defineProperty(object, 'fixed', { value: 'changed' }))
      .toBe(false);
    expect(Reflect.deleteProperty(object, 'created')).toBe(true);
    expect(Reflect.has(object, 'created')).toBe(false);
    expect(Reflect.deleteProperty(object, 'locked')).toBe(false);
  });

  it('installs an unforgeable stringifier over a supported named property', () => {
    const constructor = constructorMember();
    const getter = namedGetter('namedItem', idlType.DOMString);
    const stringifier = {
      extendedAttributes: [noArguments('LegacyUnforgeable')],
      kind: 'stringifier',
    } satisfies StringifierMember;
    const interfaceIDL = legacyInterface(
      'StringifyingNamed',
      [constructor, getter, stringifier],
    );
    const implementations = new ImplementationRegistry();
    implementations.setConstructorSteps(constructor, () => undefined);
    implementations.setNamedPropertySteps(getter, {
      getSupportedPropertyNames: () => new Set(['toString']),
    });
    implementations.setOperationSteps(getter, () => 'named');
    implementations.setStringificationBehavior(
      stringifier,
      () => 'stringified',
    );

    const { binding } = createBinding(interfaceIDL, implementations);
    const object = construct(binding.getInterfaceObject('StringifyingNamed'));
    const descriptor = Reflect.getOwnPropertyDescriptor(object, 'toString');

    expect(descriptor).toMatchObject({
      configurable: false,
      enumerable: true,
      writable: false,
    });
    expect(typeof descriptor?.value).toBe('function');
    expect(Reflect.apply(
      descriptor?.value as CallableFunction,
      object,
      [],
    )).toBe('stringified');
  });

  it('distinguishes anonymous named-property mutation steps', () => {
    const constructor = constructorMember();
    const getter = namedGetter(undefined, idlType.DOMString);
    const setter = namedSetter(undefined, idlType.DOMString);
    const deleter = namedDeleter(undefined, idlType.undefined);
    const interfaceIDL = legacyInterface(
      'AnonymousNamed',
      [constructor, getter, setter, deleter],
    );
    const values = new WeakMap<object, Map<string, string>>();
    const invocations: string[] = [];
    const implementations = new ImplementationRegistry();
    implementations.setConstructorSteps(constructor, function() {
      values.set(this, new Map([['existing', 'initial']]));
    });
    implementations.setOperationSteps(getter, function(name) {
      return values.get(this as object)?.get(name as string);
    });
    implementations.setNamedPropertySteps(getter, {
      deleteExisting(name) {
        invocations.push(`delete:${name}`);
        return values.get(this)?.delete(name) ?? false;
      },
      getSupportedPropertyNames() {
        return new Set(values.get(this)?.keys());
      },
      setExisting(name, value) {
        invocations.push(`existing:${name}`);
        values.get(this)?.set(name, value as string);
      },
      setNew(name, value) {
        invocations.push(`new:${name}`);
        values.get(this)?.set(name, value as string);
      },
    });

    const { binding } = createBinding(interfaceIDL, implementations);
    const object = construct(binding.getInterfaceObject('AnonymousNamed'));

    expect(Reflect.set(object, 'existing', 'updated')).toBe(true);
    expect(Reflect.set(object, 'created', 'new value')).toBe(true);
    expect(Reflect.deleteProperty(object, 'created')).toBe(true);
    expect(invocations).toEqual([
      'existing:existing', 'new:created', 'delete:created',
    ]);
  });

  it('gives indexed properties precedence over numeric named properties', () => {
    const constructor = constructorMember();
    const indexGetter = indexedGetter('item', idlType.DOMString);
    const indexSetter = indexedSetter('setItem', idlType.DOMString);
    const nameGetter = namedGetter('namedItem', idlType.DOMString);
    const nameSetter = namedSetter('setNamedItem', idlType.DOMString);
    const interfaceIDL = legacyInterface('IndexedAndNamed', [
      constructor, indexGetter, indexSetter, nameGetter, nameSetter,
    ]);
    const indices = new WeakMap<object, Map<number, string>>();
    const names = new WeakMap<object, Map<string, string>>();
    const implementations = new ImplementationRegistry();
    implementations.setConstructorSteps(constructor, function() {
      indices.set(this, new Map([[0, 'indexed zero']]));
      names.set(this, new Map([
        ['0', 'named zero'], ['1', 'named one'], ['alpha', 'named alpha'],
      ]));
    });
    implementations.setIndexedPropertySteps(indexGetter, {
      getSupportedPropertyIndices() {
        return new Set(indices.get(this)?.keys());
      },
    });
    implementations.setNamedPropertySteps(nameGetter, {
      getSupportedPropertyNames() {
        return new Set(names.get(this)?.keys());
      },
    });
    implementations.setOperationSteps(indexGetter, function(index) {
      return indices.get(this as object)?.get(index as number);
    });
    implementations.setOperationSteps(indexSetter, function(index, value) {
      indices.get(this as object)?.set(index as number, value as string);
    });
    implementations.setOperationSteps(nameGetter, function(name) {
      return names.get(this as object)?.get(name as string);
    });
    implementations.setOperationSteps(nameSetter, function(name, value) {
      names.get(this as object)?.set(name as string, value as string);
    });

    const { binding } = createBinding(interfaceIDL, implementations);
    const object = construct(binding.getInterfaceObject('IndexedAndNamed'));

    expect(Reflect.get(object, '0')).toBe('indexed zero');
    expect(Reflect.get(object, '1')).toBeUndefined();
    expect(Reflect.get(object, 'alpha')).toBe('named alpha');
    expect(Reflect.set(object, '1', 'new index')).toBe(true);
    expect(Reflect.get(object, '1')).toBe('new index');
    expect(Reflect.ownKeys(object)).toEqual(['0', '1', 'alpha']);
  });
});

function legacyInterface(
  name: string,
  members: InterfaceDefinition['members'],
): InterfaceDefinition {
  return defineInterface({ exposed: '*', members, name });
}

function constructorMember(): ConstructorMember {
  return { arguments: [], kind: 'constructor' };
}

function indexedGetter(
  name: string | undefined,
  returns: OperationMember['returns'],
): OperationMember {
  return {
    arguments: [{ name: 'index', type: idlType.unsignedLong }],
    kind: 'operation',
    name,
    returns,
    special: 'getter',
  };
}

function indexedSetter(
  name: string | undefined,
  valueType: OperationMember['returns'],
  extendedAttributes?: OperationMember['extendedAttributes'],
): OperationMember {
  return {
    arguments: [
      { name: 'index', type: idlType.unsignedLong },
      { extendedAttributes, name: 'value', type: valueType },
    ],
    kind: 'operation',
    name,
    returns: idlType.undefined,
    special: 'setter',
  };
}

function namedGetter(
  name: string | undefined,
  returns: OperationMember['returns'],
): OperationMember {
  return {
    arguments: [{ name: 'name', type: idlType.DOMString }],
    kind: 'operation',
    name,
    returns,
    special: 'getter',
  };
}

function namedSetter(
  name: string | undefined,
  valueType: OperationMember['returns'],
): OperationMember {
  return {
    arguments: [
      { name: 'name', type: idlType.DOMString },
      { name: 'value', type: valueType },
    ],
    kind: 'operation',
    name,
    returns: idlType.undefined,
    special: 'setter',
  };
}

function namedDeleter(
  name: string | undefined,
  returns: OperationMember['returns'],
): OperationMember {
  return {
    arguments: [{ name: 'name', type: idlType.DOMString }],
    kind: 'operation',
    name,
    returns,
    special: 'deleter',
  };
}

function noArguments(name: string) {
  return { kind: 'no-arguments', name } as const;
}

function createBinding(
  interfaceIDL: InterfaceDefinition,
  implementations: ImplementationRegistry,
): { binding: JavaScriptBinding; realm: Realm; } {
  const realm = new Realm();
  return {
    binding: new JavaScriptBinding(
      assembleDefinitions([interfaceIDL]),
      realm,
      new PlatformObjectRegistry(),
      implementations,
    ),
    realm,
  };
}

function construct(target: object): object {
  if (typeof target !== 'function') throw new Error('Target is not callable');
  return Reflect.construct(
    target as unknown as new () => object,
    [],
  );
}

function call(
  target: object,
  name: PropertyKey,
  receiver: unknown,
  ...argumentsList: unknown[]
): unknown {
  const method = Reflect.get(target, name) as unknown;
  if (typeof method !== 'function') throw new Error('Member is not callable');
  return Reflect.apply(method, receiver, argumentsList);
}
