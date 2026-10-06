import { describe, expect, it } from 'vitest';

import { getBufferSourceCopy, getBufferSourceUnderlyingBuffer, type JSEnvironment } from '../../../src/js-engine/index';
import type { InternalPromise } from '../../../src/infra/promises';
import {
  arg, BindingWorld, defineDictionary, defineInterface, defineTypedef, dictMember,
  idlType, impl, implementationType, nullable, op, promise, record, reference, sequence, staticOp, union,
  type WebIDLType,
} from '../../../src/web-idl/index';

import { TestRealm } from '../../support/web-idl-realm';
import { createEnvironment, type TestEnvironment } from '../../js-engine/execution-fixture';

describe('Web IDL result allocation', () => {
  it('allocates sequence results in the receiver realm through a borrowed method', () => {
    const values = ['a=1', 'b=2'];
    const { call, realm } = createFixture(sequence(idlType.ByteString), values);
    const first = call('create');
    const second = call('create');
    expect(first).toBeInstanceOf(realm.intrinsics.array);
    expect(first).toEqual(values);
    expect(first).not.toBe(values);
    expect(second).not.toBe(first);
  });

  it.each([
    'ArrayBuffer', 'SharedArrayBuffer', 'Uint8Array', 'Uint16Array', 'DataView',
  ] as const)('preserves an existing %s result and its realm', (name) => {
    const sourceRealm = new TestRealm();
    const bytes = [1, 2, 3, 4];
    const value = name === 'ArrayBuffer' ? sourceRealm.createArrayBuffer(bytes)
      : name === 'SharedArrayBuffer' ? sourceRealm.createSharedArrayBuffer(bytes)
        : sourceRealm.createArrayBufferView(name, bytes);
    const { call, realm } = createFixture(idlType[name], value);
    const result = call('create') as ArrayBufferLike | ArrayBufferView;

    expect(result).toBe(value);
    expect(result).toBeInstanceOf(Reflect.get(sourceRealm.global, name));
    expect(result).not.toBeInstanceOf(Reflect.get(realm.global, name));
    expect(getBufferSourceUnderlyingBuffer(result)).toBe(getBufferSourceUnderlyingBuffer(value));
    expect(getBufferSourceCopy(result)).toEqual(Uint8Array.of(1, 2, 3, 4));
    expect(call('create')).toBe(result);
  });

  it.each(['record', 'dictionary', 'dictionary union'] as const)('allocates a %s and its nested sequence in the receiver realm', (kind) => {
    const type = kind === 'record'
      ? record(idlType.DOMString, sequence(idlType.ByteString))
      : kind === 'dictionary' ? reference('ResultDictionary') : union(reference('ResultDictionary'), idlType.DOMString);
    const value = kind === 'record' ? new Map([['names', ['a=1']]]) : { names: ['a=1'] };
    const { call, realm } = createFixture(type, value);
    const result = call('create') as { names: string[]; };
    expect(Object.getPrototypeOf(result)).toBe(realm.intrinsics.objectPrototype);
    expect(result.names).toBeInstanceOf(realm.intrinsics.array);
    expect(result).toEqual({ names: ['a=1'] });
    expect(call('create')).not.toBe(result);
  });

  it('preserves an existing buffer passed through a borrowed method', () => {
    const { call, methodRealm } = createFixture(idlType.Uint8Array);
    const value = methodRealm.evaluate(
      'new Uint8Array(new ArrayBuffer(8), 2, 3)',
      'existing-buffer-result.js',
    ) as Uint8Array;
    const result = call('existing', value) as Uint8Array;

    expect(result).toBe(value);
    expect(getBufferSourceUnderlyingBuffer(result)).toBe(value.buffer);
    value[0] = 7;
    expect(getBufferSourceCopy(result)).toEqual(Uint8Array.of(7, 0, 0));
    expect(call('existing', value)).toBe(value);
  });

  it('keeps object-valued sequence members while allocating the container in the receiver realm', () => {
    const value = Uint8Array.of(1, 2);
    const { call, realm } = createFixture(sequence(idlType.Uint8Array), [value]);
    const result = call('create') as Uint8Array[];
    expect(result).toBeInstanceOf(realm.intrinsics.array);
    expect(result[0]).toBe(value);
  });

  it.each(['fresh', 'projected'] as const)('preserves receiver binding for a %s interface returned by a borrowed method', (stage) => {
    const item = new ItemImpl();
    const { call, context, realm } = createFixture(sequence(reference('Item')), [item]);
    const previous = stage === 'projected' ? context.project(ItemImpl, item) : undefined;
    const result = call('create') as object[];
    expect(result).toBeInstanceOf(realm.intrinsics.array);
    expect(result[0]).toBeInstanceOf(Reflect.get(realm.global, 'Item'));
    expect(result[0]).toBe(context.project(ItemImpl, item));
    if (previous) expect(result[0]).toBe(previous);
  });

  it('uses the method realm for static operations', () => {
    const { MethodConstructor, methodRealm } = createFixture(sequence(idlType.ByteString));
    const method = Reflect.get(MethodConstructor, 'createStatic') as CallableFunction;
    const result: unknown = Reflect.apply(method, null, []);
    expect(result).toBeInstanceOf(methodRealm.intrinsics.array);
    expect(result).toEqual(['static']);
  });

  it('allocates each overload result in the receiver realm', () => {
    const { call, realm } = createFixture(sequence(idlType.ByteString));
    expect(call('overloaded', 1)).toBeInstanceOf(realm.intrinsics.array);
    expect(call('overloaded', 'value')).toBeInstanceOf(realm.intrinsics.array);
  });

  it.each(['receiver', 'method'] as const)('retains promised bytes allocated in the %s realm without changing existing results', async (promiseOwner) => {
    const { call, value, realm, methodRealm } = createFixture(idlType.Uint8Array, undefined, promiseOwner);
    const target = promiseOwner === 'method' ? methodRealm : realm;
    const result = call('createAsync') as Promise<Uint8Array>;
    expect(result).toBeInstanceOf(target.intrinsics.promise.constructor);
    const bytes = await result;
    expect(bytes).toBeInstanceOf(Reflect.get(target.global, 'Uint8Array'));
    expect(getBufferSourceCopy(bytes)).toEqual(value);
    expect(await (call('existingAsync') as Promise<Uint8Array>)).toBe(value);
    expect(call('createAsync')).toBe(result);
    const otherResult = call('otherAsync');
    expect(otherResult).not.toBe(result);
    expect(call('otherAsync')).toBe(otherResult);
  });

  it('allocates a promised sequence in the method realm', async () => {
    const { call, methodRealm } = createFixture(sequence(idlType.ByteString), ['a=1'], 'method');
    const result = call('createAsync') as Promise<string[]>;
    expect(result).toBeInstanceOf(methodRealm.intrinsics.promise.constructor);
    expect(await result).toBeInstanceOf(methodRealm.intrinsics.array);
    expect(await result).toEqual(['a=1']);
  });

  it('rejects invocation failures in the method realm', async () => {
    const { call, methodRealm } = createFixture(idlType.Uint8Array);
    const result = call('failAsync');
    await expect(result).rejects.toThrow('Failed to create result');
    expect(result).toBeInstanceOf(methodRealm.intrinsics.promise.constructor);
  });

  it.each([
    reference('ResultBytes'), nullable(idlType.Uint8Array), union(idlType.Uint8Array, idlType.DOMString),
  ])('preserves buffer identity through a $kind type', (type) => {
    const { call, value } = createFixture(type);
    const result = call('create') as Uint8Array;
    expect(result).toBe(value);
    expect(getBufferSourceCopy(result)).toEqual(value);
  });

  it('preserves null and scalar results', () => {
    expect(createFixture(nullable(idlType.Uint8Array), null).call('create')).toBeNull();
    expect(createFixture(idlType.DOMString, 'value').call('create')).toBe('value');
  });
});

