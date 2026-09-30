import { describe, expect, it, vi } from 'vitest';

import { TestRealm as Realm } from './test-realm';
import {
  arg, atArg, attr, BindingWorld, ctor,
  defineProxyObject, defineInterface, idlType, impl, invokeWith, namedGetter, op,
  reference, roAttr, xattr, type BindingContext,
} from '../../src/web-idl/index';
import { createEnvironment, type TestEnvironment } from '../js-engine/execution-fixture';
import { TypeError as InternalTypeError } from '../../src/infra/exceptions';

describe('Web IDL binding worlds and realm registration', () => {
  it('composes the environment once per realm registration', () => {
    const realm = new Realm();
    const env = createEnvironment(realm);
    const world = new BindingWorld<TestEnvironment>([exampleIDL]);
    const compose = vi.fn((context: BindingContext) => {
      expect(context.realm).toBe(realm);
      expect(world.forRealm(realm)).toBeUndefined();
      env.exec.Promise = context.Promise;
      return env;
    });
    const first = world.register(realm, compose);
    const second = world.register(realm, compose);

    expect(second).toBe(first);
    expect(world.forRealm(realm)).toBe(first);
    expect(compose).toHaveBeenCalledOnce();
    expect(compose.mock.calls[0]![0]).toBe(first);
    expect(first.getEnvironment()).toBe(env);
    expect(first.getEnvironment().exec.Promise).toBe(first.Promise);
  });

  it('allows registration to retry after environment composition fails', () => {
    const realm = new Realm();
    const world = new BindingWorld([exampleIDL]);
    const failure = new Error('Environment composition failed');

    expect(() => world.register(realm, () => { throw failure; })).toThrow(failure);
    expect(world.forRealm(realm)).toBeUndefined();

    const env = createEnvironment(realm);
    const context = world.register(realm, () => env);
    expect(world.forRealm(realm)).toBe(context);
    expect(context.getEnvironment()).toBe(env);
    expect(world.project(context.construct(ExampleImpl))).toBeDefined();
  });

  it('keeps failed declaration setup out of the realm registry', () => {
    class IncompleteImpl {}
    const world = new BindingWorld([defineInterface({
      name: 'Incomplete', implementation: impl(IncompleteImpl),
      members: [op('read', idlType.long, [])],
    })]);
    const realm = new Realm();

    expect(() => world.register({ realm })).toThrow('operation read has no implementation');
    expect(world.forRealm(realm)).toBeUndefined();
    expect(() => world.register({ realm })).toThrow('operation read has no implementation');
  });

  it('retains a realm-only environment when no execution facilities are needed', () => {
    const env = { realm: new Realm() };
    const ctx = new BindingWorld([]).register(env);
    expect(ctx.getEnvironment()).toBe(env);
    expect(ctx.realm).toBe(env.realm);
  });

  it('rejects a factory environment belonging to a different realm', () => {
    const realm = new Realm();
    const world = new BindingWorld([]);
    expect(() => world.register(realm, () => ({ realm: new Realm() })))
      .toThrow('The binding environment belongs to a different realm');
    expect(world.forRealm(realm)).toBeUndefined();
    expect(world.register({ realm }).getEnvironment().realm).toBe(realm);
  });

  it('makes the environment available only after its composition finishes', () => {
    const realm = new Realm();
    const world = new BindingWorld([]);
    const ctx = world.register(realm, (context) => {
      expect(context.realm).toBe(realm);
      expect(() => context.getEnvironment()).toThrow('The binding environment is still being composed');
      return { realm };
    });
    expect(ctx.getEnvironment().realm).toBe(realm);
  });

  it('shares platform-object identity across realm registrations', () => {
    const interfaces = new BindingWorld([exampleIDL]);
    const firstRealm = new Realm();
    const secondRealm = new Realm();
    const first = interfaces.register({ realm: firstRealm });
    const second = interfaces.register({ realm: secondRealm });

    first.install(firstRealm.global);
    second.install(secondRealm.global);

    const implementation = first.construct(ExampleImpl);
    const object = interfaces.project(implementation);
    if (!object) throw new Error('Example was not projected');

    expect(interfaces.register({ realm: firstRealm })).toBe(first);
    expect(interfaces.unwrap(object)).toBe(implementation);
    expect(interfaces.getRealm(object)).toBe(firstRealm);
    expect(second.unwrap(object, ExampleImpl))
      .toBe(implementation);
    expect(Reflect.get(firstRealm.global, 'Example')).not
      .toBe(Reflect.get(secondRealm.global, 'Example'));
  });

  it('preserves proxy values while resolving member calls to their current platform receiver', () => {
    const object = Object.freeze({});
    let target: object | undefined;
    class ReceiverImpl {
      constructor(public value: string) {}
      echo(value: object): object { return value; }
    }
    const world = new BindingWorld([
      defineProxyObject({
        name: 'ProxyObject',
        is: (value) => value === object,
        resolveReceiver: () => target,
      }),
      defineInterface({
        name: 'Receiver', exposed: '*', implementation: impl(ReceiverImpl),
        members: [
          attr('value', idlType.DOMString),
          op('echo', reference('ProxyObject'), [arg('value', reference('ProxyObject'))]),
        ],
      }),
    ]);
    const realmA = new Realm();
    const realmB = new Realm();
    const a = world.register({ realm: realmA });
    const b = world.register({ realm: realmB });
    a.install(realmA.global);
    b.install(realmB.global);
    target = a.project(ReceiverImpl, new ReceiverImpl('first'));
    const prototype = Reflect.getPrototypeOf(target)!;
    const descriptor = Reflect.getOwnPropertyDescriptor(prototype, 'value')!;
    const echo = Reflect.get(target, 'echo') as (value: object) => object;

    expect(Reflect.apply(descriptor.get!, object, [])).toBe('first');
    expect(Reflect.apply(echo, object, [object])).toBe(object);
    expect(() => Reflect.apply(echo, object, [{}])).toThrow(realmA.intrinsics.typeError);
    expect(Object.hasOwn(realmA.global, 'ProxyObject')).toBe(false);
    expect(Object.hasOwn(realmB.global, 'ProxyObject')).toBe(false);

    const replacement = new ReceiverImpl('second');
    target = b.project(ReceiverImpl, replacement);
    expect(Reflect.apply(descriptor.get!, object, [])).toBe('second');
    Reflect.apply(descriptor.set!, object, ['changed']);
    expect(replacement.value).toBe('changed');
    expect(Reflect.apply(echo, object, [object])).toBe(object);

    target = undefined;
    expect(() => { Reflect.apply(descriptor.get!, object, []); }).toThrow(realmA.intrinsics.typeError);
  });

  it('preserves the origin of a lazily projected implementation', () => {
    const interfaces = new BindingWorld([exampleIDL]);
    const firstRealm = new Realm();
    const secondRealm = new Realm();
    const first = interfaces.register({ realm: firstRealm });
    const second = interfaces.register({ realm: secondRealm });
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
    const receiverBinding = bindings.register({ realm: receiverRealm });
    const functionBinding = bindings.register({ realm: functionRealm });
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
    const receiverContext = world.register({ realm: receiverRealm });
    world.register({ realm: methodRealm }).install(methodRealm.global);
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
        public context: BindingContext,
        public global: object,
        public semantic: string,
        public positioned: string,
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
    const registration = interfaces.register({ realm });
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
    ]).register({ realm });
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
    const firstContext = first.register({ realm });
    const secondContext = second.register({ realm });
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
    const ctx = world.register({ realm: new Realm() });
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
    const registration = interfaces.register({ realm });
    const implementation = registration.construct(JsonImpl);
    const object = interfaces.project(implementation);
    if (!object) throw new Error('JSONExample was not projected');
    const toJSON = Reflect.get(object, 'toJSON') as CallableFunction;

    expect(Reflect.apply(toJSON, object, [])).toEqual({ value: 12 });
  });

  it('requires explicit bindings for unnamed operations', () => {
    const interfaces = new BindingWorld([unnamedOperationIDL]);
    const realm = new Realm();

    expect(() => interfaces.register({ realm })).toThrow(
      'Web IDL UnnamedOperationExample.operation has no binding',
    );
    expect(() => interfaces.register({ realm })).toThrow(
      'Web IDL UnnamedOperationExample.operation has no binding',
    );
  });

  it('does not treat a legacy property hook as unnamed invocation steps', () => {
    const interfaces = new BindingWorld([unnamedHookOperationIDL]);

    expect(() => interfaces.register({ realm: new Realm() })).toThrow(
      'Web IDL UnnamedHookOperationExample.operation has no binding',
    );
  });

  it('keeps platform identities within their world when declarations are shared', () => {
    const firstWorld = new BindingWorld([exampleIDL]);
    const secondWorld = new BindingWorld([exampleIDL]);
    const first = firstWorld.register({ realm: new Realm() });
    const another = firstWorld.register({ realm: new Realm() });
    const second = secondWorld.register({ realm: new Realm() });
    const original = first.createPlatformRecord(exampleIDL);
    const other = second.createPlatformRecord(exampleIDL);

    expect(another.unwrap(original.platformObject, ExampleImpl)).toBe(original.implInst);
    expect(second.unwrap(original.platformObject, ExampleImpl)).toBeUndefined();
    expect(first.unwrap(other.platformObject, ExampleImpl)).toBeUndefined();
    expect(other.implInst).not.toBe(original.implInst);
  });

  it('requires an implementation creator to instantiate a declared interface', () => {
    const interfaceIDL = defineInterface({
      name: 'DeclarationOnly', exposed: '*', members: [],
    });
    const realm = new Realm();
    const ctx = new BindingWorld([interfaceIDL]).register({ realm });
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
      members: [ctor([], { invoke() { publicConstructions++; } })],
    });
    const interfaces = new BindingWorld([interfaceIDL]);
    const realm = new Realm();
    const registration = interfaces.register({ realm });
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

  it('rejects foreign definitions and unexposed interfaces during allocation', () => {
    class RestrictedImpl {}
    const restrictedIDL = defineInterface({
      name: 'RestrictedInterface',
      exposed: ['Worker'],
      implementation: impl(RestrictedImpl),
      members: [],
    });
    const foreignIDL = defineInterface({ name: restrictedIDL.name, members: [] });
    const registration = new BindingWorld([restrictedIDL]).register({ realm: new Realm() });

    expect(() => registration.createPlatformRecord(foreignIDL)).toThrow();
    expect(registration.isInterfaceExposed(restrictedIDL)).toBe(false);
    expect(() => registration.createPlatformRecord(restrictedIDL)).toThrow(
      'Interface RestrictedInterface is not exposed in this realm',
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
  members: [op(undefined, idlType.object,
    [arg('name', idlType.DOMString)],
    { special: 'getter' },
  )],
});

const unnamedHookOperationIDL = defineInterface({
  name: 'UnnamedHookOperationExample',
  exposed: '*',
  implementation: impl(ExampleImpl),
  members: [op(undefined, idlType.object,
    [arg('name', idlType.DOMString)],
    namedGetter(() => new Set(['name'])),
  )],
});
