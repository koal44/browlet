import { describe, expect, it, vi } from 'vitest';

import { TestRealm as Realm } from './test-realm';
import {
  arg, atArg, bind, bindingContext, contextValue, createBindings, ctor,
  defineCapability, defineInterface, idlType, impl, invokeWith, namedGetter, op,
  reference, roAttr, runtimeContext, xattr, type BindingContext,
} from '../../src/web-idl/index';
import { createRuntime } from '../js-engine/runtime-fixture';

describe('Web IDL interface registration', () => {
  it('composes the implementation runtime once per realm registration', () => {
    const realm = new Realm();
    const runtime = createRuntime(realm);
    const compose = vi.fn((context: BindingContext) => {
      expect(context.realm).toBe(realm);
      return runtime;
    });
    const world = createBindings([exampleIDL]);
    const first = world.register(realm, { createRuntime: compose });
    const second = world.register(realm, { createRuntime: compose });

    expect(second).toBe(first);
    expect(compose).toHaveBeenCalledOnce();
    expect(runtimeContext.resolve(first.context)).toBe(runtime);
    expect(first.context.getRuntime().promises).toBe(first.context.promises);
  });

  it('requires explicit runtime composition only when a binding requests it', () => {
    const { context } = createBindings([]).register(new Realm());
    expect(() => runtimeContext.resolve(context))
      .toThrow('The binding realm has no implementation runtime');
  });

  it('shares platform-object identity across realm registrations', () => {
    const interfaces = createBindings([exampleIDL]);
    const firstRealm = new Realm();
    const secondRealm = new Realm();
    const first = interfaces.register(firstRealm);
    const second = interfaces.register(secondRealm);

    first.install(firstRealm.global);
    second.install(secondRealm.global);

    const implementation = first.context.construct(ExampleImpl);
    const object = interfaces.getPlatformObject(implementation);
    if (!object) throw new Error('Example was not projected');

    expect(interfaces.register(firstRealm)).toBe(first);
    expect(interfaces.getImplementationObject(object)).toBe(implementation);
    expect(interfaces.getRealm(object)).toBe(firstRealm);
    expect(second.context.getImplementation(object, ExampleImpl))
      .toBe(implementation);
    expect(Reflect.get(firstRealm.global, 'Example')).not
      .toBe(Reflect.get(secondRealm.global, 'Example'));
  });

  it('preserves the origin of a lazily projected implementation', () => {
    const interfaces = createBindings([exampleIDL]);
    const firstRealm = new Realm();
    const secondRealm = new Realm();
    const first = interfaces.register(firstRealm);
    const second = interfaces.register(secondRealm);
    first.install(firstRealm.global);
    second.install(secondRealm.global);

    const implementation = first.context.construct(ExampleImpl);
    const materialized = interfaces.getPlatformObject(implementation);
    const object = second.context.project(ExampleImpl, implementation);
    const FirstExample = Reflect.get(
      firstRealm.global,
      exampleIDL.name,
    ) as CallableFunction;
    const SecondExample = Reflect.get(
      secondRealm.global,
      exampleIDL.name,
    ) as CallableFunction;

    expect(interfaces.getRealm(implementation)).toBe(firstRealm);
    expect(materialized).toBeInstanceOf(FirstExample);
    expect(object).toBe(materialized);
    expect(object).toBeInstanceOf(FirstExample);
    expect(object).not.toBeInstanceOf(SecondExample);
    expect(first.context.project(ExampleImpl, implementation)).toBe(object);
  });

  it('projects new member results in the receiver realm', () => {
    class ResultImpl {}
    class FactoryImpl {
      get result(): ResultImpl { return new ResultImpl(); }
      createResult(): ResultImpl { return new ResultImpl(); }
      createContextualResult(context: BindingContext): ResultImpl {
        return context.construct(ResultImpl);
      }
    }
    const resultIDL = defineInterface({
      name: 'RealmResult',
      exposed: '*',
      implementation: impl(ResultImpl),
      members: [],
    });
    const factoryIDL = defineInterface({
      name: 'RealmFactory',
      exposed: '*',
      implementation: impl(FactoryImpl),
      members: [
        roAttr('result', reference(resultIDL.name)),
        op('createResult', reference(resultIDL.name), []),
        op('createContextualResult', reference(resultIDL.name), [], {
          ...invokeWith(bindingContext),
        }),
        op('createBoundResult', reference(resultIDL.name), [], bind({
          invoke(context) {
            return context.construct(ResultImpl);
          },
        })),
      ],
    });
    const bindings = createBindings([resultIDL, factoryIDL]);
    const receiverRealm = new Realm();
    const functionRealm = new Realm();
    const receiverBinding = bindings.register(receiverRealm);
    const functionBinding = bindings.register(functionRealm);
    receiverBinding.install(receiverRealm.global);
    functionBinding.install(functionRealm.global);

    const factory = bindings.getPlatformObject(
      receiverBinding.context.construct(FactoryImpl),
    );
    if (!factory) throw new Error('RealmFactory was not projected');
    const ForeignFactory = Reflect.get(
      functionRealm.global,
      factoryIDL.name,
    ) as { prototype: object; };
    const createResult = Reflect.get(
      ForeignFactory.prototype,
      'createResult',
    ) as CallableFunction;
    const createContextualResult = Reflect.get(
      ForeignFactory.prototype,
      'createContextualResult',
    ) as CallableFunction;
    const createBoundResult = Reflect.get(
      ForeignFactory.prototype,
      'createBoundResult',
    ) as CallableFunction;
    const getResult = Reflect.getOwnPropertyDescriptor(
      ForeignFactory.prototype,
      'result',
    )?.get;
    if (!getResult) throw new Error('RealmFactory.result has no getter');
    const results = [
      Reflect.apply(getResult, factory, []) as object,
      Reflect.apply(createResult, factory, []) as object,
      Reflect.apply(createContextualResult, factory, []) as object,
      Reflect.apply(createBoundResult, factory, []) as object,
    ];
    const ReceiverResult = Reflect.get(
      receiverRealm.global,
      resultIDL.name,
    ) as { new(): object; };
    const ForeignResult = Reflect.get(
      functionRealm.global,
      resultIDL.name,
    ) as { new(): object; };

    for (const result of results) {
      expect(result).toBeInstanceOf(ReceiverResult);
      expect(result).not.toBeInstanceOf(ForeignResult);
      expect(bindings.getRealm(result)).toBe(receiverRealm);
    }
  });

  it('injects declared dependencies into internal construction', () => {
    const positioned = contextValue(() => 'positioned');
    class ConstructedImpl {
      constructor(
        readonly context: BindingContext,
        readonly global: object,
        readonly semantic: string,
        readonly positioned: string,
      ) {}
    }
    const interfaceIDL = defineInterface({
      name: 'ConstructedExample',
      exposed: '*',
      implementation: impl(ConstructedImpl, {
        constructWith: [bindingContext, 'current-global', atArg(3, positioned)],
      }),
      members: [],
    });
    const interfaces = createBindings([interfaceIDL]);
    const realm = new Realm();
    const registration = interfaces.register(realm);
    registration.install(realm.global);

    const implementation = registration.context.construct(
      ConstructedImpl,
      'semantic',
    );

    expect(implementation.context).toBe(registration.context);
    expect(implementation.global).toBe(realm.global);
    expect(implementation.semantic).toBe('semantic');
    expect(implementation.positioned).toBe('positioned');
    expect(interfaces.getRealm(implementation)).toBe(realm);
  });

  it('preserves registered primary identity during explicit projection', () => {
    class ParentImpl {}
    class ChildImpl extends ParentImpl {}
    class UnrelatedImpl {}
    const parentIDL = defineInterface({
      name: 'ProjectionParent',
      exposed: '*',
      implementation: impl(ParentImpl),
      members: [],
    });
    const childIDL = defineInterface({
      name: 'ProjectionChild',
      inherits: parentIDL.name,
      exposed: '*',
      implementation: impl(ChildImpl),
      members: [],
    });
    const unrelatedIDL = defineInterface({
      name: 'ProjectionUnrelated',
      exposed: '*',
      implementation: impl(UnrelatedImpl),
      members: [],
    });
    const realm = new Realm();
    const registration = createBindings([
      parentIDL,
      childIDL,
      unrelatedIDL,
    ]).register(realm);
    registration.install(realm.global);

    const child = new ChildImpl();
    const object = registration.context.project(ParentImpl, child);
    const Child = Reflect.get(realm.global, childIDL.name) as CallableFunction;

    expect(object).toBeInstanceOf(Child);
    expect(() => registration.context.project(
      ParentImpl,
      new UnrelatedImpl(),
    )).toThrow('associated with another interface');
  });

  it('isolates platform-object identity between bindings', () => {
    const first = createBindings([exampleIDL]);
    const second = createBindings([exampleIDL]);
    const realm = new Realm();
    const implementation = first.register(realm).context.construct(ExampleImpl);
    const object = first.getPlatformObject(implementation);
    if (!object) throw new Error('Example was not projected');

    expect(second.getImplementationObject(object)).toBeUndefined();
    expect(second.getPlatformObject(implementation)).toBeUndefined();
    expect(second.getRealm(object)).toBeUndefined();
  });

  it('projects default operations without implementation methods', () => {
    const interfaces = createBindings([jsonIDL]);
    const realm = new Realm();
    const registration = interfaces.register(realm);
    const implementation = registration.context.construct(JsonImpl);
    const object = interfaces.getPlatformObject(implementation);
    if (!object) throw new Error('JSONExample was not projected');
    const toJSON = Reflect.get(object, 'toJSON') as CallableFunction;

    expect(Reflect.apply(toJSON, object, [])).toEqual({ value: 12 });
  });

  it('requires explicit bindings for unnamed operations', () => {
    const interfaces = createBindings([unnamedOperationIDL]);
    const realm = new Realm();

    expect(() => interfaces.register(realm)).toThrow(
      'Web IDL UnnamedOperationExample.operation has no binding',
    );
    expect(() => interfaces.register(realm)).toThrow(
      'Web IDL UnnamedOperationExample.operation has no binding',
    );
  });

  it('does not treat a legacy property hook as unnamed invocation steps', () => {
    const interfaces = createBindings([unnamedHookOperationIDL]);

    expect(() => interfaces.register(new Realm())).toThrow(
      'Web IDL UnnamedHookOperationExample.operation has no binding',
    );
  });

  it('indexes capabilities by exact primary interface', () => {
    class ParentImpl {}
    class ChildImpl extends ParentImpl {}
    const parentIDL = defineInterface({
      name: 'CapabilityParent',
      exposed: '*',
      implementation: impl(ParentImpl),
      members: [],
    });
    const childIDL = defineInterface({
      name: 'CapabilityChild',
      inherits: parentIDL.name,
      exposed: '*',
      implementation: impl(ChildImpl),
      members: [],
    });
    const capability = defineCapability<string>('Test');
    const interfaces = createBindings(
      [parentIDL, childIDL],
      {
        capabilities: [
          capability.for(parentIDL, 'parent'),
          capability.for(childIDL, 'child'),
        ],
      },
    );
    const registration = interfaces.register(new Realm());
    const child = registration.context.createPlatformObject(childIDL);

    expect(registration.context.resolvePlatformObject(child.platformObject))
      .toBe(child);
    expect(child.primaryInterface.definition).toBe(childIDL);
    expect(registration.context.getCapability(
      child.primaryInterface.definition,
      capability,
    )).toBe('child');
    expect(registration.context.getCapability(parentIDL, capability))
      .toBe('parent');
  });

  it('creates internal instances without running public constructor steps', () => {
    let allocations = 0;
    let publicConstructions = 0;
    class InternalNewImpl {
      constructor() { allocations++; }
    }
    const interfaceIDL = defineInterface({
      name: 'InternalNewExample',
      exposed: '*',
      implementation: impl(InternalNewImpl),
      members: [ctor([], bind({
        invoke() { publicConstructions++; },
      }))],
    });
    const interfaces = createBindings([interfaceIDL]);
    const realm = new Realm();
    const registration = interfaces.register(realm);
    registration.install(realm.global);

    const internal = registration.context.createPlatformObject(interfaceIDL);

    expect(internal.primaryInterface.definition).toBe(interfaceIDL);
    expect(internal.realm).toBe(realm);
    expect(allocations).toBe(1);
    expect(publicConstructions).toBe(0);

    const Constructor = Reflect.get(realm.global, interfaceIDL.name) as {
      new(): object;
    };
    const constructed = new Constructor();

    expect(registration.context.resolvePlatformObject(constructed)
      ?.primaryInterface.definition)
      .toBe(interfaceIDL);
    expect(allocations).toBe(2);
    expect(publicConstructions).toBe(1);
  });

  it('rejects foreign, duplicate, and unexposed interface capabilities', () => {
    class RestrictedImpl {}
    const restrictedIDL = defineInterface({
      name: 'RestrictedCapability',
      exposed: ['Worker'],
      implementation: impl(RestrictedImpl),
      members: [],
    });
    const foreignIDL = defineInterface({
      name: restrictedIDL.name,
      members: [],
    });
    const capability = defineCapability<string>('Restricted');

    expect(() => createBindings(
      [restrictedIDL],
      {
        capabilities: [
          capability.for(foreignIDL, 'foreign'),
        ],
      },
    )).toThrow('targets unknown interface definition RestrictedCapability');
    expect(() => createBindings(
      [restrictedIDL],
      {
        capabilities: [
          capability.for(restrictedIDL, 'first'),
          capability.for(restrictedIDL, 'second'),
        ],
      },
    )).toThrow('has a duplicate Restricted capability registration');

    const registration = createBindings(
      [restrictedIDL],
      {
        capabilities: [
          capability.for(restrictedIDL, 'registered'),
        ],
      },
    ).register(new Realm());

    expect(registration.context.isInterfaceExposed(restrictedIDL)).toBe(false);
    expect(() => registration.context.createPlatformObject(restrictedIDL)).toThrow(
      'Interface RestrictedCapability is not exposed in this realm',
    );
  });
});

class ExampleImpl {}

class JsonImpl {
  get value(): number { return 12; }
}

const exampleIDL = defineInterface({
  name: 'Example',
  exposed: '*',
  implementation: impl(ExampleImpl),
  members: [],
});

const jsonIDL = defineInterface({
  name: 'JSONExample',
  exposed: '*',
  implementation: impl(JsonImpl),
  members: [
    roAttr('value', idlType.long),
    op('toJSON', idlType.object, [], xattr('Default')),
  ],
});

const unnamedOperationIDL = defineInterface({
  name: 'UnnamedOperationExample',
  exposed: '*',
  implementation: impl(ExampleImpl),
  members: [op(
    undefined,
    idlType.object,
    [arg('name', idlType.DOMString)],
    { special: 'getter' },
  )],
});

const unnamedHookOperationIDL = defineInterface({
  name: 'UnnamedHookOperationExample',
  exposed: '*',
  implementation: impl(ExampleImpl),
  members: [op(
    undefined,
    idlType.object,
    [arg('name', idlType.DOMString)],
    namedGetter(() => new Set(['name'])),
  )],
});
