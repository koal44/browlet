import { describe, expect, it } from 'vitest';

import { TestRealm as Realm } from './test-realm';
import { BindingWorld } from '../../src/web-idl/binding/world';
import { DefinitionAssembly } from '../../src/web-idl/assembly';
import { endOfIteration, type AsyncIterator } from '../../src/infra/iteration';
import {
  AsyncSequenceCarrier, type AsyncIteratorCarrier,
} from '../../src/web-idl/constructs/async-sequence';
import { RealmBinding } from '../../src/web-idl/binding/realm';
import { jsToIDL, idlToJS } from '../../src/web-idl/conversion';
import {
  asyncSequence, defineDictionary, defineInterface, dictMember, idlType,
  reference, type OperationMember,
} from '../../src/web-idl/core/index';

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

    const sequence = jsToIDL(source, binding.getConversionContext(asyncSequence(idlType.long)));

    expect(idlToJS(sequence, binding.getConversionContext(asyncSequence(idlType.long)))).toBe(source);
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
    const iterator = requireAsyncSequence(jsToIDL(source, binding.getConversionContext(asyncSequence(idlType.long)))).open(realm);
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
    const iterator = requireAsyncSequence(jsToIDL(source, binding.getConversionContext(asyncSequence(idlType.long)))).open(realm);
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
    const sequence = requireAsyncSequence(jsToIDL(source, binding.getConversionContext(asyncSequence(idlType.long))));
    const iterator = sequence.open(realm);

    const next = iterator.nextValue(realm,
      (value, type) => jsToIDL(value, binding.getConversionContext(type)),
    );
    expect(next.promise).toBeInstanceOf(realm.intrinsics.promise.constructor);
    expect(next.promise).not.toBeInstanceOf(Promise);
    await expect(next.promise).resolves.toBe(4);
    await expect(iterator.nextValue(realm,
      (value, type) => jsToIDL(value, binding.getConversionContext(type)),
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
    const iterator = requireAsyncSequence(jsToIDL(source, binding.getConversionContext(asyncSequence(idlType.long)))).open(realm);

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
    const iterator = requireAsyncSequence(jsToIDL(source, binding.getConversionContext(asyncSequence(idlType.long)))).open(realm);
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
    interfaceBinding.getOrCreateMemberBinding(asyncOperation).operationSteps = (_receiver, _value) => 'async';
    interfaceBinding.getOrCreateMemberBinding(stringOperation).operationSteps = (_receiver, _value) => 'string';
    const object = binding.createPlatformRecord(binding.resolveInterface(definition.name)).platformObject!;
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
): AsyncSequenceCarrier {
  if (!AsyncSequenceCarrier.is(value)) throw new Error('Value is not an async sequence');
  return value;
}

function nextValue(
  iterator: AsyncIteratorCarrier,
  binding: RealmBinding,
): Promise<unknown> {
  return iterator.nextValue(binding.realm,
    (value, type) => jsToIDL(value, binding.getConversionContext(type)),
  ).promise;
}

function getMethod(object: object, key: PropertyKey): CallableFunction {
  const method = Reflect.get(object, key) as unknown;
  if (typeof method !== 'function') throw new Error(`${String(key)} is not callable`);
  return method;
}
