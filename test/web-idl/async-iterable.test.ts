import { describe, expect, it } from 'vitest';

import type { PromiseValueCapability } from '../../src/js-engine/index';
import { TestRealm as Realm } from './test-realm';
import { assembleDefinitions } from '../../src/web-idl/assembly';
import { endOfIteration } from '../../src/web-idl/async-sequence';
import { RealmBinding } from '../../src/web-idl/realm-binding';
import { webIDLCommonDefinitions } from '../../src/web-idl/common-definitions';
import {
  defineInterface, idlType, type AsyncIterableMember,
} from '../../src/web-idl/core/index';
import { ImplementationRegistry } from '../../src/web-idl/implementation-registry';
import { missingArgument } from '../../src/web-idl/overload';
import { PlatformObjectRegistry } from '../../src/web-idl/platform-object';

describe('Web IDL asynchronously iterable declarations', () => {
  it('projects pair methods, iterator prototypes, arguments, and results', async () => {
    const { binding, declaration, implementations, realm } = createPairBinding();
    const initialized: unknown[][] = [];
    implementations.setAsyncIteratorSteps(declaration, {
      create(_target, argumentsList) {
        initialized.push(argumentsList);
        return { position: 0 };
      },
      next(iterator: { position: number; }) {
        const position = iterator.position++;
        return realm.promises.try(() => position === 0 ? ['one', 1] : endOfIteration);
      },
      return: () => realm.promises.resolve(),
    });
    const object = binding.createPlatformObject(binding.resolveInterface('AsyncPairs'));
    const prototype = Object.getPrototypeOf(object) as object;
    const entries = getMethod(prototype, 'entries');
    const keys = getMethod(prototype, 'keys');
    const values = getMethod(prototype, 'values');

    expect(getMethod(prototype, Symbol.asyncIterator)).toBe(entries);
    expect([
      [entries.name, entries.length],
      [keys.name, keys.length],
      [values.name, values.length],
    ]).toEqual([
      ['entries', 0],
      ['keys', 0],
      ['values', 0],
    ]);
    expect(Object.getOwnPropertyDescriptor(prototype, Symbol.asyncIterator))
      .toMatchObject({ configurable: true, enumerable: false, writable: true });

    const iterator = Reflect.apply(entries, object, [undefined, undefined]) as object;
    expect(initialized).toEqual([[missingArgument, 'fallback']]);
    Reflect.apply(entries, object, [300, undefined]);
    expect(initialized).toEqual([
      [missingArgument, 'fallback'],
      [127, 'fallback'],
    ]);
    const iteratorPrototype = Object.getPrototypeOf(iterator) as object;
    expect(Object.getPrototypeOf(iteratorPrototype))
      .toBe(realm.intrinsics.iteration.asyncIteratorPrototype);
    expect(Object.prototype.toString.call(iterator))
      .toBe('[object AsyncPairs AsyncIterator]');
    expect(Reflect.apply(
      getMethod(iterator, Symbol.asyncIterator),
      iterator,
      [],
    )).toBe(iterator);
    expect(Object.getOwnPropertyDescriptor(iteratorPrototype, 'next'))
      .toMatchObject({ configurable: true, enumerable: true, writable: true });
    expect([getMethod(iterator, 'next').name, getMethod(iterator, 'next').length])
      .toEqual(['next', 0]);
    expect([getMethod(iterator, 'return').name, getMethod(iterator, 'return').length])
      .toEqual(['return', 1]);

    const first = await callIterator(iterator, 'next');
    expect(first.value).toBeInstanceOf(realm.intrinsics.array);
    expect(first.value).not.toBeInstanceOf(Array);
    expect(Array.from(first.value as ArrayLike<unknown>)).toEqual(['one', 1]);
    expect(Object.getPrototypeOf(first)).toBe(realm.intrinsics.objectPrototype);
    await expect(callIterator(iterator, 'next'))
      .resolves.toEqual({ done: true, value: undefined });
  });

  it.each(['next', 'return'] as const)('accepts %s borrowed from another realm in the same binding world', async (operation) => {
    const { binding, declaration, implementations } = createPairBinding();
    const otherBinding = new RealmBinding(
      binding.definitions, new Realm(), binding.platformObjects, implementations,
    );
    implementations.setAsyncIteratorSteps(declaration, {
      create: () => ({}),
      next: () => binding.realm.promises.try(() => ['one', 1]),
      return: () => binding.realm.promises.resolve(),
    });
    const object = binding.createPlatformObject(binding.resolveInterface('AsyncPairs'));
    const otherObject = otherBinding.createPlatformObject(otherBinding.resolveInterface('AsyncPairs'));
    const iterator = Reflect.apply(getMethod(object, 'entries'), object, []) as object;
    const otherIterator = Reflect.apply(
      getMethod(otherObject, 'entries'), otherObject, [],
    ) as object;

    const result: unknown = Reflect.apply(getMethod(otherIterator, operation), iterator, ['stop']);

    await expect(result).resolves.toEqual(operation === 'next'
      ? { done: false, value: ['one', 1] }
      : { done: true, value: 'stop' });
  });

  it.each(['next', 'return'] as const)('rejects %s borrowed from a separate binding world', async (operation) => {
    const { binding, declaration, implementations } = createPairBinding();
    const otherRealm = new Realm();
    const otherBinding = new RealmBinding(
      binding.definitions, otherRealm, new PlatformObjectRegistry(), implementations,
    );
    implementations.setAsyncIteratorSteps(declaration, {
      create: () => ({}),
      next: () => binding.realm.promises.try(() => endOfIteration),
      return: () => binding.realm.promises.resolve(),
    });
    const object = binding.createPlatformObject(binding.resolveInterface('AsyncPairs'));
    const otherObject = otherBinding.createPlatformObject(otherBinding.resolveInterface('AsyncPairs'));
    const iterator = Reflect.apply(getMethod(object, 'entries'), object, []) as object;
    const otherIterator = Reflect.apply(getMethod(otherObject, 'entries'), otherObject, []) as object;

    await expect(callIterator(iterator, operation, [], otherIterator))
      .rejects.toBeInstanceOf(otherRealm.intrinsics.typeError);
  });

  it('keeps iterator state hidden and rejects forged or proxied receivers', async () => {
    const { binding, declaration, implementations, realm } = createPairBinding();
    implementations.setAsyncIteratorSteps(declaration, {
      create: () => ({}),
      next: () => realm.promises.try(() => ['one', 1]),
      return: () => realm.promises.resolve(),
    });
    const object = binding.createPlatformObject(binding.resolveInterface('AsyncPairs'));
    const iterator = Reflect.apply(getMethod(object, 'entries'), object, []) as object;
    const prototype = Reflect.getPrototypeOf(iterator);
    const next = getMethod(iterator, 'next');
    const returned = getMethod(iterator, 'return');
    const forged = realm.createOrdinaryObject(prototype);
    const proxy = new Proxy(iterator, {
      get() { throw new Error('get trap was called'); },
      getPrototypeOf() { throw new Error('getPrototypeOf trap was called'); },
      has() { throw new Error('has trap was called'); },
    });

    expect(Reflect.ownKeys(iterator)).toEqual([]);
    for (const receiver of [forged, proxy]) {
      for (const method of [next, returned]) {
        await expect(Reflect.apply(method, receiver, []))
          .rejects.toBeInstanceOf(realm.intrinsics.typeError);
      }
    }
    Reflect.setPrototypeOf(iterator, null);
    Object.freeze(iterator);
    await expect(Reflect.apply(next, iterator, []))
      .resolves.toEqual({ done: false, value: ['one', 1] });
    await expect(Reflect.apply(returned, iterator, ['stop']))
      .resolves.toEqual({ done: true, value: 'stop' });
    expect(Reflect.ownKeys(iterator)).toEqual([]);
  });

  it.each([false, true])('serializes overlapping next and return calls (borrowed: %s)', async (borrowed) => {
    const { binding, declaration, implementations } = createPairBinding();
    const pending: PromiseValueCapability<unknown>[] = [];
    const calls: string[] = [];
    implementations.setAsyncIteratorSteps(declaration, {
      create: () => ({}),
      next() {
        calls.push('next');
        const promise = binding.realm.promises.withResolvers<unknown>();
        pending.push(promise);
        return promise.promise;
      },
      return(_iterator, value) {
        calls.push(`return:${String(value)}`);
        return binding.realm.promises.resolve();
      },
    });
    const object = binding.createPlatformObject(binding.resolveInterface('AsyncPairs'));
    const iterator = Reflect.apply(getMethod(object, 'entries'), object, []) as object;
    const otherBinding = borrowed ? new RealmBinding(
      binding.definitions, new Realm(), binding.platformObjects, implementations,
    ) : binding;
    const otherObject = otherBinding.createPlatformObject(otherBinding.resolveInterface('AsyncPairs'));
    const otherIterator = Reflect.apply(getMethod(otherObject, 'entries'), otherObject, []) as object;

    const first = callIterator(iterator, 'next');
    const second = callIterator(iterator, 'next', [], otherIterator);
    const returned = callIterator(iterator, 'return', ['stop'], otherIterator);
    expect(calls).toEqual(['next']);

    pending[0]!.resolve(['one', 1]);
    await expect(first).resolves.toMatchObject({ done: false });
    await Promise.resolve();
    expect(calls).toEqual(['next', 'next']);

    pending[1]!.resolve(['two', 2]);
    await expect(second).resolves.toMatchObject({ done: false });
    await expect(returned).resolves.toEqual({ done: true, value: 'stop' });
    await expect(callIterator(iterator, 'next')).resolves.toEqual({ done: true, value: undefined });
    expect(calls).toEqual(['next', 'next', 'return:stop']);
  });

  it('keeps later calls serialized after return settles', async () => {
    const { binding, declaration, implementations, realm } = createPairBinding();
    implementations.setAsyncIteratorSteps(declaration, {
      create: () => ({}),
      next: () => realm.promises.try(() => endOfIteration),
      return: () => realm.promises.resolve(),
    });
    const object = binding.createPlatformObject(binding.resolveInterface('AsyncPairs'));
    const iterator = Reflect.apply(
      getMethod(object, 'entries'),
      object,
      [],
    ) as object;
    await callIterator(iterator, 'return');

    const order: string[] = [];
    const next = Reflect.apply(
      getMethod(iterator, 'next'),
      iterator,
      [],
    ) as Promise<unknown>;
    void next.then(() => { order.push('next'); });
    realm.queueMicrotask(() => { order.push('microtask'); });

    await next;
    expect(order).toEqual(['microtask', 'next']);
  });

  it('uses value iteration methods and rejects invalid iterator receivers', async () => {
    class AsyncValuesImpl {}
    const declaration = {
      kind: 'async-iterable',
      value: idlType.long,
    } satisfies AsyncIterableMember;
    const definition = defineInterface({
      name: 'AsyncValues',
      exposed: ['Window'],
      members: [declaration],
    });
    const implementations = new ImplementationRegistry();
    implementations.setImplementationCreationSteps(definition, () => new AsyncValuesImpl());
    const realm = new Realm();
    const binding = new RealmBinding(
      assembleDefinitions([...webIDLCommonDefinitions, definition]),
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
    implementations.setAsyncIteratorSteps(declaration, {
      create: () => ({}),
      next: () => realm.promises.try(() => endOfIteration),
    });
    const object = binding.createPlatformObject(binding.resolveInterface(definition.name));
    expect(getMethod(object, Symbol.asyncIterator)).toBe(getMethod(object, 'values'));
    expect(Reflect.has(object, 'entries')).toBe(false);
    expect(Reflect.has(object, 'keys')).toBe(false);

    const iterator = Reflect.apply(getMethod(object, 'values'), object, []) as object;
    const invalid = Reflect.apply(getMethod(iterator, 'next'), {}, []) as Promise<unknown>;
    expect(invalid).toBeInstanceOf(realm.intrinsics.promise.constructor);
    await expect(invalid).rejects.toBeInstanceOf(realm.intrinsics.typeError);
  });
});

function createPairBinding(): {
  binding: RealmBinding;
  declaration: AsyncIterableMember;
  implementations: ImplementationRegistry;
  realm: Realm;
} {
  class AsyncPairsImpl {}
  const declaration = {
    arguments: [
      {
        extendedAttributes: [{ kind: 'no-arguments', name: 'Clamp' }],
        name: 'limit',
        optional: true,
        type: idlType.byte,
      },
      {
        default: 'fallback',
        name: 'label',
        optional: true,
        type: idlType.DOMString,
      },
    ],
    key: idlType.DOMString,
    kind: 'async-iterable',
    value: idlType.long,
  } satisfies AsyncIterableMember;
  const definition = defineInterface({
    name: 'AsyncPairs',
    exposed: ['Window'],
    members: [declaration],
  });
  const implementations = new ImplementationRegistry();
  implementations.setImplementationCreationSteps(definition, () => new AsyncPairsImpl());
  const realm = new Realm();
  return {
    binding: new RealmBinding(
      assembleDefinitions([...webIDLCommonDefinitions, definition]),
      realm,
      new PlatformObjectRegistry(),
      implementations,
    ),
    declaration,
    implementations,
    realm,
  };
}

function getMethod(object: object, key: PropertyKey): CallableFunction {
  const method = Reflect.get(object, key) as unknown;
  if (typeof method !== 'function') throw new Error(`${String(key)} is not callable`);
  return method;
}

async function callIterator(
  iterator: object,
  operation: 'next' | 'return',
  argumentsList: unknown[] = [],
  methodOwner: object = iterator,
): Promise<{ done: boolean; value: unknown; }> {
  return Reflect.apply(
    getMethod(methodOwner, operation),
    iterator,
    argumentsList,
  ) as Promise<{ done: boolean; value: unknown; }>;
}
