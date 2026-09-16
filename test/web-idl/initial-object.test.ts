import { describe, expect, it } from 'vitest';
import { TestRealm as Realm } from './test-realm';
import { DefinitionAssembly } from '../../src/web-idl/assembly';
import { BindingWorld } from '../../src/web-idl/binding-world';
import { RealmBinding } from '../../src/web-idl/realm-binding';
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
    );
    binding.getDefinitionBinding(interfaceIDL).overriddenConstructor = (argumentsList, newTarget, activeFunction) => ({
      activeFunction,
      argumentsList,
      newTarget,
    });

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
      new DefinitionAssembly([interfaceIDL]),
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

    const realm = new Realm();
    const binding = new RealmBinding(
      new DefinitionAssembly([interfaceIDL]),
      realm,
      new BindingWorld([]),
    );
    binding.getDefinitionBinding(interfaceIDL).createImplementation = () => new HiddenImpl();

    const installed = binding.install();
    const object = binding.createPlatformRecord(binding.resolveInterface('HiddenInterface')).platformObject!;
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
    const ctx = world.register(realm);
    const binding = world.getRealmBinding(realm)!;

    ctx.install(realm.global);
    expect(Reflect.has(realm.global, 'Hidden')).toBe(false);
    const prototype = binding.getInterfacePrototypeObject(binding.resolveInterface('Hidden'));
    expect(Object.hasOwn(prototype, 'label')).toBe(false);
    expect(Object.hasOwn(prototype, 'read')).toBe(false);

    const first = ctx.createPlatformRecord(definition).platformObject!;
    const second = ctx.createPlatformRecord(definition).platformObject!;
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
    const definitions = new DefinitionAssembly([interfaceIDL]);
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
    const definitions = new DefinitionAssembly([interfaceIDL]);

    const realm = new Realm();
    const binding = new RealmBinding(
      definitions,
      realm,
      new BindingWorld([]),
    );
    const interfaceBinding = binding.getDefinitionBinding(interfaceIDL);
    interfaceBinding.createImplementation = () => new WidgetImpl();
    interfaceBinding.getOrCreateMemberRecord(value).attributeSteps = {
      get(receiver) { return Reflect.get(receiver!.implInst, 'value') as unknown; },
    };
    interfaceBinding.getOrCreateMemberRecord(factory).constructorBehavior = {
      kind: 'initialize',
      steps: function(value) {
        Reflect.set(this, 'value', value);
      },
    };

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

    const realm = new Realm();
    const binding = new RealmBinding(
      new DefinitionAssembly([interfaceIDL, partial]),
      realm,
      new BindingWorld([]),
    );
    const interfaceBinding = binding.getDefinitionBinding(interfaceIDL);
    interfaceBinding.createImplementation = () => new PartialWidgetImpl();
    interfaceBinding.getOrCreateMemberRecord(value).attributeSteps = {
      get(receiver) { return Reflect.get(receiver!.implInst, 'value') as unknown; },
    };
    interfaceBinding.getOrCreateMemberRecord(factory).constructorBehavior = {
      kind: 'initialize',
      steps: function(value) {
        Reflect.set(this, 'value', value);
      },
    };

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
    const definitions = new DefinitionAssembly([interfaceIDL]);
    const world = new BindingWorld([]);

    const realm = new Realm();
    const binding = new RealmBinding(
      definitions,
      realm,
      world,
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
    const definitions = new DefinitionAssembly([declaredIDL, attributedIDL]);

    const realm = new Realm();
    const binding = new RealmBinding(
      definitions,
      realm,
      new BindingWorld([]),
    );
    binding.getDefinitionBinding(declaredIDL).getOrCreateMemberRecord(stringifier).stringificationBehavior = function() {
      return Reflect.get(this, 'text');
    };
    binding.getDefinitionBinding(attributedIDL).getOrCreateMemberRecord(attribute).attributeSteps = {
      get(receiver) {
        return Reflect.get(receiver!.implInst, 'name') as unknown;
      },
    };
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
