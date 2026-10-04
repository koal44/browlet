import { describe, expect, it } from 'vitest';

import { getMemberBinding } from '../support/web-idl-binding';
import { TestRealm as Realm } from './test-realm';
import { DefinitionAssembly } from '../../src/web-idl/assembly/index';
import { BindingWorld } from '../../src/web-idl/binding/world';
import { RealmBinding } from '../../src/web-idl/binding/realm';
import { PlatformRecord } from '../../src/web-idl/binding/platform';
import {
  attr, defineInterface, definePartialInterface, idlType, impl, op, stringifier, xattr,
  type AttributeMember, type NamedArgumentsExtendedAttribute,
  type OperationMember, type StringifierMember,
} from '../../src/web-idl/core/index';

describe('Web IDL initial objects', () => {
  it('uses an interface\'s overridden constructor steps', () => {
    const interfaceIDL = defineInterface({
      name: 'OverriddenConstructor',
      exposed: '*', members: [],
    });

    const realm = new Realm();
    const binding = new RealmBinding(
      new DefinitionAssembly([interfaceIDL]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    binding.getImplementationBinding(binding.resolveInterface(interfaceIDL.name)).overriddenConstructor = (argumentsList, newTarget, activeFunction) => ({
      activeFunction,
      argumentsList,
      newTarget,
    });

    binding.installDefinitions();
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
      new DefinitionAssembly([interfaceIDL]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );

    binding.installDefinitions();
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

    const realm = new Realm();
    const binding = new RealmBinding(
      new DefinitionAssembly([interfaceIDL]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    binding.getImplementationBinding(binding.resolveInterface(interfaceIDL.name)).createImplementation = () => new HiddenImpl();

    const installed = binding.installDefinitions();
    const object = binding.allocatePlatformRecord(binding.resolveInterface('HiddenInterface')).platformObject!;
    const prototype = Reflect.getPrototypeOf(object);

    expect(installed.has('HiddenInterface')).toBe(false);
    expect(Reflect.has(realm.global, 'HiddenInterface')).toBe(false);
    expect(prototype).toBe(
      binding.getImplementationBinding(binding.resolveInterface('HiddenInterface')).getInterfacePrototypeObject(),
    );
    expect(Object.hasOwn(prototype as object, 'constructor')).toBe(false);
    expect(Object.prototype.toString.call(prototype))
      .toBe('[object HiddenInterface]');
  });

  it('shares hidden unforgeable members when instances are first projected after installation', () => {
    class HiddenImpl {
      #label = 'hidden';

      get label(): string { return this.#label; }
      set label(value: string) { this.#label = value; }
      read(): string { return this.#label; }
      toString(): string { return this.#label; }
    }
    const definition = defineInterface({
      name: 'Hidden',
      exposed: '*',
      ...xattr('LegacyNoInterfaceObject'),
      implementation: impl(HiddenImpl),
      members: [
        attr('label', idlType.DOMString, xattr('LegacyUnforgeable')),
        op('read', idlType.DOMString, [], xattr('LegacyUnforgeable')),
        stringifier(xattr('LegacyUnforgeable')),
      ],
    });
    const realm = new Realm();
    const world = new BindingWorld([definition]);
    const ctx = world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const binding = world.getRealmBinding(realm)!;

    ctx.install(realm.global);
    expect(Reflect.has(realm.global, 'Hidden')).toBe(false);
    const prototype = binding.getImplementationBinding(binding.resolveInterface('Hidden')).getInterfacePrototypeObject();
    expect(Object.hasOwn(prototype, 'label')).toBe(false);
    expect(Object.hasOwn(prototype, 'read')).toBe(false);

    const first = ctx.createPlatformRecord(definition.name)!.platformObject!;
    const second = ctx.createPlatformRecord(definition.name)!.platformObject!;
    const firstDescriptors = Object.getOwnPropertyDescriptors(first);
    const secondDescriptors = Object.getOwnPropertyDescriptors(second);
    for (const name of ['label', 'read', 'toString']) {
      expect(firstDescriptors[name]).toEqual(secondDescriptors[name]);
      expect(firstDescriptors[name]?.configurable).toBe(false);
    }
    expect(Reflect.get(first, 'label')).toBe('hidden');
    Reflect.set(first, 'label', 'changed');
    expect(Reflect.apply(requireFunction(Reflect.get(first, 'read')), first, [])).toBe('changed');
    expect(Reflect.apply(requireFunction(Reflect.get(first, 'toString')), first, [])).toBe('changed');
    expect(Reflect.get(second, 'label')).toBe('hidden');
    expect(Reflect.getOwnPropertyDescriptor(first, 'label')?.get)
      .toBeInstanceOf(realm.intrinsics.function);

    ctx.install(realm.global);
    expect(Object.getOwnPropertyDescriptors(first)).toEqual(firstDescriptors);
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
    const assembly = new DefinitionAssembly([interfaceIDL]);
    const windowRealm = new Realm({ globalNames: ['Window'] });
    const workerRealm = new Realm({ globalNames: ['Worker'] });
    const windowBinding = new RealmBinding(
      assembly,
      windowRealm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    const workerBinding = new RealmBinding(
      assembly,
      workerRealm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );

    windowBinding.installDefinitions();
    workerBinding.installDefinitions();

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
    const assembly = new DefinitionAssembly([interfaceIDL]);

    const realm = new Realm();
    const binding = new RealmBinding(
      assembly,
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    const interfaceBinding = binding.getImplementationBinding(binding.resolveInterface(interfaceIDL.name));
    interfaceBinding.createImplementation = () => new WidgetImpl();
    getMemberBinding(interfaceBinding, value).attributeSteps = {
      get(receiver) { return Reflect.get(receiver!.implInst, 'value') as unknown; },
    };
    getMemberBinding(interfaceBinding, factory).constructorBehavior = {
      kind: 'initialize',
      steps: function(value) {
        Reflect.set(this, 'value', value);
      },
    };

    binding.installDefinitions();
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

    const realm = new Realm();
    const binding = new RealmBinding(
      new DefinitionAssembly([interfaceIDL, partial]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    const interfaceBinding = binding.getImplementationBinding(binding.resolveInterface(interfaceIDL.name));
    interfaceBinding.createImplementation = () => new PartialWidgetImpl();
    getMemberBinding(interfaceBinding, value).attributeSteps = {
      get(receiver) { return Reflect.get(receiver!.implInst, 'value') as unknown; },
    };
    getMemberBinding(interfaceBinding, factory).constructorBehavior = {
      kind: 'initialize',
      steps: function(value) {
        Reflect.set(this, 'value', value);
      },
    };

    binding.installDefinitions();
    const LegacyPartialWidget = requireFunction(
      Reflect.get(realm.global, 'LegacyPartialWidget'),
    );
    const object = Reflect.construct(LegacyPartialWidget, ['partial']);

    expect(Reflect.get(object, 'value')).toBe('partial');
  });

  it('shares factory overload declarations while keeping their functions and steps in each realm', () => {
    class WidgetImpl { value = ''; }
    const numericFactory = legacyFactory('LegacyWidget', idlType.unsignedLong);
    const stringFactory = legacyFactory('LegacyWidget', idlType.DOMString);
    const value: AttributeMember = {
      kind: 'attribute', name: 'value', type: idlType.DOMString, readonly: true,
    };
    const interfaceIDL = defineInterface({
      name: 'Widget', exposed: '*',
      extendedAttributes: [numericFactory], members: [value],
    });
    const partial = definePartialInterface({
      name: 'Widget', extendedAttributes: [stringFactory], members: [],
    });
    const assembly = new DefinitionAssembly([partial, interfaceIDL]);
    const world = new BindingWorld([]);
    const factories: RealmFunction[] = [];

    for (const name of ['first', 'second']) {
      const realm = new Realm();
      const binding = new RealmBinding(assembly, realm, world, (ctx) => ({ realm: ctx.realm }));
      const assembled = binding.resolveInterface('Widget');
      const interfaceBinding = binding.getImplementationBinding(assembled);
      interfaceBinding.createImplementation = () => new WidgetImpl();
      getMemberBinding(interfaceBinding, value).attributeSteps = {
        get(receiver) { return Reflect.get(receiver!.implInst, 'value') as unknown; },
      };
      for (const factory of [numericFactory, stringFactory]) {
        getMemberBinding(interfaceBinding, factory).constructorBehavior = {
          kind: 'initialize',
          steps: function(value) { Reflect.set(this, 'value', `${name}:${typeof value}:${String(value)}`); },
        };
      }
      binding.installDefinitions();
      const factory = requireFunction(Reflect.get(realm.global, 'LegacyWidget'));
      factories.push(factory);

      expect(factory).toBeInstanceOf(realm.intrinsics.function);
      expect(factory.length).toBe(1);
      expect(factory.prototype).toBe(binding.getImplementationBinding(assembled).getInterfacePrototypeObject());
      expect(Reflect.get(Reflect.construct(factory, [2 ** 32 + 7]), 'value')).toBe(`${name}:number:7`);
      expect(Reflect.get(Reflect.construct(factory, ['text']), 'value')).toBe(`${name}:string:text`);
      binding.installDefinitions();
      expect(Reflect.get(realm.global, 'LegacyWidget')).toBe(factory);
    }
    expect(factories[0]).not.toBe(factories[1]);
    expect(factories[0]!.prototype === factories[1]!.prototype).toBe(false);
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
    const assembly = new DefinitionAssembly([interfaceIDL]);
    const world = new BindingWorld([]);

    const realm = new Realm();
    const binding = new RealmBinding(
      assembly,
      realm,
      world,
      (ctx) => ({ realm: ctx.realm }),
    );
    binding.installDefinitions();
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

    binding.installDefinitions();

    const secondInterface = requireFunction(Reflect.get(realm.global, 'Thing'));
    const secondPrototype = secondInterface.prototype;
    expect(secondInterface).toBe(firstInterface);
    expect(Reflect.get(realm.global, 'LegacyThing')).toBe(firstFactory);
    expect(secondPrototype).toBe(firstPrototype);
    expect(Reflect.getOwnPropertyDescriptor(secondPrototype, 'label')?.get)
      .toBe(firstGetter);
    expect(Reflect.get(secondPrototype, 'read')).toBe(firstOperation);

    const foreign = new RealmBinding(
      assembly,
      new Realm(),
      world,
      (ctx) => ({ realm: ctx.realm }),
    );
    foreign.installDefinitions();
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
    const assembly = new DefinitionAssembly([declaredIDL, attributedIDL]);

    const realm = new Realm();
    const binding = new RealmBinding(
      assembly,
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    getMemberBinding(binding.getImplementationBinding(binding.resolveInterface(declaredIDL.name)), stringifier).stringificationBehavior = function() {
      return Reflect.get(this, 'text');
    };
    getMemberBinding(binding.getImplementationBinding(binding.resolveInterface(attributedIDL.name)), attribute).attributeSteps = {
      get(receiver) {
        return Reflect.get(receiver!.implInst, 'name') as unknown;
      },
    };
    binding.installDefinitions();

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
  const assembled = binding.assembly.interfaces.get(name);
  if (!assembled) throw new Error(`Missing interface ${name}`);
  const implementation = Object.create(
    binding.getImplementationBinding(assembled).getInterfacePrototypeObject(),
    Object.fromEntries(Object.entries(properties).map(([key, value]) => [
      key,
      { configurable: true, enumerable: true, value, writable: true },
    ])),
  ) as object;
  return new PlatformRecord(implementation, assembled, binding).project();
}

function requireFunction(value: unknown): RealmFunction {
  if (typeof value !== 'function') throw new Error('Expected a function');
  return value as RealmFunction;
}

type RealmFunction = {
  (...argumentsList: unknown[]): unknown;
  new (...argumentsList: unknown[]): object;
  length: number;
  name: string;
  prototype: object;
};
