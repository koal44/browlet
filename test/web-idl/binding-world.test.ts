import { describe, expect, it, vi } from 'vitest';

import { TestRealm as Realm } from './test-realm';
import {
  arg, atArg, attr, BindingWorld, ctor,
  defineCapability, defineInterface, idlType, impl, invokeWith, namedGetter, op,
  reference, roAttr, xattr, type BindingContext,
} from '../../src/web-idl/index';
import { createRuntime } from '../js-engine/runtime-fixture';
import { TypeError as InternalTypeError } from '../../src/js-engine/index';

describe('Web IDL binding worlds and realm registration', () => {
  it('composes the implementation runtime once per realm registration', () => {
    const realm = new Realm();
    const runtime = createRuntime(realm);
    const world = new BindingWorld([exampleIDL]);
    const compose = vi.fn((context: BindingContext) => {
      expect(context.realm).toBe(realm);
      expect(world.forRealm(realm)).toBeUndefined();
      return runtime;
    });
    const first = world.register(realm, { createRuntime: compose });
    const second = world.register(realm, { createRuntime: compose });

    expect(second).toBe(first);
    expect(world.forRealm(realm)).toBe(first);
    expect(compose).toHaveBeenCalledOnce();
    expect(compose.mock.calls[0]![0]).toBe(first);
    expect(first.getRuntime()).toBe(runtime);
    expect(first.getRuntime().promises).toBe(first.promises);
  });

  it('allows registration to retry after runtime composition fails', () => {
    const realm = new Realm();
    const world = new BindingWorld([exampleIDL]);
    const failure = new Error('Runtime composition failed');

    expect(() => world.register(realm, {
      createRuntime() { throw failure; },
    })).toThrow(failure);
    expect(world.forRealm(realm)).toBeUndefined();

    const runtime = createRuntime(realm);
    const context = world.register(realm, { createRuntime: () => runtime });
    expect(world.forRealm(realm)).toBe(context);
    expect(context.getRuntime()).toBe(runtime);
    expect(world.project(context.construct(ExampleImpl))).toBeDefined();
  });

  it('keeps failed declaration setup out of the realm registry', () => {
    class IncompleteImpl {}
    const world = new BindingWorld([defineInterface({
      name: 'Incomplete', implementation: impl(IncompleteImpl),
      members: [op('read', idlType.long, [])],
    })]);
    const realm = new Realm();

    expect(() => world.register(realm)).toThrow('operation read has no implementation');
    expect(world.forRealm(realm)).toBeUndefined();
    expect(() => world.register(realm)).toThrow('operation read has no implementation');
  });

  it('requires explicit runtime composition only when a binding requests it', () => {
    const ctx = new BindingWorld([]).register(new Realm());
    expect(() => ctx.getRuntime())
      .toThrow('The binding realm has no implementation runtime');
  });

  it('shares platform-object identity across realm registrations', () => {
    const interfaces = new BindingWorld([exampleIDL]);
    const firstRealm = new Realm();
    const secondRealm = new Realm();
    const first = interfaces.register(firstRealm);
    const second = interfaces.register(secondRealm);

    first.install(firstRealm.global);
    second.install(secondRealm.global);

    const implementation = first.construct(ExampleImpl);
    const object = interfaces.project(implementation);
    if (!object) throw new Error('Example was not projected');

    expect(interfaces.register(firstRealm)).toBe(first);
    expect(interfaces.unwrap(object)).toBe(implementation);
    expect(interfaces.getRealm(object)).toBe(firstRealm);
    expect(second.unwrap(object, ExampleImpl))
      .toBe(implementation);
    expect(Reflect.get(firstRealm.global, 'Example')).not
      .toBe(Reflect.get(secondRealm.global, 'Example'));
  });

  it('preserves the origin of a lazily projected implementation', () => {
    const interfaces = new BindingWorld([exampleIDL]);
    const firstRealm = new Realm();
    const secondRealm = new Realm();
    const first = interfaces.register(firstRealm);
    const second = interfaces.register(secondRealm);
    first.install(firstRealm.global);
    second.install(secondRealm.global);

    const implementation = first.construct(ExampleImpl);
    const materialized = interfaces.project(implementation);
    const object = second.project(ExampleImpl, implementation);
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
    expect(first.project(ExampleImpl, implementation)).toBe(object);
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
        op('createContextualResult', reference(resultIDL.name),
          [],
          {
            ...invokeWith(atArg(0, (ctx) => ctx)),
          },
        ),
        op('createBoundResult', reference(resultIDL.name),
          [],
          {
            invoke(context) {
              return context.construct(ResultImpl);
            },
          },
        ),
      ],
    });
    const bindings = new BindingWorld([resultIDL, factoryIDL]);
    const receiverRealm = new Realm();
    const functionRealm = new Realm();
    const receiverBinding = bindings.register(receiverRealm);
    const functionBinding = bindings.register(functionRealm);
    receiverBinding.install(receiverRealm.global);
    functionBinding.install(functionRealm.global);

    const factory = bindings.project(
      receiverBinding.construct(FactoryImpl),
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

  it('keeps receiver context and method error realm distinct for borrowed member adapters', () => {
    class ReceiverImpl {}
    let setterContext: BindingContext | undefined;
    let setterValue: unknown;
    const definition = defineInterface({
      name: 'Receiver', exposed: '*', implementation: impl(ReceiverImpl),
      members: [
        attr('owner', idlType.object, {
          get(ctx) { return ctx.realm.global; },
          set(ctx, value) {
            expect(this).toBe(implInst);
            setterContext = ctx;
            setterValue = value;
          },
        }),
        op('fail', idlType.undefined,
          [],
          {
            invoke() { throw new InternalTypeError('Implementation failure'); },
          },
        ),
      ],
    });
    const world = new BindingWorld([definition]);
    const receiverRealm = new Realm();
    const methodRealm = new Realm();
    const receiverContext = world.register(receiverRealm);
    world.register(methodRealm).install(methodRealm.global);
    const implInst = receiverContext.construct(ReceiverImpl);
    const object = world.project(implInst)!;
    const Constructor = Reflect.get(methodRealm.global, definition.name) as { prototype: object; };
    const descriptor = Reflect.getOwnPropertyDescriptor(Constructor.prototype, 'owner')!;
    const token = {};

    expect(Reflect.apply(descriptor.get!, object, [])).toBe(receiverRealm.global);
    Reflect.apply(descriptor.set!, object, [token]);
    expect(setterContext).toBe(receiverContext);
    expect(setterValue).toBe(token);

    const fail = Reflect.get(Constructor.prototype, 'fail') as CallableFunction;
    expect(() => { Reflect.apply(fail, object, []); }).toThrow(methodRealm.intrinsics.typeError);
    expect(() => { Reflect.apply(fail, object, []); }).not.toThrow(receiverRealm.intrinsics.typeError);
  });

  it('injects declared dependencies into internal construction', () => {
    const positioned = () => 'positioned';
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
        constructWith: [
          atArg(0, (ctx) => ctx), atArg(1, (ctx) => ctx.realm.global), atArg(3, positioned),
        ],
      }),
      members: [],
    });
    const interfaces = new BindingWorld([interfaceIDL]);
    const realm = new Realm();
    const registration = interfaces.register(realm);
    registration.install(realm.global);

    const implementation = registration.construct(
      ConstructedImpl,
      'semantic',
    );

    expect(implementation.context).toBe(registration);
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
    const registration = new BindingWorld([
      parentIDL,
      childIDL,
      unrelatedIDL,
    ]).register(realm);
    registration.install(realm.global);

    const child = new ChildImpl();
    const object = registration.project(ParentImpl, child);
    const Child = Reflect.get(realm.global, childIDL.name) as CallableFunction;

    expect(object).toBeInstanceOf(Child);
    expect(() => registration.project(
      ParentImpl,
      new UnrelatedImpl(),
    )).toThrow('associated with another interface');
  });

  it.each([false, true])('keeps an implementation in one world (projected: %s)', (projected) => {
    const first = new BindingWorld([exampleIDL]);
    const second = new BindingWorld([exampleIDL]);
    const realm = new Realm();
    const firstContext = first.register(realm);
    const secondContext = second.register(realm);
    const implementation = firstContext.construct(ExampleImpl);
    const object = projected ? first.project(implementation) : undefined;

    expect(second.project(implementation)).toBeUndefined();
    expect(second.getRealm(implementation)).toBeUndefined();
    expect(secondContext.getObjectRecord(implementation)).toBeUndefined();
    if (object) {
      expect(second.unwrap(object)).toBeUndefined();
      expect(second.getRealm(object)).toBeUndefined();
      expect(secondContext.unwrap(object, ExampleImpl)).toBeUndefined();
      expect(secondContext.getObjectRecord(object)).toBeUndefined();
    }
    expect(() => secondContext.project(ExampleImpl, implementation))
      .toThrow('Implementation instance belongs to another binding world');

    const secondImplementation = secondContext.construct(ExampleImpl);
    const secondObject = secondContext.project(ExampleImpl, secondImplementation);
    expect(firstContext).not.toBe(secondContext);
    expect(firstContext.realm).toBe(secondContext.realm);
    expect(first.forRealm(realm)).toBe(firstContext);
    expect(second.forRealm(realm)).toBe(secondContext);
    expect(secondObject).not.toBe(object);
    expect(first.unwrap(secondObject)).toBeUndefined();
    expect(second.unwrap(secondObject)).toBe(secondImplementation);
    const firstObject = first.project(implementation);
    expect(firstObject).toBe(firstContext.project(ExampleImpl, implementation));
    expect(first.getRealm(implementation)).toBe(realm);
    if (object) expect(firstObject).toBe(object);
  });

  it('stamps a frozen implementation without changing its keys, prototype, or private fields', () => {
    class FrozenImpl {
      #value = 7;
      constructor() { Object.freeze(this); }
      get value(): number { return this.#value; }
    }
    const definition = defineInterface({
      name: 'Frozen',
      implementation: impl(FrozenImpl),
      members: [roAttr('value', idlType.long)],
    });
    const world = new BindingWorld([definition]);
    const ctx = world.register(new Realm());
    const instance = ctx.construct(FrozenImpl);
    const object = ctx.project(FrozenImpl, instance);

    expect(Object.isFrozen(instance)).toBe(true);
    expect(Object.getPrototypeOf(instance)).toBe(FrozenImpl.prototype);
    expect(Reflect.ownKeys(instance)).toEqual([]);
    expect(Reflect.ownKeys(object)).toEqual([]);
    expect(Reflect.get(object, 'value')).toBe(7);
    expect(ctx.unwrap(object, FrozenImpl)).toBe(instance);
    expect(ctx.project(FrozenImpl, instance)).toBe(object);
  });

  it('projects default operations without implementation methods', () => {
    const interfaces = new BindingWorld([jsonIDL]);
    const realm = new Realm();
    const registration = interfaces.register(realm);
    const implementation = registration.construct(JsonImpl);
    const object = interfaces.project(implementation);
    if (!object) throw new Error('JSONExample was not projected');
    const toJSON = Reflect.get(object, 'toJSON') as CallableFunction;

    expect(Reflect.apply(toJSON, object, [])).toEqual({ value: 12 });
  });

  it('requires explicit bindings for unnamed operations', () => {
    const interfaces = new BindingWorld([unnamedOperationIDL]);
    const realm = new Realm();

    expect(() => interfaces.register(realm)).toThrow(
      'Web IDL UnnamedOperationExample.operation has no binding',
    );
    expect(() => interfaces.register(realm)).toThrow(
      'Web IDL UnnamedOperationExample.operation has no binding',
    );
  });

  it('does not treat a legacy property hook as unnamed invocation steps', () => {
    const interfaces = new BindingWorld([unnamedHookOperationIDL]);

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
    const interfaces = new BindingWorld(
      [parentIDL, childIDL],
      {
        capabilities: [
          capability.for(parentIDL, 'parent'),
          capability.for(childIDL, 'child'),
        ],
      },
    );
    const registration = interfaces.register(new Realm());
    const child = registration.createPlatformRecord(childIDL);

    expect(registration.getObjectRecord(child.platformObject))
      .toBe(child);
    expect(child.primaryInterface.definition).toBe(childIDL);
    expect(registration.getCapability(
      child.primaryInterface.definition,
      capability,
    )).toBe('child');
    expect(registration.getCapability(parentIDL, capability))
      .toBe('parent');
  });

  it('shares capability values across realms without leaking between worlds', () => {
    const definition = defineInterface({ name: 'SharedCapability', members: [] });
    const definitions = [definition];
    const capability = defineCapability<{ owner: string; }>('Test');
    const firstValue = { owner: 'first' };
    const secondValue = { owner: 'second' };
    const firstWorld = new BindingWorld(definitions, {
      capabilities: [capability.for(definition, firstValue)],
    });
    const secondWorld = new BindingWorld(definitions, {
      capabilities: [capability.for(definition, secondValue)],
    });
    const unconfiguredWorld = new BindingWorld(definitions);
    const first = firstWorld.register(new Realm());
    const another = firstWorld.register(new Realm());
    const second = secondWorld.register(new Realm());
    const unconfigured = unconfiguredWorld.register(new Realm());

    expect(first.getCapability(definition, capability)).toBe(firstValue);
    expect(another.getCapability(definition, capability)).toBe(firstValue);
    expect(second.getCapability(definition, capability)).toBe(secondValue);
    expect(unconfigured.getCapability(definition, capability)).toBeUndefined();
  });

  it('requires an implementation creator to instantiate a declared interface', () => {
    const interfaceIDL = defineInterface({
      name: 'DeclarationOnly', exposed: '*', members: [],
    });
    const realm = new Realm();
    const ctx = new BindingWorld([interfaceIDL]).register(realm);
    ctx.install(realm.global);

    expect(Reflect.get(realm.global, interfaceIDL.name)).toBeTypeOf('function');
    expect(() => ctx.createPlatformRecord(interfaceIDL))
      .toThrow('Interface DeclarationOnly has no implementation creation steps');
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
      members: [ctor([], {
        invoke() { publicConstructions++; },
      })],
    });
    const interfaces = new BindingWorld([interfaceIDL]);
    const realm = new Realm();
    const registration = interfaces.register(realm);
    registration.install(realm.global);

    const internal = registration.createPlatformRecord(interfaceIDL);

    expect(internal.primaryInterface.definition).toBe(interfaceIDL);
    expect(internal.realm).toBe(realm);
    expect(internal.implInst).toBeInstanceOf(InternalNewImpl);
    expect(internal.platformObject).not.toBe(internal.implInst);
    expect(allocations).toBe(1);
    expect(publicConstructions).toBe(0);

    const Constructor = Reflect.get(realm.global, interfaceIDL.name) as {
      new(): object;
    };
    const constructed = new Constructor();

    expect(registration.getObjectRecord(constructed)
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

    expect(() => new BindingWorld(
      [restrictedIDL],
      {
        capabilities: [
          capability.for(foreignIDL, 'foreign'),
        ],
      },
    )).toThrow('targets unknown interface definition RestrictedCapability');
    expect(() => new BindingWorld(
      [restrictedIDL],
      {
        capabilities: [
          capability.for(restrictedIDL, 'first'),
          capability.for(restrictedIDL, 'second'),
        ],
      },
    )).toThrow('has a duplicate Restricted capability registration');

    const registration = new BindingWorld(
      [restrictedIDL],
      {
        capabilities: [
          capability.for(restrictedIDL, 'registered'),
        ],
      },
    ).register(new Realm());

    expect(registration.isInterfaceExposed(restrictedIDL)).toBe(false);
    expect(() => registration.createPlatformRecord(restrictedIDL)).toThrow(
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