function createFixture(
  type: WebIDLType,
  // The returned bytes occupy only part of their backing buffer.
  value: unknown = Uint8Array.of(0, 1, 2, 3, 4, 0).subarray(1, 5),
  promiseOwner: 'receiver' | 'method' = 'receiver',
) {
  const definition = defineInterface({
    name: 'Result',
    exposed: '*',
    implementation: impl(ResultImpl),
    members: [
      op('create', type),
      op('existing', idlType.Uint8Array, [arg('value', idlType.Uint8Array)]),
      op('createAsync', promise(type)),
      op('otherAsync', promise(type)),
      op('existingAsync', promise(type)),
      op('failAsync', promise(type)),
      staticOp('createStatic', sequence(idlType.ByteString)),
      op('overloaded', sequence(idlType.ByteString), [arg('selector', idlType.long)]),
      op('overloaded', sequence(idlType.ByteString), [arg('selector', idlType.DOMString)]),
    ],
  });
  const bindings = new BindingWorld<TestEnvironment>([
    definition,
    defineTypedef({ name: 'ResultBytes', type: idlType.Uint8Array }),
    defineDictionary({
      name: 'ResultDictionary', members: [dictMember('names', sequence(idlType.ByteString))],
    }),
    defineInterface({ name: 'Item', exposed: '*', implementation: impl(ItemImpl), members: [] }),
  ]);
  const realm = new TestRealm();
  const methodRealm = new TestRealm();
  const context = bindings.register(realm, (ctx) => createEnvironment(realm, ctx));
  context.install(realm.global);
  const methodContext = bindings.register(methodRealm, (ctx) => createEnvironment(methodRealm, ctx));
  methodContext.install(methodRealm.global);
  const owner = promiseOwner === 'method' ? methodContext : context;
  const other = promiseOwner === 'method' ? context : methodContext;
  const receiver = context.project(ResultImpl, new ResultImpl(value, type, owner.getEnvironment(), other.getEnvironment()));
  const MethodConstructor = Reflect.get(methodRealm.global, definition.name) as {
    prototype: object;
  };

  return {
    call: (name: string, ...args: unknown[]): unknown => {
      const method = Reflect.get(MethodConstructor.prototype, name) as CallableFunction;
      return Reflect.apply(method, receiver, args);
    },
    value, context, realm, methodRealm, MethodConstructor,
  };
}

class ResultImpl {
  pending: InternalPromise<unknown> | undefined;
  otherPending: InternalPromise<unknown> | undefined;

  constructor(public value: unknown, public type: WebIDLType, public env: JSEnvironment, public otherEnv: JSEnvironment) {}

  create(): unknown { return this.value; }

  existing(value: Uint8Array): Uint8Array { return value; }

  createAsync(): InternalPromise<unknown> { return this.pending ??= this.#createPromise(this.env); }

  otherAsync(): InternalPromise<unknown> { return this.otherPending ??= this.#createPromise(this.otherEnv); }

  existingAsync(): InternalPromise<unknown> { return this.env.exec.Promise.resolve(this.value, implementationType<unknown>(this.type)); }

  failAsync(): never { throw new Error('Failed to create result'); }

  overloaded(): string[] { return ['overloaded']; }

  static createStatic(): string[] { return ['static']; }

  #createPromise(env: JSEnvironment): InternalPromise<unknown> {
    const value = this.value instanceof Uint8Array ? env.exec.buffers.copyUint8Array(this.value) : this.value;
    return env.exec.Promise.resolve(value, implementationType<unknown>(this.type));
  }
}

class ItemImpl {}
