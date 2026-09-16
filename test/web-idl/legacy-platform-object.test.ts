import { describe, expect, it } from 'vitest';

import { TestRealm as Realm, getInstalledInterface } from './test-realm';
import { DefinitionAssembly } from '../../src/web-idl/assembly';
import { BindingWorld } from '../../src/web-idl/binding-world';
import { RealmBinding } from '../../src/web-idl/realm-binding';
import {
  defineInterface, idlType, type AttributeMember, type ConstructorMember,
  type InterfaceDefinition, type OperationMember, type StringifierMember,
} from '../../src/web-idl/core/index';
import { getImplementationObject } from '../../src/web-idl/platform-object';

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

    const { binding, realm } = createBinding(interfaceIDL);
    const interfaceBinding = binding.getDefinitionBinding(interfaceIDL);
    interfaceBinding.getOrCreateMemberRecord(constructor).constructorBehavior = {
      kind: 'initialize',
      steps: function() {
        values.set(this, ['zero', 'one']);
      },
    };
    interfaceBinding.getOrCreateMemberRecord(getter).indexedPropertySteps = {
      getSupportedPropertyIndices() {
        return values.get(this)?.keys() ?? [];
      },
      unsupportedValue: undefined,
    };
    interfaceBinding.getOrCreateMemberRecord(getter).operationSteps = function(receiver, index) {
      return values.get(receiver!.implInst)?.[index as number];
    };
    interfaceBinding.getOrCreateMemberRecord(length).attributeSteps = {
      get(receiver) { return values.get(receiver!.implInst)?.length ?? 0; },
    };
    const Interface = getInstalledInterface(binding.install(), 'ReadOnlyIndexed');
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

    const { binding } = createBinding(interfaceIDL);
    const interfaceBinding = binding.getDefinitionBinding(interfaceIDL);
    interfaceBinding.getOrCreateMemberRecord(constructor).constructorBehavior = {
      kind: 'initialize',
      steps: function() {
        values.set(this, new Map([[0, 1]]));
      },
    };
    interfaceBinding.getOrCreateMemberRecord(getter).indexedPropertySteps = {
      getSupportedPropertyIndices() {
        return values.get(this)?.keys() ?? [];
      },
      supportsIndex(index) {
        return values.get(this)?.has(index) ?? false;
      },
    };
    interfaceBinding.getOrCreateMemberRecord(getter).operationSteps = function(receiver, index) {
      return values.get(receiver!.implInst)?.get(index as number);
    };
    interfaceBinding.getOrCreateMemberRecord(setter).operationSteps = function(receiver, index, value) {
      values.get(receiver!.implInst)?.set(index as number, value as number);
    };
    const Interface = getInstalledInterface(binding.install(), 'WritableIndexed');
    const object = construct(Interface);
    const implementation = getImplementationObject(object);
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

    const { binding } = createBinding(interfaceIDL);
    const interfaceBinding = binding.getDefinitionBinding(interfaceIDL);
    interfaceBinding.getOrCreateMemberRecord(constructor).constructorBehavior = {
      kind: 'initialize',
      steps: function() {
        values.set(this, new Map([[0, 'initial']]));
      },
    };
    interfaceBinding.getOrCreateMemberRecord(getter).operationSteps = function(receiver, index) {
      return values.get(receiver!.implInst)?.get(index as number);
    };
    interfaceBinding.getOrCreateMemberRecord(getter).indexedPropertySteps = {
      getSupportedPropertyIndices() {
        return values.get(this)?.keys() ?? [];
      },
      unsupportedValue: undefined,
      setExisting(index, value) {
        invocations.push(`existing:${String(index)}`);
        values.get(this)?.set(index, value as string);
      },
      setNew(index, value) {
        invocations.push(`new:${String(index)}`);
        values.get(this)?.set(index, value as string);
      },
    };
    const object = construct(getInstalledInterface(binding.install(), 'AnonymousIndexed'));

    expect(Reflect.set(object, '0', 'updated')).toBe(true);
    expect(Reflect.set(object, '1', 'created')).toBe(true);
    expect(invocations).toEqual(['existing:0', 'new:1']);
    expect(Reflect.get(object, '0')).toBe('updated');
    expect(Reflect.get(object, '1')).toBe('created');
  });

  it('uses the indexed operations from the derived-most interface', () => {
    class IndexedBaseImpl {}
    class IndexedDerivedImpl extends IndexedBaseImpl {}
    const baseGetter = indexedGetter('baseItem', idlType.DOMString);
    const derivedGetter = indexedGetter('derivedItem', idlType.DOMString);
    const constructor = constructorMember();
    const base = legacyInterface('IndexedBase', [baseGetter]);
    const derived = defineInterface({
      name: 'IndexedDerived',
      inherits: 'IndexedBase',
      exposed: '*',
      members: [constructor, derivedGetter],
    });

    const binding = new RealmBinding(
      new DefinitionAssembly([derived, base]),
      new Realm(),
      new BindingWorld([]),
    );
    const interfaceBinding = binding.getDefinitionBinding(derived);
    interfaceBinding.createImplementation = () => new IndexedDerivedImpl();
    interfaceBinding.getOrCreateMemberRecord(constructor).constructorBehavior = {
      kind: 'initialize',
      steps: () => undefined,
    };
    binding.getDefinitionBinding(base).getOrCreateMemberRecord(baseGetter).indexedPropertySteps = {
      getSupportedPropertyIndices: () => [0],
      supportsIndex: (index) => index === 0,
    };
    interfaceBinding.getOrCreateMemberRecord(derivedGetter).indexedPropertySteps = {
      getSupportedPropertyIndices: () => [1],
      supportsIndex: (index) => index === 1,
    };
    binding.getDefinitionBinding(base).getOrCreateMemberRecord(baseGetter).operationSteps = () => 'base';
    interfaceBinding.getOrCreateMemberRecord(derivedGetter).operationSteps = () => 'derived';
    const object = construct(getInstalledInterface(binding.install(), 'IndexedDerived'));

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

    const { binding } = createBinding(interfaceIDL);
    const interfaceBinding = binding.getDefinitionBinding(interfaceIDL);
    interfaceBinding.getOrCreateMemberRecord(constructor).constructorBehavior = {
      kind: 'initialize',
      steps: function() {
        values.set(this, new Map([
          ['alpha', 'named alpha'],
          ['length', 'named length'],
          ['toString', 'named toString'],
        ]));
      },
    };
    interfaceBinding.getOrCreateMemberRecord(getter).namedPropertySteps = {
      getSupportedPropertyNames() {
        return new Set(values.get(this)?.keys());
      },
    };
    interfaceBinding.getOrCreateMemberRecord(getter).operationSteps = function(receiver, name) {
      return values.get(receiver!.implInst)?.get(name as string);
    };
    interfaceBinding.getOrCreateMemberRecord(length).attributeSteps = {
      get(receiver) { return values.get(receiver!.implInst)?.size ?? 0; },
    };
    const Interface = getInstalledInterface(binding.install(), 'ReadOnlyNamed');
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
      name: 'Window',
      exposed: ['Window'],
      extendedAttributes: [{
        kind: 'identifier', name: 'Global', value: 'Window',
      }],
      members: [globalGetter],
    });
    const legacy = legacyInterface(
      'LegacyNamed',
      [constructor, legacyGetter],
    );
    class LegacyNamedImpl {}

    const definitions = new DefinitionAssembly([window, legacy]);
    const globalBinding = new RealmBinding(
      definitions,
      new Realm({ globalNames: ['Window'] }),
      new BindingWorld([]),
    );
    const globalBindingInterfaceBinding = globalBinding.getDefinitionBinding(legacy);
    globalBindingInterfaceBinding.createImplementation = () => new LegacyNamedImpl();
    globalBindingInterfaceBinding.getOrCreateMemberRecord(constructor).constructorBehavior = {
      kind: 'initialize',
      steps: () => undefined,
    };
    globalBinding.getDefinitionBinding(window).getOrCreateMemberRecord(globalGetter).namedPropertySteps = {
      getSupportedPropertyNames: () => new Set(['shared']),
    };
    globalBindingInterfaceBinding.getOrCreateMemberRecord(legacyGetter).namedPropertySteps = {
      getSupportedPropertyNames: () => new Set(['shared']),
    };
    globalBinding.getDefinitionBinding(window).getOrCreateMemberRecord(globalGetter).operationSteps = () => 'global';
    globalBindingInterfaceBinding.getOrCreateMemberRecord(legacyGetter).operationSteps = () => 'legacy';
    const legacyBinding = new RealmBinding(
      definitions,
      new Realm({ globalNames: ['Window'] }),
      new BindingWorld([]),
    );
    const legacyBindingInterfaceBinding = legacyBinding.getDefinitionBinding(legacy);
    legacyBindingInterfaceBinding.createImplementation = () => new LegacyNamedImpl();
    legacyBindingInterfaceBinding.getOrCreateMemberRecord(constructor).constructorBehavior = {
      kind: 'initialize',
      steps: () => undefined,
    };
    legacyBinding.getDefinitionBinding(window).getOrCreateMemberRecord(globalGetter).namedPropertySteps = {
      getSupportedPropertyNames: () => new Set(['shared']),
    };
    legacyBindingInterfaceBinding.getOrCreateMemberRecord(legacyGetter).namedPropertySteps = {
      getSupportedPropertyNames: () => new Set(['shared']),
    };
    legacyBinding.getDefinitionBinding(window).getOrCreateMemberRecord(globalGetter).operationSteps = () => 'global';
    legacyBindingInterfaceBinding.getOrCreateMemberRecord(legacyGetter).operationSteps = () => 'legacy';
    const global = globalBinding.projectGlobalObject(
      {},
      globalBinding.resolveInterface('Window'),
    ).platformObject!;
    const globalPrototype = Reflect.getPrototypeOf(global);
    const namedProperties = globalPrototype &&
      Reflect.getPrototypeOf(globalPrototype);
    if (!namedProperties) throw new Error('Missing named properties object');

    const object = construct(getInstalledInterface(legacyBinding.install(), 'LegacyNamed'));
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
      name: 'OverridingNamed',
      exposed: '*',
      extendedAttributes: [
        noArguments('LegacyOverrideBuiltIns'),
        noArguments('LegacyUnenumerableNamedProperties'),
      ],
      members: [constructor, getter, setter, deleter, length, fixed],
    });
    const values = new WeakMap<object, Map<string, unknown>>();

    const { binding } = createBinding(interfaceIDL);
    const interfaceBinding = binding.getDefinitionBinding(interfaceIDL);
    interfaceBinding.getOrCreateMemberRecord(constructor).constructorBehavior = {
      kind: 'initialize',
      steps: function() {
        values.set(this, new Map([
          ['alpha', 'named alpha'],
          ['length', 'named length'],
          ['toString', 'named toString'],
          ['fixed', 'named fixed'],
          ['locked', 'locked'],
        ]));
      },
    };
    interfaceBinding.getOrCreateMemberRecord(getter).namedPropertySteps = {
      getSupportedPropertyNames() {
        return new Set(values.get(this)?.keys());
      },
    };
    interfaceBinding.getOrCreateMemberRecord(getter).operationSteps = function(receiver, name) {
      return values.get(receiver!.implInst)?.get(name as string);
    };
    interfaceBinding.getOrCreateMemberRecord(setter).operationSteps = function(receiver, name, value) {
      values.get(receiver!.implInst)?.set(name as string, value);
    };
    interfaceBinding.getOrCreateMemberRecord(deleter).operationSteps = function(receiver, name) {
      if (name === 'locked') return false;
      return values.get(receiver!.implInst)?.delete(name as string) ?? false;
    };
    interfaceBinding.getOrCreateMemberRecord(length).attributeSteps = { get: () => 5 };
    interfaceBinding.getOrCreateMemberRecord(fixed).attributeSteps = { get: () => 'fixed attribute' };
    const Interface = getInstalledInterface(binding.install(), 'OverridingNamed');
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

    const { binding } = createBinding(interfaceIDL);
    const interfaceBinding = binding.getDefinitionBinding(interfaceIDL);
    interfaceBinding.getOrCreateMemberRecord(constructor).constructorBehavior = {
      kind: 'initialize',
      steps: () => undefined,
    };
    interfaceBinding.getOrCreateMemberRecord(getter).namedPropertySteps = {
      getSupportedPropertyNames: () => new Set(['toString']),
    };
    interfaceBinding.getOrCreateMemberRecord(getter).operationSteps = () => 'named';
    interfaceBinding.getOrCreateMemberRecord(stringifier).stringificationBehavior = () => 'stringified';
    const object = construct(getInstalledInterface(binding.install(), 'StringifyingNamed'));
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

    const { binding } = createBinding(interfaceIDL);
    const interfaceBinding = binding.getDefinitionBinding(interfaceIDL);
    interfaceBinding.getOrCreateMemberRecord(constructor).constructorBehavior = {
      kind: 'initialize',
      steps: function() {
        values.set(this, new Map([['existing', 'initial']]));
      },
    };
    interfaceBinding.getOrCreateMemberRecord(getter).operationSteps = function(receiver, name) {
      return values.get(receiver!.implInst)?.get(name as string);
    };
    interfaceBinding.getOrCreateMemberRecord(getter).namedPropertySteps = {
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
    };
    const object = construct(getInstalledInterface(binding.install(), 'AnonymousNamed'));

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

    const { binding } = createBinding(interfaceIDL);
    const interfaceBinding = binding.getDefinitionBinding(interfaceIDL);
    interfaceBinding.getOrCreateMemberRecord(constructor).constructorBehavior = {
      kind: 'initialize',
      steps: function() {
        indices.set(this, new Map([[0, 'indexed zero']]));
        names.set(this, new Map([
          ['0', 'named zero'], ['1', 'named one'], ['alpha', 'named alpha'],
        ]));
      },
    };
    interfaceBinding.getOrCreateMemberRecord(indexGetter).indexedPropertySteps = {
      getSupportedPropertyIndices() {
        return indices.get(this)?.keys() ?? [];
      },
      supportsIndex(index) {
        return indices.get(this)?.has(index) ?? false;
      },
    };
    interfaceBinding.getOrCreateMemberRecord(nameGetter).namedPropertySteps = {
      getSupportedPropertyNames() {
        return new Set(names.get(this)?.keys());
      },
    };
    interfaceBinding.getOrCreateMemberRecord(indexGetter).operationSteps = function(receiver, index) {
      return indices.get(receiver!.implInst)?.get(index as number);
    };
    interfaceBinding.getOrCreateMemberRecord(indexSetter).operationSteps = function(receiver, index, value) {
      indices.get(receiver!.implInst)?.set(index as number, value as string);
    };
    interfaceBinding.getOrCreateMemberRecord(nameGetter).operationSteps = function(receiver, name) {
      return names.get(receiver!.implInst)?.get(name as string);
    };
    interfaceBinding.getOrCreateMemberRecord(nameSetter).operationSteps = function(receiver, name, value) {
      names.get(receiver!.implInst)?.set(name as string, value as string);
    };
    const Interface = getInstalledInterface(binding.install(), 'IndexedAndNamed');
    const object = construct(Interface);
    const other = construct(Interface);

    expect(Reflect.get(object, '0')).toBe('indexed zero');
    expect(Reflect.get(object, '1')).toBeUndefined();
    expect(Reflect.get(object, 'alpha')).toBe('named alpha');
    expect(Reflect.set(object, '1', 'new index')).toBe(true);
    expect(Reflect.get(object, '1')).toBe('new index');
    expect(Reflect.ownKeys(object)).toEqual(['0', '1', 'alpha']);

    expect(Reflect.set(object, 'beta', 'new name')).toBe(true);
    expect(Reflect.get(object, 'beta')).toBe('new name');
    expect(Reflect.ownKeys(object)).toEqual(['0', '1', 'alpha', 'beta']);
    expect(Reflect.get(other, '1')).toBeUndefined();
    expect(Reflect.has(other, 'beta')).toBe(false);
    expect(Object.keys(other)).toEqual(['0', 'alpha']);

    expect(Reflect.set(other, '2', 'other index')).toBe(true);
    expect(Object.keys(other)).toEqual(['0', '2', 'alpha']);
    expect(Reflect.has(object, '2')).toBe(false);
  });

  it('uses each realm\'s registered property steps for shared declarations', () => {
    class SharedLegacyImpl {}
    const constructor = constructorMember();
    const indexGetter = indexedGetter('item', idlType.DOMString);
    const nameGetter = namedGetter('namedItem', idlType.DOMString);
    const interfaceIDL = legacyInterface('SharedLegacy', [constructor, indexGetter, nameGetter]);
    const definitions = new DefinitionAssembly([interfaceIDL]);
    const objects = ['first', 'second'].map((name, index) => {
      const binding = new RealmBinding(definitions, new Realm(), new BindingWorld([]));
      const interfaceBinding = binding.getDefinitionBinding(interfaceIDL);
      interfaceBinding.createImplementation = () => new SharedLegacyImpl();
      interfaceBinding.getOrCreateMemberRecord(constructor).constructorBehavior = {
        kind: 'initialize', steps: () => undefined,
      };
      interfaceBinding.getOrCreateMemberRecord(indexGetter).indexedPropertySteps = {
        getSupportedPropertyIndices: () => [index],
        supportsIndex: (candidate) => candidate === index,
      };
      interfaceBinding.getOrCreateMemberRecord(nameGetter).namedPropertySteps = {
        getSupportedPropertyNames: () => new Set([name]),
      };
      interfaceBinding.getOrCreateMemberRecord(indexGetter).operationSteps = () => name;
      interfaceBinding.getOrCreateMemberRecord(nameGetter).operationSteps = () => name;
      return construct(getInstalledInterface(binding.install(), 'SharedLegacy'));
    });

    expect(Reflect.ownKeys(objects[0]!)).toEqual(['0', 'first']);
    expect(Reflect.get(objects[0]!, '0')).toBe('first');
    expect(Reflect.get(objects[0]!, 'first')).toBe('first');
    expect(Reflect.ownKeys(objects[1]!)).toEqual(['1', 'second']);
    expect(Reflect.get(objects[1]!, '1')).toBe('second');
    expect(Reflect.get(objects[1]!, 'second')).toBe('second');
  });
});

function legacyInterface(
  name: string,
  members: InterfaceDefinition['members'],
): InterfaceDefinition {
  return defineInterface({ name, exposed: '*', members });
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
): { binding: RealmBinding; realm: Realm; } {
  class LegacyCollectionImpl {}
  const realm = new Realm();
  const binding = new RealmBinding(
    new DefinitionAssembly([interfaceIDL]), realm, new BindingWorld([]),
  );
  binding.getDefinitionBinding(interfaceIDL).createImplementation = () => new LegacyCollectionImpl();
  return { binding, realm };
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
