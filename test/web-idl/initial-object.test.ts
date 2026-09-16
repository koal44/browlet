import { describe, expect, it } from 'vitest';
import { TestRealm as Realm } from './test-realm';
import { assembleDefinitions } from '../../src/web-idl/assembly';
import { BindingWorld } from '../../src/web-idl/binding-world';
import { RealmBinding } from '../../src/web-idl/realm-binding';
import {
  defineInterface, definePartialInterface, idlType, type AttributeMember,
  type NamedArgumentsExtendedAttribute, type OperationMember,
  type StringifierMember,
} from '../../src/web-idl/core/index';
import { ImplementationRegistry } from '../../src/web-idl/implementation-registry';

describe('Web IDL initial objects', () => {
  it('uses an interface\'s overridden constructor steps', () => {
    const interfaceIDL = defineInterface({
      name: 'OverriddenConstructor',
      exposed: '*', members: [],
    });
    const implementations = new ImplementationRegistry();
    const realm = new Realm();
    const binding = new RealmBinding(
      assembleDefinitions([interfaceIDL]),
      realm,
      new BindingWorld([]),
      implementations,
    );
    implementations.setOverriddenConstructorSteps(
      interfaceIDL,
      (argumentsList, newTarget, activeFunction) => ({
        activeFunction,
        argumentsList,
        newTarget,
      }),
    );

    binding.install();
    const Interface = requireFunction(
      Reflect.get(realm.global, 'OverriddenConstructor'),
    );
    const Derived = class extends Interface {};

    expect(Reflect.apply(Interface, undefined, ['called'])).toEqual({
      activeFunction: Interface,
      argumentsList: ['called'],
      newTarget: undefined,
    });
    expect(Reflect.construct(Interface, ['constructed'], Derived)).toEqual({
      activeFunction: Interface,
      argumentsList: ['constructed'],
      newTarget: Derived,
    });
  });

  it('rejects calls and construction without a constructor operation', () => {
    const interfaceIDL = defineInterface({
      name: 'IllegalConstructor',
      exposed: '*', members: [],
    });
    const realm = new Realm();
    const binding = new RealmBinding(
      assembleDefinitions([interfaceIDL]),
      realm,
      new BindingWorld([]),
    );

    binding.install();
    const Interface = requireFunction(
      Reflect.get(realm.global, 'IllegalConstructor'),
    );

    expect(() => Reflect.apply(Interface, undefined, []))
      .toThrow(realm.intrinsics.typeError);
    expect(() => Reflect.construct(Interface, []))
      .toThrow(realm.intrinsics.typeError);
  });

  it('keeps a legacy-hidden interface prototype accessible through instances', () => {
    class HiddenImpl {}
    const interfaceIDL = defineInterface({
      name: 'HiddenInterface',
      exposed: '*',
      extendedAttributes: [{
        kind: 'no-arguments', name: 'LegacyNoInterfaceObject',
      }],
      members: [],
    });
    const implementations = new ImplementationRegistry();
    implementations.setImplementationCreationSteps(interfaceIDL, () => new HiddenImpl());
    const realm = new Realm();
    const binding = new RealmBinding(
      assembleDefinitions([interfaceIDL]),
      realm,
      new BindingWorld([]),
      implementations,
    );

    const installed = binding.install();
    const object = binding.createPlatformObject(binding.resolveInterface('HiddenInterface'));
    const prototype = Reflect.getPrototypeOf(object);

    expect(installed.has('HiddenInterface')).toBe(false);
    expect(Reflect.has(realm.global, 'HiddenInterface')).toBe(false);
    expect(prototype).toBe(
      binding.getInterfacePrototypeObject(binding.resolveInterface('HiddenInterface')),
    );
    expect(Object.hasOwn(prototype as object, 'constructor')).toBe(false);
    expect(Object.prototype.toString.call(prototype))
      .toBe('[object HiddenInterface]');
  });

  it('installs legacy window aliases only in Window realms', () => {
    const interfaceIDL = defineInterface({
      name: 'Widget',
      exposed: '*',
      extendedAttributes: [{
        kind: 'identifier-list',
        name: 'LegacyWindowAlias',
        values: ['LegacyWidget'],
      }],
      members: [],
    });
    const definitions = assembleDefinitions([interfaceIDL]);
    const windowRealm = new Realm({ globalNames: ['Window'] });
    const workerRealm = new Realm({ globalNames: ['Worker'] });
    const windowBinding = new RealmBinding(
      definitions,
      windowRealm,
      new BindingWorld([]),
    );
    const workerBinding = new RealmBinding(
      definitions,
      workerRealm,
      new BindingWorld([]),
    );

    windowBinding.install();
    workerBinding.install();

    expect(Reflect.get(windowRealm.global, 'LegacyWidget'))
      .toBe(Reflect.get(windowRealm.global, 'Widget'));
    expect(Reflect.has(workerRealm.global, 'LegacyWidget')).toBe(false);
  });

  it('creates legacy factory functions in the realm', () => {
    class WidgetImpl { value = 0; }
    const factory = legacyFactory('LegacyWidget', idlType.unsignedLong);
    const value: AttributeMember = {
      kind: 'attribute', name: 'value', type: idlType.unsignedLong, readonly: true,
    };
    const interfaceIDL = defineInterface({
      name: 'Widget',
      exposed: '*',
      extendedAttributes: [factory],
      members: [value],
    });
    const definitions = assembleDefinitions([interfaceIDL]);
    const implementations = new ImplementationRegistry();
    implementations.setImplementationCreationSteps(interfaceIDL, () => new WidgetImpl());
    implementations.setAttributeSteps(value, {
      get(receiver) { return Reflect.get(receiver!.implInst, 'value') as unknown; },
    });
    const realm = new Realm();
    const binding = new RealmBinding(
      definitions,
      realm,
      new BindingWorld([]),
      implementations,
    );
    implementations.setConstructorSteps(factory, function(value) {
      Reflect.set(this, 'value', value);
    });

    binding.install();
    const Widget = requireFunction(Reflect.get(realm.global, 'Widget'));
    const LegacyWidget = requireFunction(
      Reflect.get(realm.global, 'LegacyWidget'),
    );
    const object = Reflect.construct(LegacyWidget, [7]);

    expect(LegacyWidget).toBeInstanceOf(realm.intrinsics.function);
    expect({ length: LegacyWidget.length, name: LegacyWidget.name }).toEqual({
      length: 1,
      name: 'LegacyWidget',
    });
    expect(Reflect.getOwnPropertyDescriptor(LegacyWidget, 'prototype'))
      .toEqual({
        configurable: false,
        enumerable: false,
        value: Widget.prototype,
        writable: false,
      });
    expect(object).toBeInstanceOf(Widget);
    expect(object).toBeInstanceOf(LegacyWidget);
    expect(Reflect.get(object, 'value')).toBe(7);
    expect(() => {
      Reflect.apply(LegacyWidget, undefined, [7]);
    })
      .toThrow(realm.intrinsics.typeError);
  });

  it('includes legacy factory functions declared on partial interfaces', () => {
    class PartialWidgetImpl { value = ''; }
    const factory = legacyFactory('LegacyPartialWidget', idlType.DOMString);
    const value: AttributeMember = {
      kind: 'attribute', name: 'value', type: idlType.DOMString, readonly: true,
    };
    const interfaceIDL = defineInterface({
      name: 'PartialWidget',
      exposed: '*', members: [value],
    });
    const partial = definePartialInterface({
      name: 'PartialWidget',
      extendedAttributes: [factory],
      members: [],
    });
    const implementations = new ImplementationRegistry();
    implementations.setImplementationCreationSteps(interfaceIDL, () => new PartialWidgetImpl());
    implementations.setAttributeSteps(value, {
      get(receiver) { return Reflect.get(receiver!.implInst, 'value') as unknown; },
    });
    implementations.setConstructorSteps(factory, function(value) {
      Reflect.set(this, 'value', value);
    });
    const realm = new Realm();
    const binding = new RealmBinding(
      assembleDefinitions([interfaceIDL, partial]),
      realm,
      new BindingWorld([]),
      implementations,
    );

    binding.install();
    const LegacyPartialWidget = requireFunction(
      Reflect.get(realm.global, 'LegacyPartialWidget'),
    );
    const object = Reflect.construct(LegacyPartialWidget, ['partial']);

    expect(Reflect.get(object, 'value')).toBe('partial');
  });

  it('preserves initial-object identities across installation', () => {
    const factory = legacyFactory('LegacyThing', idlType.DOMString);
    const attribute: AttributeMember = {
      kind: 'attribute',
      name: 'label',
      readonly: true,
      type: idlType.DOMString,
    };
    const operation: OperationMember = {
      arguments: [],
      kind: 'operation',
      name: 'read',
      returns: idlType.DOMString,
    };
    const interfaceIDL = defineInterface({
      name: 'Thing',
      exposed: '*',
      extendedAttributes: [factory],
      members: [attribute, operation],
    });
    const definitions = assembleDefinitions([interfaceIDL]);
    const world = new BindingWorld([]);
    const implementations = new ImplementationRegistry();
    const realm = new Realm();
    const binding = new RealmBinding(
      definitions,
      realm,
      world,
      implementations,
    );
    binding.install();
    const firstInterface = requireFunction(Reflect.get(realm.global, 'Thing'));
    const firstFactory = requireFunction(
      Reflect.get(realm.global, 'LegacyThing'),
    );
    const firstPrototype = firstInterface.prototype;
    const firstGetter = Reflect.getOwnPropertyDescriptor(
      firstPrototype,
      'label',
    )?.get;
    const firstOperation: unknown = Reflect.get(firstPrototype, 'read');

    binding.install();

    const secondInterface = requireFunction(Reflect.get(realm.global, 'Thing'));
    const secondPrototype = secondInterface.prototype;
    expect(secondInterface).toBe(firstInterface);
    expect(Reflect.get(realm.global, 'LegacyThing')).toBe(firstFactory);
    expect(secondPrototype).toBe(firstPrototype);
    expect(Reflect.getOwnPropertyDescriptor(secondPrototype, 'label')?.get)
      .toBe(firstGetter);
    expect(Reflect.get(secondPrototype, 'read')).toBe(firstOperation);

    const foreign = new RealmBinding(
      definitions,
      new Realm(),
      world,
      implementations,
    );
    foreign.install();
    expect(Reflect.get(foreign.realm.global, 'Thing')).not.toBe(firstInterface);
    expect(Reflect.get(foreign.realm.global, 'LegacyThing'))
      .not.toBe(firstFactory);
  });

  it('binds declaration and attribute stringifiers', () => {
    const stringifier: StringifierMember = { kind: 'stringifier' };
    const attribute: AttributeMember = {
      kind: 'attribute',
      name: 'name',
      readonly: true,
      stringifier: true,
      type: idlType.DOMString,
    };
    const declaredIDL = defineInterface({
      name: 'DeclaredStringifier',
      exposed: '*',
      members: [stringifier],
    });
    const attributedIDL = defineInterface({
      name: 'AttributedStringifier',
      exposed: '*',
      members: [attribute],
    });
    const definitions = assembleDefinitions([declaredIDL, attributedIDL]);
    const implementations = new ImplementationRegistry();
    implementations.setStringificationBehavior(
      stringifier,
      function() {
        return Reflect.get(this, 'text');
      },
    );
    implementations.setAttributeSteps(attribute, {
      get(receiver) {
        return Reflect.get(receiver!.implInst, 'name') as unknown;
      },
    });
    const realm = new Realm();
    const binding = new RealmBinding(
      definitions,
      realm,
      new BindingWorld([]),
      implementations,
    );
    binding.install();

    const declared = project(binding, 'DeclaredStringifier', {
      text: 'declared',
    });
    const attributed = project(binding, 'AttributedStringifier', {
      name: 'attributed',
    });
    const declaredToString = requireFunction(
      Reflect.get(declared, 'toString'),
    );

    expect(Reflect.apply(declaredToString, declared, [])).toBe('declared');
    expect(Reflect.apply(
      requireFunction(Reflect.get(attributed, 'toString')),
      attributed,
      [],
    )).toBe('attributed');
    expect({
      length: declaredToString.length,
      name: declaredToString.name,
    }).toEqual({ length: 0, name: 'toString' });
    expect(declaredToString).toBeInstanceOf(realm.intrinsics.function);
    expect(Reflect.getOwnPropertyDescriptor(
      Reflect.getPrototypeOf(declared) as object,
      'toString',
    )).toMatchObject({
      configurable: true,
      enumerable: true,
      writable: true,
    });
    expect(() => {
      Reflect.apply(declaredToString, {}, []);
    })
      .toThrow(realm.intrinsics.typeError);
  });
});

function legacyFactory(
  name: string,
  type: typeof idlType[keyof typeof idlType],
): NamedArgumentsExtendedAttribute {
  return {
    arguments: [{ name: 'value', type }],
    kind: 'named-arguments',
    name: 'LegacyFactoryFunction',
    value: name,
  };
}

function project(
  binding: RealmBinding,
  name: string,
  properties: Record<string, unknown>,
): object {
  const primaryInterface = binding.definitions.getInterface(name);
  if (!primaryInterface) throw new Error(`Missing interface ${name}`);
  const implementation = Object.create(
    binding.getInterfacePrototypeObject(primaryInterface),
    Object.fromEntries(Object.entries(properties).map(([key, value]) => [
      key,
      { configurable: true, enumerable: true, value, writable: true },
    ])),
  ) as object;
  return binding.projectPlatformObject(implementation, primaryInterface).platformObject!;
}

function requireFunction(value: unknown): RealmFunction {
  if (typeof value !== 'function') throw new Error('Expected a function');
  return value as RealmFunction;
}

type RealmFunction = {
  (...argumentsList: unknown[]): unknown;
  new (...argumentsList: unknown[]): object;
  readonly length: number;
  readonly name: string;
  readonly prototype: object;
};
