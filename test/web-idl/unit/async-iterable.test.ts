import { describe, expect, it } from 'vitest';

import { Realm } from '../../../src/browlet/realm';
import { assembleDefinitions } from '../../../src/web-idl/adapter/assembly';
import { endOfIteration } from '../../../src/web-idl/async-sequence';
import { JavaScriptBinding } from '../../../src/web-idl/binding';
import { webIDLCommonDefinitions } from '../../../src/web-idl/common-definitions';
import {
  defineInterface, idlType, type AsyncIterableMember,
} from '../../../src/web-idl/adapter/definition';
import { ImplementationRegistry } from '../../../src/web-idl/adapter/registry';
import { missingArgument } from '../../../src/web-idl/overload';
import { PlatformObjectRegistry } from '../../../src/web-idl/platform-object';
import {
  createPromise, createResolvedPromise, resolvePromise,
} from '../../../src/web-idl/promise';
import type { IDLPromise } from '../../../src/web-idl/promise-value';

describe('Web IDL asynchronously iterable declarations', () => {
  it('projects pair methods, iterator prototypes, arguments, and results', async () => {
    const { binding, declaration, implementations, realm } = createPairBinding();
    const initialized: unknown[][] = [];
    const positions = new WeakMap<object, number>();
    implementations.setAsyncIteratorSteps(declaration, {
      getNext(_target, iterator) {
        const position = positions.get(iterator) ?? 0;
        positions.set(iterator, position + 1);
        return createResolvedPromise(
          position === 0 ? ['one', 1] : endOfIteration,
          idlType.any,
          binding,
        );
      },
      initialize(_target, iterator, argumentsList) {
        positions.set(iterator, 0);
        initialized.push(argumentsList);
      },
      return: () => createResolvedPromise(
        undefined,
        idlType.any,
        binding,
      ),
    });
    const object = binding.createPlatformObject('AsyncPairs');
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

  it('serializes overlapping next and return calls', async () => {
    const { binding, declaration, implementations } = createPairBinding();
    const pending: IDLPromise[] = [];
    const calls: string[] = [];
    implementations.setAsyncIteratorSteps(declaration, {
      getNext() {
        calls.push('next');
        const promise = createPromise(idlType.any, binding);
        pending.push(promise);
        return promise;
      },
      return(_target, _iterator, value) {
        calls.push(`return:${String(value)}`);
        return createResolvedPromise(undefined, idlType.any, binding);
      },
    });
    const object = binding.createPlatformObject('AsyncPairs');
    const iterator = Reflect.apply(getMethod(object, 'entries'), object, []) as object;

    const first = callIterator(iterator, 'next');
    const second = callIterator(iterator, 'next');
    const returned = callIterator(iterator, 'return', ['stop']);
    expect(calls).toEqual(['next']);

    resolvePromise(pending[0], ['one', 1], binding);
    await expect(first).resolves.toMatchObject({ done: false });
    await Promise.resolve();
    expect(calls).toEqual(['next', 'next']);

    resolvePromise(pending[1], ['two', 2], binding);
    await expect(second).resolves.toMatchObject({ done: false });
    await expect(returned).resolves.toEqual({ done: true, value: 'stop' });
    expect(calls).toEqual(['next', 'next', 'return:stop']);
  });

  it('keeps later calls serialized after return settles', async () => {
    const { binding, declaration, implementations, realm } = createPairBinding();
    implementations.setAsyncIteratorSteps(declaration, {
      getNext: () => createResolvedPromise(
        endOfIteration,
        idlType.any,
        binding,
      ),
      return: () => createResolvedPromise(
        undefined,
        idlType.any,
        binding,
      ),
    });
    const object = binding.createPlatformObject('AsyncPairs');
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
    const declaration = {
      kind: 'async-iterable',
      value: idlType.long,
    } satisfies AsyncIterableMember;
    const interface_ = defineInterface({
      exposed: ['Window'],
      members: [declaration],
      name: 'AsyncValues',
    });
    const implementations = new ImplementationRegistry();
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([...webIDLCommonDefinitions, interface_]),
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
    implementations.setAsyncIteratorSteps(declaration, {
      getNext: () => createResolvedPromise(
        endOfIteration,
        idlType.any,
        binding,
      ),
    });
    const object = binding.createPlatformObject(interface_.name);
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
  binding: JavaScriptBinding;
  declaration: AsyncIterableMember;
  implementations: ImplementationRegistry;
  realm: Realm;
} {
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
  const interface_ = defineInterface({
    exposed: ['Window'],
    members: [declaration],
    name: 'AsyncPairs',
  });
  const implementations = new ImplementationRegistry();
  const realm = new Realm();
  return {
    binding: new JavaScriptBinding(
      assembleDefinitions([...webIDLCommonDefinitions, interface_]),
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
): Promise<{ done: boolean; value: unknown; }> {
  return Reflect.apply(
    getMethod(iterator, operation),
    iterator,
    argumentsList,
  ) as Promise<{ done: boolean; value: unknown; }>;
}
