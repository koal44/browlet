import { describe, expect, it } from 'vitest';

import { Realm } from '../../../src/browlet/realm';
import { assembleDefinitions } from '../../../src/web-idl/assembly';
import { webIDLCommonDefinitions } from '../../../src/web-idl/common-definitions';
import {
  convertToIDL, convertToJavaScript,
} from '../../../src/web-idl/conversion';
import {
  defineEnumeration, defineIncludes, defineInterface, defineInterfaceMixin,
  definePartialInterface, frozenArray, idlType, integer, reference,
  type AttributeMember, type ConstructorMember, type OperationMember,
} from '../../../src/web-idl/definition';
import { ImplementationRegistry } from '../../../src/web-idl/implementation';
import { JavaScriptBinding } from '../../../src/web-idl/binding';
import type { SecurityCheckType } from '../../../src/web-idl/javascript-realm';
import { PlatformObjectRegistry } from '../../../src/web-idl/platform-object';

describe('Web IDL ordinary interface projection', () => {
  it('projects constructors, inheritance, fragments, members, and descriptors', () => {
    const constructor = constructorMember([
      { name: 'value', type: idlType.long },
    ]);
    const value = attributeMember('value', idlType.long);
    const describeNumber = operationMember(
      'describe',
      [{ name: 'value', type: idlType.long }],
      idlType.DOMString,
    );
    const describeString = operationMember(
      'describe',
      [{ name: 'value', type: idlType.DOMString }],
      idlType.DOMString,
    );
    const partialOperation = operationMember(
      'fromPartial',
      [],
      idlType.DOMString,
    );
    const mixinOperation = operationMember(
      'fromMixin',
      [],
      idlType.DOMString,
    );
    const staticOperation = {
      ...operationMember('makeLabel', [], idlType.DOMString),
      static: true,
    } satisfies OperationMember;
    const staticAttribute = {
      ...attributeMember('version', idlType.DOMString, true),
      static: true,
    } satisfies AttributeMember;
    const base = defineInterface({
      exposed: ['Window'],
      members: [{
        kind: 'constant', name: 'BASE', type: idlType.long, value: integer(1),
      }],
      name: 'ProjectionBase',
    });
    const derived = defineInterface({
      exposed: ['Window'],
      inherits: 'ProjectionBase',
      members: [
        constructor,
        { kind: 'constant', name: 'ANSWER', type: idlType.long, value: integer(42) },
        value,
        describeNumber,
        describeString,
        staticAttribute,
        staticOperation,
      ],
      name: 'ProjectionDerived',
    });
    const partial = definePartialInterface({
      members: [partialOperation],
      name: 'ProjectionDerived',
    });
    const mixin = defineInterfaceMixin({
      members: [mixinOperation],
      name: 'ProjectionMixin',
    });
    const include = defineIncludes({
      interface: 'ProjectionDerived',
      mixin: 'ProjectionMixin',
    });
    const state = new WeakMap<object, number>();
    const implementations = new ImplementationRegistry();
    implementations.setConstructorSteps(constructor, function(value_) {
      state.set(this, value_ as number);
    });
    implementations.setAttributeSteps(value, {
      get() { return state.get(this as object) ?? 0; },
      set(value_) { state.set(this as object, value_ as number); },
    });
    implementations.setOperationSteps(describeNumber, function(value_) {
      return `number:${String(value_)}`;
    });
    implementations.setOperationSteps(describeString, function(value_) {
      return `string:${String(value_)}`;
    });
    implementations.setOperationSteps(partialOperation, () => 'partial');
    implementations.setOperationSteps(mixinOperation, () => 'mixin');
    implementations.setOperationSteps(staticOperation, () => 'static');
    implementations.setAttributeSteps(staticAttribute, {
      get() { return '1.0'; },
    });

    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([partial, include, derived, mixin, base]),
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
    const installed = binding.install();
    const Base = binding.getInterfaceObject('ProjectionBase');
    const Derived = binding.getInterfaceObject('ProjectionDerived');

    const instance = construct(Derived, [4.8]);
    const prototype = Derived.prototype;

    expect(installed.get('ProjectionBase')).toBe(Base);
    expect(installed.get('ProjectionDerived')).toBe(Derived);
    expect(Derived).toBeInstanceOf(realm.intrinsics.function);
    expect(Derived).not.toBeInstanceOf(Function);
    expect(prototype).toBeInstanceOf(realm.intrinsics.object);
    expect(prototype).not.toBeInstanceOf(Object);
    expect(Object.getPrototypeOf(Derived)).toBe(Base);
    expect(Object.getPrototypeOf(prototype)).toBe(Base.prototype);
    expect(Object.getPrototypeOf(instance)).toBe(prototype);
    expect(Reflect.get(instance, 'value')).toBe(4);
    expect(Reflect.set(instance, 'value', 8.9)).toBe(true);
    expect(Reflect.get(instance, 'value')).toBe(8);
    expect(call(prototype, 'describe', instance, 5.9)).toBe('number:5');
    expect(call(prototype, 'describe', instance, 'five')).toBe('string:five');
    expect(call(prototype, 'fromPartial', instance)).toBe('partial');
    expect(call(prototype, 'fromMixin', instance)).toBe('mixin');
    expect(call(Derived, 'makeLabel', null)).toBe('static');
    expect(Reflect.get(Derived, 'version')).toBe('1.0');
    expect(Object.hasOwn(prototype, 'version')).toBe(false);
    expect(Reflect.get(Derived, 'ANSWER')).toBe(42);
    expect(Reflect.get(prototype, 'ANSWER')).toBe(42);
    expect(Reflect.get(Derived, 'BASE')).toBe(1);
    expect(Object.getOwnPropertyDescriptor(Derived, 'prototype')).toEqual({
      configurable: false,
      enumerable: false,
      value: prototype,
      writable: false,
    });
    expect(Object.getOwnPropertyDescriptor(prototype, 'describe'))
      .toMatchObject({ configurable: true, enumerable: true, writable: true });
    const describe = Reflect.get(prototype, 'describe') as unknown;
    if (typeof describe !== 'function') throw new Error('Missing describe');
    expect({ length: describe.length, name: describe.name }).toEqual({
      length: 1, name: 'describe',
    });
  });

  it('brands receivers across realms and performs the security-check callsite', () => {
    const constructor = constructorMember([]);
    const operation = operationMember('read', [], idlType.DOMString);
    const interfaceIDL = defineInterface({
      exposed: '*',
      members: [constructor, operation],
      name: 'CrossRealmInterface',
    });
    const definitions = assembleDefinitions([interfaceIDL]);
    const implementations = new ImplementationRegistry();
    implementations.setConstructorSteps(constructor, () => undefined);
    implementations.setOperationSteps(operation, () => 'ok');
    const platformObjects = new PlatformObjectRegistry();
    const firstRealm = new RecordingRealm();
    const secondRealm = new RecordingRealm();
    const first = new JavaScriptBinding(
      definitions,
      firstRealm,
      platformObjects,
      implementations,
    );
    const second = new JavaScriptBinding(
      definitions,
      secondRealm,
      platformObjects,
      implementations,
    );
    const First = first.getInterfaceObject('CrossRealmInterface');
    const Second = second.getInterfaceObject('CrossRealmInterface');
    const foreignObject = construct(Second, []);
    const firstPrototype = First.prototype;

    expect(call(firstPrototype, 'read', foreignObject)).toBe('ok');
    expect(firstRealm.checks).toEqual([{
      identifier: 'read',
      object: foreignObject,
      type: 'method',
    }]);
    expect(() => call(firstPrototype, 'read', {}, [])).toThrow(
      firstRealm.intrinsics.typeError,
    );
  });

  it('keeps platform identity separate from private implementation state', () => {
    const read = operationMember('read', [], idlType.long);
    const echo = operationMember(
      'echo',
      [{ name: 'value', type: reference('SeparatedIdentity') }],
      reference('SeparatedIdentity'),
    );
    const interfaceIDL = defineInterface({
      exposed: '*',
      members: [read, echo],
      name: 'SeparatedIdentity',
    });
    const definitions = assembleDefinitions([interfaceIDL]);
    const interface_ = definitions.getInterface('SeparatedIdentity');
    if (!interface_) throw new Error('Missing assembled interface');

    const implementation = new PrivateStateImplementation(42);
    const implementations = new ImplementationRegistry();
    implementations.setOperationSteps(read, function() {
      return PrivateStateImplementation.read(
        this as PrivateStateImplementation,
      );
    });
    implementations.setOperationSteps(echo, function(value) {
      expect(this).toBe(implementation);
      expect(value).toBe(implementation);
      return value;
    });

    const realm = new RecordingRealm();
    const binding = new JavaScriptBinding(
      definitions,
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
    const prototype = binding.getInterfacePrototypeObject(interface_);
    Object.setPrototypeOf(implementation, prototype);
    const object = new Proxy(implementation, {});
    const record = binding.associatePlatformObject(
      object,
      interface_,
      implementation,
    );

    expect(binding.isPlatformObject(object)).toBe(true);
    expect(binding.isPlatformObject(implementation)).toBe(false);
    expect(record.object).toBe(object);
    expect(record.implementation).toBe(implementation);
    expect(call(prototype, 'read', object)).toBe(42);
    expect(call(prototype, 'echo', object, object)).toBe(object);
    expect(convertToIDL(
      object,
      reference('SeparatedIdentity'),
      binding,
    )).toBe(implementation);
    expect(convertToJavaScript(
      implementation,
      reference('SeparatedIdentity'),
      binding,
    )).toBe(object);
    expect(realm.checks.map(({ object: checked }) => checked)).toEqual([
      object,
      object,
    ]);
  });

  it('runs the default toJSON operation over exposed JSON attributes', () => {
    const constructor = constructorMember([]);
    const inheritedValue = attributeMember('inheritedValue', idlType.long);
    const ownValue = attributeMember('ownValue', idlType.DOMString);
    const nonJSONValue = attributeMember('nonJSONValue', idlType.symbol);
    const baseToJSON = {
      ...operationMember('toJSON', [], idlType.object),
      extendedAttributes: [noArguments('Default')],
    } satisfies OperationMember;
    const derivedToJSON = {
      ...operationMember('toJSON', [], idlType.object),
      extendedAttributes: [noArguments('Default')],
    } satisfies OperationMember;
    const base = defineInterface({
      exposed: '*',
      members: [inheritedValue, baseToJSON],
      name: 'JSONBase',
    });
    const derived = defineInterface({
      exposed: '*',
      inherits: 'JSONBase',
      members: [constructor, ownValue, nonJSONValue, derivedToJSON],
      name: 'JSONDerived',
    });
    const implementations = new ImplementationRegistry();
    implementations.setConstructorSteps(constructor, () => undefined);
    implementations.setAttributeSteps(inheritedValue, {
      get() { return 12; },
    });
    implementations.setAttributeSteps(ownValue, {
      get() { return 'value'; },
    });
    implementations.setAttributeSteps(nonJSONValue, {
      get() { return Symbol('not JSON'); },
    });
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([derived, base]),
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
    const Interface = binding.getInterfaceObject('JSONDerived');
    const object = construct(Interface, []);
    const json = call(Interface.prototype, 'toJSON', object);

    expect(json).toBeInstanceOf(realm.intrinsics.object);
    expect(json).toEqual({ inheritedValue: 12, ownValue: 'value' });
    expect(Reflect.ownKeys(json as object)).not.toContain('nonJSONValue');
  });

  it('converts frozen array attributes once and returns them by identity', () => {
    const constructor = constructorMember([]);
    const values = attributeMember(
      'values',
      frozenArray(idlType.long),
    );
    const interfaceIDL = defineInterface({
      exposed: '*',
      members: [constructor, values],
      name: 'FrozenArrayInterface',
    });
    const realm = new Realm();
    const state = new WeakMap<object, readonly unknown[]>();
    const implementations = new ImplementationRegistry();
    implementations.setConstructorSteps(constructor, function() {
      state.set(this, Object.freeze(new realm.intrinsics.array()));
    });
    implementations.setAttributeSteps(values, {
      get() { return state.get(this as object); },
      set(value) { state.set(this as object, value as readonly unknown[]); },
    });
    const binding = new JavaScriptBinding(
      assembleDefinitions([interfaceIDL]),
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
    const Interface = binding.getInterfaceObject('FrozenArrayInterface');
    const object = construct(Interface, []);
    const source = Object.freeze(['1', 2]);

    expect(Reflect.set(object, 'values', source)).toBe(true);
    const first: unknown = Reflect.get(object, 'values');
    const second: unknown = Reflect.get(object, 'values');
    if (!Array.isArray(first)) throw new Error('FrozenArray getter failed');
    expect(first).toEqual([1, 2]);
    expect(first).toBe(second);
    expect(first).not.toBe(source);
    expect(first).toBeInstanceOf(realm.intrinsics.array);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('converts BufferSource operation arguments and results by identity', () => {
    const constructor = constructorMember([]);
    const echo = operationMember(
      'echo',
      [{ name: 'source', type: reference('BufferSource') }],
      reference('BufferSource'),
    );
    const interfaceIDL = defineInterface({
      exposed: '*',
      members: [constructor, echo],
      name: 'BufferSourceInterface',
    });
    const implementations = new ImplementationRegistry();
    implementations.setConstructorSteps(constructor, () => undefined);
    implementations.setOperationSteps(echo, (source) => source);
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([...webIDLCommonDefinitions, interfaceIDL]),
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
    const Interface = binding.getInterfaceObject('BufferSourceInterface');
    const object = construct(Interface, []);
    const view = new Uint8Array([1, 2]);

    expect(call(Interface.prototype, 'echo', object, view)).toBe(view);
    expect(() => call(
      Interface.prototype,
      'echo',
      object,
      new SharedArrayBuffer(2),
    )).toThrow(realm.intrinsics.typeError);
  });

  it('implements applicable member extended attributes', () => {
    const constructor = constructorMember([]);
    const unforgeable = {
      ...attributeMember('trusted', idlType.boolean, true),
      extendedAttributes: [noArguments('LegacyUnforgeable')],
    } satisfies AttributeMember;
    const replaceable = {
      ...attributeMember('replaceable', idlType.DOMString, true),
      extendedAttributes: [noArguments('Replaceable')],
    } satisfies AttributeMember;
    const forwards = {
      ...attributeMember('forwarded', idlType.object, true),
      extendedAttributes: [{
        kind: 'identifier', name: 'PutForwards', value: 'value',
      }],
    } satisfies AttributeMember;
    const choice = attributeMember('choice', reference('Choice'));
    const fixed = {
      ...operationMember('fixed', [], idlType.DOMString),
      extendedAttributes: [noArguments('LegacyUnforgeable')],
    } satisfies OperationMember;
    const scoped = {
      ...operationMember('scoped', [], idlType.undefined),
      extendedAttributes: [noArguments('Unscopable')],
    } satisfies OperationMember;
    const enumeration = defineEnumeration({
      name: 'Choice',
      values: ['first', 'second'],
    });
    const interfaceIDL = defineInterface({
      exposed: '*',
      members: [constructor, unforgeable, replaceable, forwards, choice, fixed, scoped],
      name: 'ExtendedInterface',
    });
    const forwarded = { value: '' };
    const choices = new WeakMap<object, string>();
    const implementations = new ImplementationRegistry();
    implementations.setConstructorSteps(constructor, function() {
      choices.set(this, 'first');
    });
    implementations.setAttributeSteps(unforgeable, {
      get() { return true; },
    });
    implementations.setAttributeSteps(replaceable, {
      get() { return 'original'; },
    });
    implementations.setAttributeSteps(forwards, {
      get() { return forwarded; },
    });
    implementations.setAttributeSteps(choice, {
      get() { return choices.get(this as object) ?? 'first'; },
      set(value) { choices.set(this as object, value as string); },
    });
    implementations.setOperationSteps(fixed, () => 'fixed');
    implementations.setOperationSteps(scoped, () => undefined);
    const binding = new JavaScriptBinding(
      assembleDefinitions([enumeration, interfaceIDL]),
      new Realm(),
      new PlatformObjectRegistry(),
      implementations,
    );
    const Interface = binding.getInterfaceObject('ExtendedInterface');
    const prototype = Interface.prototype;
    const first = construct(Interface, []);
    const second = construct(Interface, []);

    const firstTrusted = Object.getOwnPropertyDescriptor(first, 'trusted');
    const secondTrusted = Object.getOwnPropertyDescriptor(second, 'trusted');
    expect(firstTrusted).toMatchObject({
      configurable: false,
      enumerable: true,
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- comparing accessor identities without invoking either function
    expect(firstTrusted?.get).toBe(secondTrusted?.get);
    expect(Object.hasOwn(prototype, 'trusted')).toBe(false);
    expect(Object.getOwnPropertyDescriptor(first, 'fixed')).toMatchObject({
      configurable: false,
      enumerable: true,
      writable: false,
    });
    expect(Object.hasOwn(prototype, 'fixed')).toBe(false);

    expect(Reflect.get(first, 'replaceable')).toBe('original');
    expect(Reflect.set(first, 'replaceable', 'shadow')).toBe(true);
    expect(Reflect.get(first, 'replaceable')).toBe('shadow');
    expect(Object.hasOwn(first, 'replaceable')).toBe(true);
    expect(Reflect.set(first, 'forwarded', 'forwarded value')).toBe(true);
    expect(forwarded.value).toBe('forwarded value');

    expect(Reflect.set(first, 'choice', 'second')).toBe(true);
    expect(Reflect.get(first, 'choice')).toBe('second');
    expect(Reflect.set(first, 'choice', 'invalid')).toBe(true);
    expect(Reflect.get(first, 'choice')).toBe('second');
    expect(Reflect.get(prototype, Symbol.unscopables)).toMatchObject({
      scoped: true,
    });
  });

  it('filters interfaces, fragments, mixins, and members by exposure', () => {
    const normal = operationMember('normal', [], idlType.undefined);
    const secureMember = {
      ...operationMember('secureMember', [], idlType.undefined),
      extendedAttributes: [noArguments('SecureContext')],
    } satisfies OperationMember;
    const partialMember = operationMember('partialMember', [], idlType.undefined);
    const mixinMember = operationMember('mixinMember', [], idlType.undefined);
    const interfaceIDL = defineInterface({
      exposed: ['Window'],
      members: [normal, secureMember],
      name: 'ExposedInterface',
    });
    const secureInterface = defineInterface({
      exposed: ['Window'],
      extendedAttributes: [noArguments('SecureContext')],
      members: [],
      name: 'SecureInterface',
    });
    const isolatedInterface = defineInterface({
      exposed: ['Window'],
      extendedAttributes: [noArguments('CrossOriginIsolated')],
      members: [],
      name: 'IsolatedInterface',
    });
    const workerInterface = defineInterface({
      exposed: ['Worker'],
      members: [],
      name: 'WorkerInterface',
    });
    const partial = definePartialInterface({
      extendedAttributes: [noArguments('SecureContext')],
      members: [partialMember],
      name: 'ExposedInterface',
    });
    const mixin = defineInterfaceMixin({
      extendedAttributes: [noArguments('SecureContext')],
      members: [mixinMember],
      name: 'SecureMixin',
    });
    const include = defineIncludes({
      interface: 'ExposedInterface',
      mixin: 'SecureMixin',
    });
    const definitions = assembleDefinitions([
      interfaceIDL,
      secureInterface,
      isolatedInterface,
      workerInterface,
      partial,
      mixin,
      include,
    ]);

    const insecure = new JavaScriptBinding(
      definitions,
      new Realm(),
      new PlatformObjectRegistry(),
    );
    const insecureInstalled = insecure.install();
    const insecurePrototype = getPrototype(
      requireInstalled(insecureInstalled, 'ExposedInterface'),
    );

    expect([...insecureInstalled.keys()]).toEqual(['ExposedInterface']);
    expect(Reflect.ownKeys(insecurePrototype)).toContain('normal');
    expect(Reflect.ownKeys(insecurePrototype)).not.toContain('secureMember');
    expect(Reflect.ownKeys(insecurePrototype)).not.toContain('partialMember');
    expect(Reflect.ownKeys(insecurePrototype)).not.toContain('mixinMember');

    const privileged = new JavaScriptBinding(
      definitions,
      new Realm({ crossOriginIsolated: true, secureContext: true }),
      new PlatformObjectRegistry(),
    );
    const privilegedInstalled = privileged.install();
    const privilegedPrototype = getPrototype(
      requireInstalled(privilegedInstalled, 'ExposedInterface'),
    );

    expect([...privilegedInstalled.keys()]).toEqual([
      'ExposedInterface',
      'SecureInterface',
      'IsolatedInterface',
    ]);
    expect(Reflect.ownKeys(privilegedPrototype)).toEqual(expect.arrayContaining([
      'normal', 'secureMember', 'partialMember', 'mixinMember',
    ]));
  });
});

class RecordingRealm extends Realm {
  readonly checks: SecurityCheck[] = [];

  override performSecurityCheck(
    object: object,
    identifier: string,
    type: SecurityCheckType,
  ): void {
    this.checks.push({ identifier, object, type });
  }
}

class PrivateStateImplementation {
  #value: number;

  constructor(value: number) {
    this.#value = value;
  }

  static read(value: PrivateStateImplementation): number {
    return value.#value;
  }
}

type SecurityCheck = {
  identifier: string;
  object: object;
  type: SecurityCheckType;
};

function constructorMember(
  arguments_: ConstructorMember['arguments'],
): ConstructorMember {
  return { arguments: arguments_, kind: 'constructor' };
}

function attributeMember(
  name: string,
  type: AttributeMember['type'],
  readonly = false,
): AttributeMember {
  return { kind: 'attribute', name, readonly, type };
}

function operationMember(
  name: string,
  arguments_: OperationMember['arguments'],
  returns: OperationMember['returns'],
): OperationMember {
  return { arguments: arguments_, kind: 'operation', name, returns };
}

function noArguments(name: string) {
  return { kind: 'no-arguments', name } as const;
}

function call(
  target: object,
  name: PropertyKey,
  receiver: unknown,
  ...argumentsList: unknown[]
): unknown {
  const method = Reflect.get(target, name) as unknown;
  if (typeof method !== 'function') throw new Error(`${String(name)} is not callable`);
  return Reflect.apply(method, receiver, argumentsList);
}

function construct(target: object, argumentsList: unknown[]): object {
  if (typeof target !== 'function') throw new Error('Target is not callable');
  return Reflect.construct(
    target as unknown as new (...values: unknown[]) => object,
    argumentsList,
  );
}

function requireInstalled(
  installed: Map<string, object>,
  name: string,
): object {
  const object = installed.get(name);
  if (!object) throw new Error(`${name} was not installed`);
  return object;
}

function getPrototype(object: object): object {
  const prototype = Reflect.get(object, 'prototype') as unknown;
  if (prototype === null || typeof prototype !== 'object') {
    throw new Error('Interface has no prototype object');
  }
  return prototype;
}
