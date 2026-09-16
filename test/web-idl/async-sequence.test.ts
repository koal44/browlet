import { describe, expect, it } from 'vitest';

import { TestRealm as Realm } from './test-realm';
import { BindingWorld } from '../../src/web-idl/binding-world';
import { assembleDefinitions } from '../../src/web-idl/assembly';
import {
  closeAsyncIterator, convertAsyncSequenceToJavaScript, endOfIteration,
  getAsyncIteratorNextValue, isIDLAsyncSequence, openAsyncSequence,
  type AsyncSequenceValue, type IDLAsyncIterator, type IDLAsyncSequence,
} from '../../src/web-idl/async-sequence';
import { RealmBinding } from '../../src/web-idl/realm-binding';
import { convertToIDL } from '../../src/web-idl/conversion';
import {
  asyncSequence, defineDictionary, defineInterface, dictMember, idlType,
  reference, type OperationMember,
} from '../../src/web-idl/core/index';
import { ImplementationRegistry } from '../../src/web-idl/implementation-registry';

describe('Web IDL async sequences', () => {
  it('supplies converted dictionary records to implementation iteration steps', async () => {
    // dictionary Entry { DOMString name; };
    const entryIDL = defineDictionary({
      name: 'Entry', members: [dictMember('name', idlType.DOMString)],
    });
    const realm = new Realm();
    const context = new BindingWorld([entryIDL]).register(realm);
    let conversions = 0;
    const entries = [{ name: { toString() { conversions++; return 'entry'; } } }];
    const sequence = context.convertToImpl(entries, asyncSequence(reference('Entry'))) as
      AsyncSequenceValue<{ name: string; }>;
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

    const sequence = convertToIDL(
      source,
      asyncSequence(idlType.long),
      binding,
    );

    expect(convertAsyncSequenceToJavaScript(sequence)).toBe(source);
    expect(gets).toBe(1);
    openAsyncSequence(requireAsyncSequence(sequence), binding.realm);
    expect(gets).toBe(1);
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
    const sequence = requireAsyncSequence(convertToIDL(
      source,
      asyncSequence(idlType.long),
      binding,
    ));
    const iterator = openAsyncSequence(sequence, realm);

    const next = getAsyncIteratorNextValue(
      iterator,
      realm,
      (value, type) => convertToIDL(value, type, binding),
    );
    expect(next.promise).toBeInstanceOf(realm.intrinsics.promise.constructor);
    expect(next.promise).not.toBeInstanceOf(Promise);
    await expect(next.promise).resolves.toBe(4);
    await expect(getAsyncIteratorNextValue(
      iterator,
      realm,
      (value, type) => convertToIDL(value, type, binding),
    ).promise).resolves.toBe(endOfIteration);

    await expect(closeAsyncIterator(iterator, 'stop', realm).promise)
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
    const iterator = openAsyncSequence(requireAsyncSequence(convertToIDL(
      source,
      asyncSequence(idlType.long),
      binding,
    )), realm);

    await expect(nextValue(iterator, binding)).resolves.toBe(8);
    await expect(nextValue(iterator, binding)).rejects
      .toBeInstanceOf(realm.intrinsics.typeError);
  });

  it('rejects abrupt IteratorNext completions before later microtasks', async () => {
    const { binding, realm } = createBinding();
    const source = {
      [Symbol.asyncIterator]() {
        return { next: () => 42 };
      },
    };
    const iterator = openAsyncSequence(requireAsyncSequence(convertToIDL(
      source,
      asyncSequence(idlType.long),
      binding,
    )), realm);
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
    const implementations = new ImplementationRegistry();
    implementations.setImplementationCreationSteps(definition, () => new AsyncSequenceConsumerImpl());
    implementations.setOperationSteps(asyncOperation, (_receiver, _value) => 'async');
    implementations.setOperationSteps(stringOperation, (_receiver, _value) => 'string');
    const realm = new Realm();
    const binding = new RealmBinding(
      assembleDefinitions([definition]),
      realm,
      new BindingWorld([]),
      implementations,
    );
    const object = binding.createPlatformObject(binding.resolveInterface(definition.name));
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
      assembleDefinitions([]),
      realm,
      new BindingWorld([]),
    ),
    realm,
  };
}

function requireAsyncSequence(
  value: unknown,
): IDLAsyncSequence {
  if (!isIDLAsyncSequence(value)) throw new Error('Value is not an async sequence');
  return value;
}

function nextValue(
  iterator: IDLAsyncIterator,
  binding: RealmBinding,
): Promise<unknown> {
  return getAsyncIteratorNextValue(
    iterator,
    binding.realm,
    (value, type) => convertToIDL(value, type, binding),
  ).promise;
}

function getMethod(object: object, key: PropertyKey): CallableFunction {
  const method = Reflect.get(object, key) as unknown;
  if (typeof method !== 'function') throw new Error(`${String(key)} is not callable`);
  return method;
}
