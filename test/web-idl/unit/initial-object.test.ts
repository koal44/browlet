import { describe, expect, it } from 'vitest';
import { Realm } from '../../../src/browlet/realm';
import { assembleDefinitions } from '../../../src/web-idl/assembly';
import { JavaScriptBinding } from '../../../src/web-idl/binding';
import {
  defineInterface, idlType, type AttributeMember,
  type NamedArgumentsExtendedAttribute, type OperationMember,
  type StringifierMember,
} from '../../../src/web-idl/definition';
import { ImplementationRegistry } from '../../../src/web-idl/implementation';
import { PlatformObjectRegistry } from '../../../src/web-idl/platform-object';

describe('Web IDL initial objects', () => {
  it('creates legacy factory functions in the realm', () => {
    const factory = legacyFactory('LegacyWidget', idlType.unsignedLong);
    const interfaceIDL = defineInterface({
      exposed: '*',
      extendedAttributes: [factory],
      members: [],
      name: 'Widget',
    });
    const definitions = assembleDefinitions([interfaceIDL]);
    const implementations = new ImplementationRegistry();
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      definitions,
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
    implementations.setObjectCreationSteps(interfaceIDL, (newTarget) => {
      if (!newTarget) throw new Error('Missing legacy factory newTarget');
      return Object.create(
        Reflect.get(newTarget, 'prototype') as object,
      ) as object;
    });
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
      exposed: '*',
      extendedAttributes: [factory],
      members: [attribute, operation],
      name: 'Thing',
    });
    const definitions = assembleDefinitions([interfaceIDL]);
    const platformObjects = new PlatformObjectRegistry();
    const implementations = new ImplementationRegistry();
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      definitions,
      realm,
      platformObjects,
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

    const foreign = new JavaScriptBinding(
      definitions,
      new Realm(),
      platformObjects,
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
      exposed: '*',
      members: [stringifier],
      name: 'DeclaredStringifier',
    });
    const attributedIDL = defineInterface({
      exposed: '*',
      members: [attribute],
      name: 'AttributedStringifier',
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
      get() {
        return Reflect.get(this as object, 'name') as unknown;
      },
    });
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      definitions,
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
    binding.getExposedInitialObjects();

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
  binding: JavaScriptBinding,
  name: string,
  properties: Record<string, unknown>,
): object {
  const interface_ = binding.definitions.getInterface(name);
  if (!interface_) throw new Error(`Missing interface ${name}`);
  const implementation = Object.create(
    binding.getInterfacePrototypeObject(interface_),
    Object.fromEntries(Object.entries(properties).map(([key, value]) => [
      key,
      { configurable: true, enumerable: true, value, writable: true },
    ])),
  ) as object;
  return binding.projectPlatformObject(implementation, interface_).object;
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
