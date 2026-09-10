import { describe, expect, it } from 'vitest';

import { TestRealm as Realm } from './test-realm';
import { createDOMException } from '../../src/web-idl/exceptions/dom-exception-core';
import { assembleDefinitions } from '../../src/web-idl/assembly';
import { endOfIteration } from '../../src/web-idl/async-sequence';
import { RealmBinding } from '../../src/web-idl/binding';
import { webIDLCommonDefinitions } from '../../src/web-idl/common-definitions';
import {
  arg, asyncIter, defineCallbackFunction, defineDictionary, defineInterface, dictMember,
  idlType, impl, op, promise as promiseType,
  reference, roAttr,
  type AttributeMember, type OperationMember,
} from '../../src/web-idl/declaration/index';
import { createBindings } from '../../src/web-idl/registration';
import { TypeError as TypeErrorRequest } from '../../src/js-engine/simple-exception';
import type { PromiseValue } from '../../src/js-engine/index';
import { registerDefinitionBindings } from '../../src/web-idl/projection';
import { ImplementationRegistry } from '../../src/web-idl/registry';
import { PlatformObjectRegistry } from '../../src/web-idl/platform-object';
import {
  createRejectedPromise, createResolvedPromise,
} from '../../src/web-idl/promise';

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
    expect(projected).toBe(fixture.bindings.getPlatformObject(child));
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
      implementation.pending.promise.catch((reason: unknown) => reason),
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
    const projected = fixture.firstBinding.context.project(PromiseChildImpl, child);

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
    expect(Reflect.get(record, 'value')).toBe(fixture.bindings.getPlatformObject(child));
    expect(Reflect.get(record, 'value')).toBeInstanceOf(Reflect.get(fixture.first.global, 'PromiseChild'));
    expect(record).toHaveProperty('done', false);
    expect(record).toHaveProperty('optional', undefined);
    expect(Object.hasOwn(record, 'absent')).toBe(false);
  });

  it('adapts ordinary promises from async iterator next and return steps', async () => {
    const fixture = createOrdinaryPromiseFixture();
    const child = new PromiseChildImpl();
    const iterator = call(fixture.owner, 'values') as object;
    fixture.implementation.pending.resolve(child);

    const first = await call(iterator, 'next') as IteratorResult<object>;
    expect(first.done).toBe(false);
    expect(first.value).toBe(fixture.bindings.getPlatformObject(child));
    await expect(call(iterator, 'next')).resolves.toEqual({ done: true, value: undefined });

    const other = call(fixture.owner, 'values') as object;
    await expect(call(other, 'return', 'stop')).resolves.toEqual({ done: true, value: 'stop' });
    expect(fixture.implementation.returned).toBe('stop');
  });

  it('projects promise-valued attributes and operations into their realm', async () => {
    const resolvedAttribute = attribute('resolved', promiseType(idlType.long));
    const rejectedAttribute = attribute('rejected', promiseType(idlType.long));
    const resolvedOperation = operation('resolve', promiseType(idlType.long));
    const rejectedOperation = operation('reject', promiseType(idlType.long));
    const interface_ = defineInterface({
      name: 'PromiseOwner',
      exposed: ['Window'],
      members: [
        resolvedAttribute,
        rejectedAttribute,
        resolvedOperation,
        rejectedOperation,
      ],
    });
    const implementations = new ImplementationRegistry();
    const reason = new Error('implementation failed');
    implementations.setAttributeSteps(resolvedAttribute, {
      get: () => createResolvedPromise(4, idlType.long, binding),
    });
    implementations.setAttributeSteps(rejectedAttribute, {
      get() { throw reason; },
    });
    implementations.setOperationSteps(
      resolvedOperation,
      () => createResolvedPromise(5, idlType.long, binding),
    );
    implementations.setOperationSteps(rejectedOperation, () => {
      throw reason;
    });

    const realm = new Realm();
    const binding = new RealmBinding(
      assembleDefinitions([interface_]),
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
    const object = binding.createPlatformObject('PromiseOwner');
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
    const read = operation('read', promiseType(idlType.long));
    const interface_ = defineInterface({
      name: 'PromiseReceiver',
      exposed: ['Window'],
      members: [read],
    });
    const realm = new Realm();
    const implementations = new ImplementationRegistry();
    implementations.setOperationSteps(read, () => {
      throw new Error('unreachable');
    });
    const binding = new RealmBinding(
      assembleDefinitions([interface_]),
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
    const object = binding.createPlatformObject('PromiseReceiver');
    const method = Reflect.get(object, 'read') as CallableFunction;
    const promise = Reflect.apply(method, {}, []) as Promise<unknown>;

    expect(promise).toBeInstanceOf(realm.intrinsics.promise.constructor);
    await expect(promise).rejects.toBeInstanceOf(realm.intrinsics.typeError);
  });

  it('realizes only requested DOMException rejections in the operation realm', async () => {
    const reject = operation('reject', promiseType(idlType.undefined));
    const rejectArbitrary = operation(
      'rejectArbitrary',
      promiseType(idlType.undefined),
    );
    const interface_ = defineInterface({
      name: 'PromiseExceptionSource',
      exposed: ['Window'],
      members: [reject, rejectArbitrary],
    });
    const realm = new Realm();
    const implementations = new ImplementationRegistry();
    const binding = new RealmBinding(
      assembleDefinitions([...webIDLCommonDefinitions, interface_]),
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
    registerDefinitionBindings(binding);
    implementations.setOperationSteps(reject, () => createRejectedPromise(
      createDOMException('NotAllowedError', 'requested rejection'),
      idlType.undefined,
      binding,
    ));
    const arbitraryReason = { arbitrary: true };
    implementations.setOperationSteps(
      rejectArbitrary,
      () => createRejectedPromise(
        arbitraryReason,
        idlType.undefined,
        binding,
      ),
    );
    const object = binding.createPlatformObject('PromiseExceptionSource');
    const promise = call(object, 'reject') as Promise<unknown>;
    const DOMException_ = binding.getInterfaceObject(
      'DOMException',
    ) as unknown as typeof DOMException;

    expect(promise).toBeInstanceOf(realm.intrinsics.promise.constructor);
    await expect(promise).rejects.toMatchObject({
      message: 'requested rejection',
      name: 'NotAllowedError',
    });
    await expect(promise).rejects.toBeInstanceOf(DOMException_);
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
  const bindings = createBindings([
    promiseOwnerIDL, promiseChildIDL, promiseCallbackIDL, promiseResultIDL,
  ]);
  const first = new Realm();
  const second = new Realm();
  const firstBinding = bindings.register(first);
  const secondBinding = bindings.register(second);
  firstBinding.install(first.global);
  secondBinding.install(second.global);
  const implementation = new OrdinaryPromiseOwnerImpl();
  const owner = firstBinding.context.project(OrdinaryPromiseOwnerImpl, implementation);
  const foreignConstructor = Reflect.get(second.global, 'OrdinaryPromiseOwner') as { prototype: object; };
  return { bindings, first, second, firstBinding, implementation, owner, foreignPrototype: foreignConstructor.prototype };
}

class OrdinaryPromiseOwnerImpl {
  readonly pending = Promise.withResolvers<PromiseChildImpl>();
  received: PromiseChildImpl | undefined;
  returned: unknown;
  readonly visited = new WeakSet<object>();

  get result(): Promise<PromiseChildImpl> { return this.pending.promise; }
  read(): Promise<PromiseChildImpl> { return this.pending.promise; }
  readRecord(): Promise<{ value: PromiseChildImpl; done: boolean; optional: undefined; }> {
    return this.pending.promise.then((value) => ({ value, done: false, optional: undefined }));
  }
  next(iterator: object): Promise<PromiseChildImpl | typeof endOfIteration> {
    if (this.visited.has(iterator)) return Promise.resolve(endOfIteration);
    this.visited.add(iterator);
    return this.pending.promise;
  }

  close(value: unknown): Promise<void> {
    this.returned = value;
    return Promise.resolve();
  }
  reject(reason: unknown): Promise<never> {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- author rejection values retain their identity
    return Promise.reject(reason);
  }

  consume(value: PromiseValue<PromiseChildImpl>): PromiseValue<number> {
    return value.then((child) => {
      this.received = child;
      return child.value;
    });
  }

  invoke(callback: () => PromiseValue<PromiseChildImpl>): PromiseValue<number> {
    return this.consume(callback());
  }
}

class PromiseChildImpl {
  get value(): number { return 7; }
}

const childType = reference('PromiseChild');
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
      binding: {
        getNext: (target, iterator) => (target as OrdinaryPromiseOwnerImpl).next(iterator),
        return: (target, _iterator, value) => (target as OrdinaryPromiseOwnerImpl).close(value),
      },
    }),
  ],
});
