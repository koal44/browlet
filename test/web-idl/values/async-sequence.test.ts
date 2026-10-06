import { describe, expect, it } from 'vitest';

import { endOfIteration, type AsyncIterator } from '../../../src/infra/iteration';
import {
  asyncSequence, defineDictionary, defineInterface, dictMember, idlType,
  reference, type OperationMember,
} from '../../../src/web-idl/core/index';
import { DefinitionAssembly, type IDLType } from '../../../src/web-idl/assembly/index';
import {
  IDLAsyncSequence, type AsyncSequenceIterator,
} from '../../../src/web-idl/values/async-sequence';
import { BindingWorld } from '../../../src/web-idl/binding/world';
import { RealmBinding } from '../../../src/web-idl/binding/realm';

import { getMemberBinding } from '../../support/web-idl-binding';
import { TestRealm as Realm } from '../../support/web-idl-realm';

describe('Web IDL async sequences', () => {
  it('supplies converted dictionary records to implementation iteration steps', async () => {
    // dictionary Entry { DOMString name; };
    const entryIDL = defineDictionary({
      name: 'Entry', members: [dictMember('name', idlType.DOMString)],
    });
    const realm = new Realm();
    const context = new BindingWorld([entryIDL]).register(realm, (ctx) => ({ realm: ctx.realm }));
    let conversions = 0;
    const entries = [{ name: { toString() { conversions++; return 'entry'; } } }];
    const sequence = context.jsToImpl(entries, asyncSequence(reference('Entry'))) as
      AsyncIterator<{ name: string; }>;
    const first = Promise.withResolvers<unknown>();
    sequence.next().observe(first.resolve, first.reject);
    await expect(first.promise).resolves.toEqual({ name: 'entry' });
    expect(conversions).toBe(1);

    const next = Promise.withResolvers<unknown>();
    sequence.next().observe(next.resolve, next.reject);
    await expect(next.promise).resolves.toBe(endOfIteration);
  });

  it('retains the source and captured asynchronous iterator method', () => {
    const { binding } = createBinding();
    let gets = 0;
    const source = Object.defineProperty({}, Symbol.asyncIterator, {
      get() {
        gets++;
        return () => ({ next: () => ({ done: true }) });
      },
    });

    const sequence = binding.getConverter(binding.assembly.getIDLType(asyncSequence(idlType.long))).jsToIDL(source);

    expect(binding.getConverter(binding.assembly.getIDLType(asyncSequence(idlType.long))).idlToJS(sequence)).toBe(source);
    expect(gets).toBe(1);
    requireAsyncSequence(sequence).open(binding.realm);
    expect(gets).toBe(1);
  });

  it.each(['sync', 'async'] as const)('captures the %s iterator next method once when opened', async (kind) => {
    const { binding, realm } = createBinding();
    let gets = 0;
    const sourceIterator = {
      get next() {
        gets++;
        return function(this: unknown) {
          expect(this).toBe(sourceIterator);
          return { done: false, value: '7.9' };
        };
      },
    };
    const source = {
      [kind === 'sync' ? Symbol.iterator : Symbol.asyncIterator]: () => sourceIterator,
    };
    const iterator = requireAsyncSequence(binding.getConverter(binding.assembly.getIDLType(asyncSequence(idlType.long))).jsToIDL(source)).open(realm);
    Object.defineProperty(sourceIterator, 'next', {
      value: () => { throw new Error('next was read again'); },
    });

    await expect(nextValue(iterator, binding)).resolves.toBe(7);
    await expect(nextValue(iterator, binding)).resolves.toBe(7);
    expect(gets).toBe(1);
  });

  it.each(['sync', 'async'] as const)('reads the %s iterator return method at close and awaits its result', async (kind) => {
    const { binding, realm } = createBinding();
    let returned: unknown;
    let awaited = false;
    const sourceIterator = {
      next: () => ({ done: true }),
      return(_reason: unknown): unknown { throw new Error('old return was called'); },
    };
    const source = {
      [kind === 'sync' ? Symbol.iterator : Symbol.asyncIterator]: () => sourceIterator,
    };
    const iterator = requireAsyncSequence(binding.getConverter(binding.assembly.getIDLType(asyncSequence(idlType.long))).jsToIDL(source)).open(realm);
    sourceIterator.return = function(reason: unknown) {
      expect(this).toBe(sourceIterator);
      returned = reason;
      const completion = {
        then(resolve: (value: unknown) => void) {
          awaited = true;
          resolve(kind === 'sync' ? 'finished' : { done: true });
        },
      };
      return kind === 'sync' ? { done: true, value: completion } : completion;
    };

    await expect(iterator.close('stop', realm).promise).resolves.toBeUndefined();
    expect(returned).toBe('stop');
    expect(awaited).toBe(true);
  });

  it('adapts sync iterators and awaits their yielded values', async () => {
    const { binding, realm } = createBinding();
    let returned: unknown;
    const source = {
      [Symbol.iterator]() {
        let done = false;
        return {
          next() {
            if (done) return { done: true };
            done = true;
            return { done: false, value: Promise.resolve(4.9) };
          },
          return(value: unknown) {
            returned = value;
            return { done: true, value };
          },
        };
      },
    };
    const sequence = requireAsyncSequence(binding.getConverter(binding.assembly.getIDLType(asyncSequence(idlType.long))).jsToIDL(source));
    const iterator = sequence.open(realm);

    const next = iterator.nextValue(realm,
      (value, type) => binding.getConverter(type).jsToIDL(value),
    );
    expect(next.promise).toBeInstanceOf(realm.intrinsics.promise.constructor);
    expect(next.promise).not.toBeInstanceOf(Promise);
    await expect(next.promise).resolves.toBe(4);
    await expect(iterator.nextValue(realm,
      (value, type) => binding.getConverter(type).jsToIDL(value),
    ).promise).resolves.toBe(endOfIteration);

    await expect(iterator.close('stop', realm).promise)
      .resolves.toBeUndefined();
    expect(returned).toBe('stop');
  });

  it('converts async iterator values and rejects malformed results', async () => {
    const { binding, realm } = createBinding();
    const values: unknown[] = [
      Promise.resolve({ done: false, value: '8.7' }),
      Promise.resolve(42),
    ];
    const source = {
      [Symbol.asyncIterator]() {
        return { next: () => values.shift() };
      },
    };
    const iterator = requireAsyncSequence(binding.getConverter(binding.assembly.getIDLType(asyncSequence(idlType.long))).jsToIDL(source)).open(realm);

    await expect(nextValue(iterator, binding)).resolves.toBe(8);
    await expect(nextValue(iterator, binding)).rejects
      .toBeInstanceOf(realm.intrinsics.typeError);
  });

  it.each(['next', 'return'] as const)('keeps sync %s failures in the opening realm', async (operation) => {
    const openingRealm = new Realm();
    const { binding, realm } = createBinding();
    const source = {
      [Symbol.iterator]: () => ({ next: () => 42, return: () => 42 }),
    };
    const converter = binding.getConverter(binding.assembly.getIDLType(asyncSequence(idlType.long)));
    const iterator = converter.jsToIDL(source).open(openingRealm);
    const promise = operation === 'next' ? nextValue(iterator, binding) : iterator.close('stop', realm).promise;

    expect(promise).toBeInstanceOf(realm.intrinsics.promise.constructor);
    await expect(promise).rejects.toBeInstanceOf(openingRealm.intrinsics.typeError);
    await expect(promise).rejects.not.toBeInstanceOf(realm.intrinsics.typeError);
  });

  it('uses the invocation realm for element conversion after sync adaptation', async () => {
    const openingRealm = new Realm();
    const { binding, realm } = createBinding();
    const source = {
      [Symbol.iterator]: () => ({ next: () => ({ done: false, value: Symbol() }) }),
    };
    const converter = binding.getConverter(binding.assembly.getIDLType(asyncSequence(idlType.long)));
    const iterator = converter.jsToIDL(source).open(openingRealm);

    await expect(nextValue(iterator, binding)).rejects.toBeInstanceOf(realm.intrinsics.typeError);
  });

  it.each(['sync', 'async'] as const)('preserves %s close adoption when return is absent', async (kind) => {
    const openingRealm = new Realm();
    const { binding, realm } = createBinding();
    const source = {
      [kind === 'sync' ? Symbol.iterator : Symbol.asyncIterator]: () => ({ next: () => ({ done: true }) }),
    };
    const converter = binding.getConverter(binding.assembly.getIDLType(asyncSequence(idlType.long)));
    const iterator = converter.jsToIDL(source).open(openingRealm);
    const results: object[] = [];
    const order: string[] = [];
    const prototype = openingRealm.intrinsics.objectPrototype;
    Object.defineProperty(prototype, 'then', {
      configurable: true,
      get(this: object) { results.push(this); return undefined; },
    });

    try {
      const close = iterator.close('stop', realm).promise;
      expect(close).toBeInstanceOf(realm.intrinsics.promise.constructor);
      const settled = close.then((value) => {
        expect(value).toBeUndefined();
        order.push('closed');
      });
      realm.queueMicrotask(() => { order.push('queued'); });
      await settled;

      expect(order).toEqual(kind === 'sync' ? ['queued', 'closed'] : ['closed', 'queued']);
      if (kind === 'sync') {
        expect(results.length).toBeGreaterThan(0);
        for (const result of results) {
          expect(Object.getPrototypeOf(result)).toBe(prototype);
          expect(result).toEqual({ done: true, value: 'stop' });
        }
      } else {
        expect(results).toEqual([]);
      }
    } finally {
      Reflect.deleteProperty(prototype, 'then');
    }
  });

  it('rejects abrupt IteratorNext completions before later microtasks', async () => {
    const { binding, realm } = createBinding();
    const source = {
      [Symbol.asyncIterator]() {
        return { next: () => 42 };
      },
    };
    const iterator = requireAsyncSequence(binding.getConverter(binding.assembly.getIDLType(asyncSequence(idlType.long))).jsToIDL(source)).open(realm);
    const order: string[] = [];
    const rejection = nextValue(iterator, binding).catch((error: unknown) => {
      expect(error).toBeInstanceOf(realm.intrinsics.typeError);
      order.push('rejected');
    });
    realm.queueMicrotask(() => { order.push('queued'); });

    await rejection;
    expect(order).toEqual(['rejected', 'queued']);
  });

  it('captures the distinguishing iterator method once during overload resolution', () => {
    class AsyncSequenceConsumerImpl {}
    const asyncOperation = {
      arguments: [{ name: 'values', type: asyncSequence(idlType.long) }],
      kind: 'operation',
      name: 'accept',
      returns: idlType.DOMString,
    } satisfies OperationMember;
    const stringOperation = {
      arguments: [{ name: 'value', type: idlType.DOMString }],
      kind: 'operation',
      name: 'accept',
      returns: idlType.DOMString,
    } satisfies OperationMember;
    const definition = defineInterface({
      name: 'AsyncSequenceConsumer',
      exposed: ['Window'],
      members: [asyncOperation, stringOperation],
    });

    const realm = new Realm();
    const binding = new RealmBinding(
      new DefinitionAssembly([definition]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    const interfaceBinding = binding.getImplementationBinding(binding.resolveInterface(definition.name));
    interfaceBinding.createImplementation = () => new AsyncSequenceConsumerImpl();
    getMemberBinding(interfaceBinding, asyncOperation).operationSteps = (_receiver, [_value]) => 'async';
    getMemberBinding(interfaceBinding, stringOperation).operationSteps = (_receiver, [_value]) => 'string';
    const object = binding.allocatePlatformRecord(binding.resolveInterface(definition.name)).platformObject!;
    let gets = 0;
    const source = Object.defineProperty({}, Symbol.asyncIterator, {
      get() {
        gets++;
        return () => ({ next: () => ({ done: true }) });
      },
    });

    expect(Reflect.apply(getMethod(object, 'accept'), object, [source]))
      .toBe('async');
    expect(gets).toBe(1);
  });
});

function createBinding(): { binding: RealmBinding; realm: Realm; } {
  const realm = new Realm();
  return {
    binding: new RealmBinding(
      new DefinitionAssembly([]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    ),
    realm,
  };
}

function requireAsyncSequence(
  value: unknown,
): IDLAsyncSequence {
  if (!IDLAsyncSequence.is(value)) throw new Error('Value is not an async sequence');
  return value;
}

function nextValue<Element extends IDLType>(
  iterator: AsyncSequenceIterator<Element>,
  binding: RealmBinding,
): Promise<unknown> {
  return iterator.nextValue(binding.realm,
    (value, type) => binding.getConverter(type).jsToIDL(value),
  ).promise;
}

function getMethod(object: object, key: PropertyKey): CallableFunction {
  const method = Reflect.get(object, key) as unknown;
  if (typeof method !== 'function') throw new Error(`${String(key)} is not callable`);
  return method;
}
