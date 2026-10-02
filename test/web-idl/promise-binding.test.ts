import { describe, expect, it } from 'vitest';

import { TestRealm as Realm } from './test-realm';
import { createDOMException } from '../../src/web-idl/core/dom-exception';
import { DefinitionAssembly } from '../../src/web-idl/assembly';
import { endOfIteration } from '../../src/web-idl/async-sequence';
import { RealmBinding } from '../../src/web-idl/realm-binding';
import { webIDLCommonDefinitions } from '../../src/web-idl/common-definitions';
import {
  arg, asyncIter, defineCallbackFunction, defineDictionary, defineInterface, dictMember,
  idlType, impl, implementationType, op, promise as promiseType,
  reference, roAttr,
  type AttributeMember, type OperationMember,
} from '../../src/web-idl/core/index';
import { BindingWorld } from '../../src/web-idl/binding-world';
import { TypeError as TypeErrorRequest } from '../../src/infra/exceptions';
import { internalType, type InternalPromise, type InternalPromiseWithResolvers } from '../../src/infra/promises';
import { registerDefinitionBindings } from '../../src/web-idl/implementation-binding';
import { PromiseCarrier } from '../../src/web-idl/promise';

describe('Web IDL promise member binding', () => {
  it('projects an ordinary implementation promise once in its receiver realm', async () => {
    const fixture = createOrdinaryPromiseFixture();
    const { first, second, owner, implementation } = fixture;
    const borrowed = Reflect.get(fixture.foreignPrototype, 'read') as CallableFunction;
    const result = Reflect.apply(borrowed, owner, []) as Promise<unknown>;
    const property = Reflect.get(owner, 'result') as Promise<unknown>;
    const ownResult = call(owner, 'read') as Promise<unknown>;
    const observed = Promise.all([result, property, ownResult].map((promise) =>
      promise.catch((reason: unknown) => reason)));
    const child = new PromiseChildImpl();
    implementation.pending.resolve(child);
    const [projected] = await observed;

    expect(result).toBe(property);
    expect(result).toBe(ownResult);
    expect(result).toBeInstanceOf(first.intrinsics.promise.constructor);
    expect(result).not.toBeInstanceOf(second.intrinsics.promise.constructor);
    expect(projected).toBe(fixture.bindings.project(child));
    expect(projected).toBeInstanceOf(Reflect.get(first.global, 'PromiseChild'));
  });

  it('realizes a shared rejection request once and preserves author errors', async () => {
    const fixture = createOrdinaryPromiseFixture();
    const { first, owner, implementation } = fixture;
    const request = new TypeErrorRequest('stream failed');
    const borrowed = Reflect.get(fixture.foreignPrototype, 'reject') as CallableFunction;
    const firstResult = call(owner, 'read') as Promise<unknown>;
    const secondResult = Reflect.apply(borrowed, owner, [request]) as Promise<unknown>;
    const observed = Promise.all([
      firstResult.catch((reason: unknown) => reason),
      secondResult.catch((reason: unknown) => reason),
      new Promise((resolve) => { implementation.pending.promise.observe(resolve, resolve); }),
    ]);
    implementation.pending.reject(request);
    const [firstReason, secondReason] = await observed;

    expect(firstReason).toBeInstanceOf(first.intrinsics.typeError);
    expect(firstReason).not.toBe(request);
    expect(secondReason).toBe(firstReason);
    const authorError = new fixture.second.intrinsics.typeError('author failed');
    await expect(call(owner, 'reject', authorError)).rejects.toBe(authorError);
  });

  it.each(['promise', 'thenable'] as const)('imports %s arguments and callback results as internal promises', async (kind) => {
    const fixture = createOrdinaryPromiseFixture();
    const child = new PromiseChildImpl();
    const projected = fixture.firstBinding.project(PromiseChildImpl, child);

    const input = () => kind === 'promise'
      ? Promise.resolve(projected)
      : { then(resolve: (value: object) => void) { resolve(projected); } };
    await expect(call(fixture.owner, 'consume', input())).resolves.toBe(7);
    await expect(call(fixture.owner, 'invoke', input)).resolves.toBe(7);
    expect(fixture.implementation.received).toBe(child);
    const authorError = new fixture.second.intrinsics.typeError('callback failed');
    await expect(call(fixture.owner, 'invoke', () => { throw authorError; }))
      .rejects.toBe(authorError);
  });

  it('rejects an incoming fulfillment that does not match its declared interface', async () => {
    const fixture = createOrdinaryPromiseFixture();
    await expect(call(fixture.owner, 'consume', Promise.resolve(4)))
      .rejects.toBeInstanceOf(fixture.first.intrinsics.typeError);
    expect(fixture.implementation.received).toBeUndefined();
  });

  it('projects a plain dictionary fulfillment and its interface-valued member', async () => {
    const fixture = createOrdinaryPromiseFixture();
    const child = new PromiseChildImpl();
    const result = call(fixture.owner, 'readRecord') as Promise<object>;
    fixture.implementation.pending.resolve(child);
    const record = await result;

    expect(Object.getPrototypeOf(record)).toBe(fixture.first.intrinsics.objectPrototype);
    expect(Reflect.get(record, 'value')).toBe(fixture.bindings.project(child));
    expect(Reflect.get(record, 'value')).toBeInstanceOf(Reflect.get(fixture.first.global, 'PromiseChild'));
    expect(record).toHaveProperty('done', false);
    expect(record).toHaveProperty('optional', undefined);
    expect(Object.hasOwn(record, 'absent')).toBe(false);
  });

  it.each([false, true])('adapts promises from async iterator steps (borrowed: %s)', async (borrowed) => {
    const fixture = createOrdinaryPromiseFixture();
    const child = new PromiseChildImpl();
    const iterator = call(fixture.owner, 'values') as object;
    const methodOwner = borrowed ? Reflect.apply(
      Reflect.get(fixture.foreignPrototype, 'values') as CallableFunction, fixture.owner, [],
    ) as object : iterator;
    const next = Reflect.get(methodOwner, 'next') as CallableFunction;
    const return_ = Reflect.get(methodOwner, 'return') as CallableFunction;
    const methodRealm = borrowed ? fixture.second : fixture.first;
    fixture.implementation.pending.resolve(child);

    const pending = Reflect.apply(next, iterator, []) as Promise<IteratorResult<object>>;
    expect(pending).toBeInstanceOf(methodRealm.intrinsics.promise.constructor);
    const first = await pending;
    expect(Object.getPrototypeOf(first)).toBe(methodRealm.intrinsics.objectPrototype);
    expect(first.done).toBe(false);
    expect(first.value).toBe(fixture.bindings.project(child));
    await expect(Reflect.apply(next, iterator, [])).resolves.toEqual({ done: true, value: undefined });

    const other = call(fixture.owner, 'values') as object;
    await expect(Reflect.apply(return_, other, ['stop'])).resolves.toEqual({ done: true, value: 'stop' });
    expect(fixture.implementation.returned).toBe('stop');
  });

  it.each([
    { borrowed: false, stamped: true }, { borrowed: true, stamped: true },
    { borrowed: false, stamped: false }, { borrowed: true, stamped: false },
  ])('projects async iterator items before native promise resolution ($borrowed borrowed, $stamped stamped)', async ({ borrowed, stamped }) => {
    const calls: string[] = [];
    class ItemImpl {
      get value(): number { return 7; }
      get then(): undefined {
        calls.push('implementation.then');
        return undefined;
      }
    }
    class ItemsImpl {
      constructor(public item: ItemImpl, public P: typeof InternalPromise) {}
      createIterator() {
        return { next: () => this.P.try(() => this.item, internalType<ItemImpl>('ItemImpl')) };
      }
    }
    const itemIDL = defineInterface({
      name: 'Item', exposed: '*', implementation: impl(ItemImpl),
      members: [roAttr('value', idlType.long)],
    });
    const itemsIDL = defineInterface({
      name: 'Items', exposed: '*', implementation: impl(ItemsImpl),
      members: [asyncIter(reference('Item'), { create: 'createIterator' })],
    });
    const realm = new Realm();
    const world = new BindingWorld([itemIDL, itemsIDL]);
    const binding = world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const item = stamped ? binding.construct(ItemImpl) : new ItemImpl();
    const owner = binding.project(ItemsImpl, new ItemsImpl(item, realm.Promise));
    const iterator = call(owner, 'values') as object;
    const methodRealm = borrowed ? new Realm() : realm;
    const methodOwner = borrowed ? call(world.register(methodRealm, (ctx) => ({ realm: ctx.realm })).project(
      ItemsImpl, new ItemsImpl(item, realm.Promise),
    ), 'values') as object : iterator;
    const pending = Reflect.apply(
      Reflect.get(methodOwner, 'next') as CallableFunction, iterator, [],
    ) as Promise<IteratorResult<object, undefined>>;
    expect(pending).toBeInstanceOf(methodRealm.intrinsics.promise.constructor);
    const result = await pending;

    expect(Reflect.getPrototypeOf(result)).toBe(methodRealm.intrinsics.objectPrototype);
    expect(result.done).toBe(false);
    expect(world.getRealm(result.value!)).toBe(realm);
    expect(result.value).toBe(binding.project(ItemImpl, item));
    expect(calls).toEqual([]);
  });

  it('omits iterator return unless the declaration requests it', async () => {
    const definition = defineInterface({
      name: 'AsyncValues',
      exposed: '*',
      implementation: impl(OrdinaryPromiseOwnerImpl),
      members: [asyncIter(childType, { create: 'createIterator' })],
    });
    const binding = new BindingWorld([definition, promiseChildIDL]).register(new Realm(), (ctx) => ({ realm: ctx.realm }));
    const implementation = new OrdinaryPromiseOwnerImpl(binding.Promise);
    const owner = binding.project(OrdinaryPromiseOwnerImpl, implementation);
    const iterator = call(owner, 'values') as object;
    const child = new PromiseChildImpl();

    expect('return' in iterator).toBe(false);
    expect('createIterator' in owner).toBe(false);
    implementation.pending.resolve(child);
    await expect(call(iterator, 'next')).resolves.toEqual({
      done: false,
      value: binding.project(PromiseChildImpl, child),
    });
    await expect(call(iterator, 'next')).resolves.toEqual({ done: true, value: undefined });
  });

  it('projects promise-valued attributes and operations into their realm', async () => {
    class PromiseOwnerImpl {}
    const resolvedAttribute = attribute('resolved', promiseType(idlType.long));
    const rejectedAttribute = attribute('rejected', promiseType(idlType.long));
    const resolvedOperation = operation('resolve', promiseType(idlType.long));
    const rejectedOperation = operation('reject', promiseType(idlType.long));
    const definition = defineInterface({
      name: 'PromiseOwner',
      exposed: ['Window'],
      members: [
        resolvedAttribute,
        rejectedAttribute,
        resolvedOperation,
        rejectedOperation,
      ],
    });

    const reason = new Error('implementation failed');

    const realm = new Realm();
    const binding = new RealmBinding(
      new DefinitionAssembly([definition]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    const interfaceBinding = binding.getDefinitionBinding(binding.resolveInterface(definition.name));
    interfaceBinding.createImplementation = () => new PromiseOwnerImpl();
    interfaceBinding.getOrCreateMemberRecord(resolvedAttribute).attributeSteps = {
      get: () => PromiseCarrier.fromIDL(4, idlType.long, binding.defaultConversionContext),
    };
    interfaceBinding.getOrCreateMemberRecord(rejectedAttribute).attributeSteps = {
      get() { throw reason; },
    };
    interfaceBinding.getOrCreateMemberRecord(resolvedOperation).operationSteps = () => PromiseCarrier.fromIDL(5, idlType.long, binding.defaultConversionContext);
    interfaceBinding.getOrCreateMemberRecord(rejectedOperation).operationSteps = () => {
      throw reason;
    };
    const object = binding.createPlatformRecord(binding.resolveInterface('PromiseOwner')).platformObject!;
    const resolvedProperty = Reflect.get(object, 'resolved') as Promise<unknown>;
    const rejectedProperty = Reflect.get(object, 'rejected') as Promise<unknown>;
    const resolvedCall = call(object, 'resolve') as Promise<unknown>;
    const rejectedCall = call(object, 'reject') as Promise<unknown>;

    for (const promise of [
      resolvedProperty,
      rejectedProperty,
      resolvedCall,
      rejectedCall,
    ]) {
      expect(promise).toBeInstanceOf(realm.intrinsics.promise.constructor);
      expect(promise).not.toBeInstanceOf(Promise);
    }
    await expect(resolvedProperty).resolves.toBe(4);
    await expect(resolvedCall).resolves.toBe(5);
    await expect(rejectedProperty).rejects.toBe(reason);
    await expect(rejectedCall).rejects.toBe(reason);
  });

  it('turns receiver errors from promise-returning operations into rejections', async () => {
    class PromiseReceiverImpl {}
    const read = operation('read', promiseType(idlType.long));
    const definition = defineInterface({
      name: 'PromiseReceiver',
      exposed: ['Window'],
      members: [read],
    });
    const realm = new Realm();

    const binding = new RealmBinding(
      new DefinitionAssembly([definition]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    binding.getDefinitionBinding(binding.resolveInterface(definition.name)).createImplementation = () => new PromiseReceiverImpl();
    binding.getDefinitionBinding(binding.resolveInterface(definition.name)).getOrCreateMemberRecord(read).operationSteps = () => {
      throw new Error('unreachable');
    };
    const object = binding.createPlatformRecord(binding.resolveInterface('PromiseReceiver')).platformObject!;
    const method = Reflect.get(object, 'read') as CallableFunction;
    const promise = Reflect.apply(method, {}, []) as Promise<unknown>;

    expect(promise).toBeInstanceOf(realm.intrinsics.promise.constructor);
    await expect(promise).rejects.toBeInstanceOf(realm.intrinsics.typeError);
  });

  it('realizes only requested DOMException rejections in the operation realm', async () => {
    class PromiseExceptionSourceImpl {}
    const reject = operation('reject', promiseType(idlType.undefined));
    const rejectArbitrary = operation(
      'rejectArbitrary',
      promiseType(idlType.undefined),
    );
    const definition = defineInterface({
      name: 'PromiseExceptionSource',
      exposed: ['Window'],
      members: [reject, rejectArbitrary],
    });
    const realm = new Realm();

    const binding = new RealmBinding(
      new DefinitionAssembly([...webIDLCommonDefinitions, definition]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    const interfaceBinding = binding.getDefinitionBinding(binding.resolveInterface(definition.name));
    interfaceBinding.createImplementation = () => new PromiseExceptionSourceImpl();
    registerDefinitionBindings(binding);
    interfaceBinding.getOrCreateMemberRecord(reject).operationSteps = () => PromiseCarrier.rejected(createDOMException('NotAllowedError', 'requested rejection'), idlType.undefined, binding.realm, binding.realizeException);
    const arbitraryReason = { arbitrary: true };
    interfaceBinding.getOrCreateMemberRecord(rejectArbitrary).operationSteps = () => PromiseCarrier.rejected(arbitraryReason, idlType.undefined, binding.realm, binding.realizeException);
    const object = binding.createPlatformRecord(binding.resolveInterface('PromiseExceptionSource')).platformObject!;
    const promise = call(object, 'reject') as Promise<unknown>;

    expect(promise).toBeInstanceOf(realm.intrinsics.promise.constructor);
    await expect(promise).rejects.toMatchObject({
      message: 'requested rejection',
      name: 'NotAllowedError',
    });
    await expect(promise).rejects.toBeInstanceOf(binding.DOMException);
    await expect(call(object, 'rejectArbitrary')).rejects.toBe(arbitraryReason);
  });
});

function attribute(
  name: string,
  type: AttributeMember['type'],
): AttributeMember {
  return { kind: 'attribute', name, readonly: true, type };
}

function operation(
  name: string,
  returns: OperationMember['returns'],
): OperationMember {
  return { arguments: [], kind: 'operation', name, returns };
}

function call(object: object, name: string, ...args: unknown[]): unknown {
  const method = Reflect.get(object, name) as unknown;
  if (typeof method !== 'function') throw new Error(`${name} is not callable`);
  return Reflect.apply(method, object, args);
}

function createOrdinaryPromiseFixture() {
  const bindings = new BindingWorld([
    promiseOwnerIDL, promiseChildIDL, promiseCallbackIDL, promiseResultIDL,
  ]);
  const first = new Realm();
  const second = new Realm();
  const firstBinding = bindings.register(first, (ctx) => ({ realm: ctx.realm }));
  const secondBinding = bindings.register(second, (ctx) => ({ realm: ctx.realm }));
  firstBinding.install(first.global);
  secondBinding.install(second.global);
  const implementation = new OrdinaryPromiseOwnerImpl(firstBinding.Promise);
  const owner = firstBinding.project(OrdinaryPromiseOwnerImpl, implementation);
  const foreignConstructor = Reflect.get(second.global, 'OrdinaryPromiseOwner') as { prototype: object; };
  return { bindings, first, second, firstBinding, implementation, owner, foreignPrototype: foreignConstructor.prototype };
}

class OrdinaryPromiseOwnerImpl {
  pending: InternalPromiseWithResolvers<PromiseChildImpl>;
  #Promise: typeof InternalPromise;
  received: PromiseChildImpl | undefined;
  returned: unknown;

  constructor(P: typeof InternalPromise) {
    this.#Promise = P;
    this.pending = P.withResolvers(childType);
  }

  get result(): InternalPromise<PromiseChildImpl> { return this.pending.promise; }
  read(): InternalPromise<PromiseChildImpl> { return this.pending.promise; }
  readRecord(): InternalPromise<{ value: PromiseChildImpl; done: boolean; optional: undefined; }> {
    return this.pending.promise.then((value) => ({ value, done: false, optional: undefined }), undefined, implementationType<{ value: PromiseChildImpl; done: boolean; optional: undefined; } | { value: PromiseChildImpl; done: false; optional: undefined; }>(reference('PromiseResult')));
  }
  createIterator(): OrdinaryPromiseIterator {
    let visited = false;
    return {
      next: () => {
        if (visited) return this.#Promise.resolve(endOfIteration, internalType<typeof endOfIteration>('endOfIteration'));
        visited = true;
        return this.pending.promise;
      },
      return: (value) => this.close(value),
    };
  }

  close(value: unknown): InternalPromise<void> {
    this.returned = value;
    return this.#Promise.resolve(undefined, idlType.undefined);
  }
  reject(reason: unknown): InternalPromise<PromiseChildImpl> {
    return this.#Promise.reject(reason, childType);
  }

  consume(value: InternalPromise<PromiseChildImpl>): InternalPromise<number> {
    return value.then((child) => {
      this.received = child;
      return child.value;
    }, undefined, idlType.long);
  }

  invoke(callback: () => InternalPromise<PromiseChildImpl>): InternalPromise<number> {
    return this.consume(callback());
  }
}

class PromiseChildImpl {
  get value(): number { return 7; }
}

type OrdinaryPromiseIterator = {
  next(): InternalPromise<PromiseChildImpl | typeof endOfIteration>;
  return(value: unknown): InternalPromise<void>;
};

const childType = implementationType<PromiseChildImpl>(reference('PromiseChild'));
const promiseChildIDL = defineInterface({
  name: 'PromiseChild', exposed: '*', implementation: impl(PromiseChildImpl),
  members: [roAttr('value', idlType.long)],
});
const promiseCallbackIDL = defineCallbackFunction({
  name: 'PromiseCallback', returns: promiseType(childType), arguments: [],
});
const promiseResultIDL = defineDictionary({
  name: 'PromiseResult',
  members: [
    dictMember('value', childType), dictMember('done', idlType.boolean),
    dictMember('optional', idlType.any), dictMember('absent', idlType.any),
  ],
});
const promiseOwnerIDL = defineInterface({
  name: 'OrdinaryPromiseOwner', exposed: '*', implementation: impl(OrdinaryPromiseOwnerImpl),
  members: [
    roAttr('result', promiseType(childType)),
    op('read', promiseType(childType)),
    op('readRecord', promiseType(reference('PromiseResult'))),
    op('reject', promiseType(childType), [arg('reason', idlType.any)]),
    op('consume', promiseType(idlType.long), [arg('value', promiseType(childType))]),
    op('invoke', promiseType(idlType.long), [arg('callback', reference('PromiseCallback'))]),
    asyncIter(childType, {
      create: 'createIterator',
      return: true,
    }),
  ],
});
