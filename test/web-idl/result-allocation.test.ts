import { describe, expect, it } from 'vitest';
import {
  allocateIn, arg, BindingWorld, defineDictionary, defineInterface, defineTypedef, dictMember,
  idlType, impl, implementationType, nullable, op, promise, record, reference, sequence, staticOp, union,
  type OperationMember, type WebIDLType,
} from '../../src/web-idl/index';
import { TestRealm } from './test-realm';
import { createEnvironment } from '../js-engine/execution-fixture';
import { getBufferSourceCopy, getBufferSourceUnderlyingBuffer, writeArrayBuffer, type JSEnvironment } from '../../src/js-engine/index';
import type { InternalPromise } from '../../src/infra/promises';

describe('Web IDL result allocation', () => {
  it.each([undefined, 'receiver', 'method'] as const)('allocates sequence results with allocateIn = %s', (allocation) => {
    const values = ['a=1', 'b=2'];
    const { call, realm, methodRealm } = createFixture(sequence(idlType.ByteString), allocation, values);
    const target = allocation === 'method' ? methodRealm : realm;
    const first = call('create');
    const second = call('create');
    expect(first).toBeInstanceOf(target.intrinsics.array);
    expect(first).toEqual(values);
    expect(first).not.toBe(values);
    expect(second).not.toBe(first);
  });

  for (const allocation of ['receiver', 'method'] as const) {
    it.each([
      'ArrayBuffer', 'SharedArrayBuffer', 'Uint8Array', 'Uint16Array', 'DataView',
    ] as const)(`allocates a fresh %s in the ${allocation} realm`, (name) => {
      const { call, value, realm, methodRealm } = createFixture(idlType[name], allocation);
      const target = allocation === 'method' ? methodRealm : realm;
      const other = allocation === 'method' ? realm : methodRealm;
      const first = call('create') as ArrayBufferLike | ArrayBufferView;
      const second = call('create') as ArrayBufferLike | ArrayBufferView;
      const buffer = getBufferSourceUnderlyingBuffer(first);
      const bufferName = name === 'SharedArrayBuffer' ? name : 'ArrayBuffer';

      expect(first).toBeInstanceOf(Reflect.get(target.global, name));
      expect(first).not.toBeInstanceOf(Reflect.get(other.global, name));
      expect(buffer).toBeInstanceOf(Reflect.get(target.global, bufferName));
      expect(getBufferSourceCopy(first)).toEqual(Uint8Array.of(1, 2, 3, 4));
      expect(first).not.toBe(value);
      expect(second).not.toBe(first);
      expect(getBufferSourceUnderlyingBuffer(second)).not.toBe(buffer);
      writeArrayBuffer(buffer, [9]);
      expect(getBufferSourceCopy(value as Uint8Array)).toEqual(Uint8Array.of(1, 2, 3, 4));
      expect(getBufferSourceCopy(second)).toEqual(Uint8Array.of(1, 2, 3, 4));
    });

    it.each(['record', 'dictionary'] as const)(`allocates a %s and its nested sequence in the ${allocation} realm`, (kind) => {
      const type = kind === 'record'
        ? record(idlType.DOMString, sequence(idlType.ByteString))
        : reference('ResultDictionary');
      const value = new Map([['names', ['a=1']]]);
      const { call, realm, methodRealm } = createFixture(type, allocation, value);
      const target = allocation === 'method' ? methodRealm : realm;
      const result = call('create') as { names: string[]; };
      expect(Object.getPrototypeOf(result)).toBe(target.intrinsics.objectPrototype);
      expect(result.names).toBeInstanceOf(target.intrinsics.array);
      expect(result).toEqual({ names: ['a=1'] });
      expect(call('create')).not.toBe(result);
    });
  }

  it('preserves existing buffer identities without an allocation declaration', () => {
    const { call, methodRealm } = createFixture(idlType.Uint8Array, undefined);
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

  it('keeps object-valued sequence members while allocating the container in the method realm', () => {
    const value = Uint8Array.of(1, 2);
    const { call, methodRealm } = createFixture(sequence(idlType.Uint8Array), 'method', [value]);
    const result = call('create') as Uint8Array[];
    expect(result).toBeInstanceOf(methodRealm.intrinsics.array);
    expect(result[0]).toBe(value);
  });

  it.each(['fresh', 'projected'] as const)('preserves receiver binding for a %s interface inside a method-realm container', (stage) => {
    const item = new ItemImpl();
    const { call, context, realm, methodRealm } = createFixture(sequence(reference('Item')), 'method', [item]);
    const previous = stage === 'projected' ? context.project(ItemImpl, item) : undefined;
    const result = call('create') as object[];
    expect(result).toBeInstanceOf(methodRealm.intrinsics.array);
    expect(result[0]).toBeInstanceOf(Reflect.get(realm.global, 'Item'));
    expect(result[0]).toBe(context.project(ItemImpl, item));
    if (previous) expect(result[0]).toBe(previous);
  });

  it.each(['receiver', 'method'] as const)('uses the method realm for static operations with allocateIn = %s', (allocation) => {
    const { MethodConstructor, methodRealm } = createFixture(sequence(idlType.ByteString), allocation);
    const method = Reflect.get(MethodConstructor, 'createStatic') as CallableFunction;
    const result: unknown = Reflect.apply(method, null, []);
    expect(result).toBeInstanceOf(methodRealm.intrinsics.array);
    expect(result).toEqual(['static']);
  });

  it('uses the selected overload allocation policy', () => {
    const { call, realm, methodRealm } = createFixture(sequence(idlType.ByteString), undefined);
    expect(call('overloaded', 1)).toBeInstanceOf(realm.intrinsics.array);
    expect(call('overloaded', 'value')).toBeInstanceOf(methodRealm.intrinsics.array);
  });

  it.each(['receiver', 'method'] as const)('retains promised bytes allocated in the %s realm without changing existing results', async (allocation) => {
    const { call, value, realm, methodRealm } = createFixture(idlType.Uint8Array, allocation);
    const target = allocation === 'method' ? methodRealm : realm;
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
    const { call, methodRealm } = createFixture(sequence(idlType.ByteString), 'method', ['a=1']);
    const result = call('createAsync') as Promise<string[]>;
    expect(result).toBeInstanceOf(methodRealm.intrinsics.promise.constructor);
    expect(await result).toBeInstanceOf(methodRealm.intrinsics.array);
    expect(await result).toEqual(['a=1']);
  });

  it.each([undefined, 'receiver', 'method'] as const)('rejects invocation failures in the method realm with allocateIn = %s', async (allocation) => {
    const { call, methodRealm } = createFixture(idlType.Uint8Array, allocation);
    const result = call('failAsync');
    await expect(result).rejects.toThrow('Failed to create result');
    expect(result).toBeInstanceOf(methodRealm.intrinsics.promise.constructor);
  });

  it.each([
    reference('ResultBytes'), nullable(idlType.Uint8Array), union(idlType.Uint8Array, idlType.DOMString),
  ])('preserves allocation through a $kind type', (type) => {
    const { call, value, methodRealm } = createFixture(type, 'method');
    const result = call('create') as Uint8Array;
    expect(result).not.toBe(value);
    expect(result).toBeInstanceOf(Reflect.get(methodRealm.global, 'Uint8Array'));
    expect(getBufferSourceCopy(result)).toEqual(value);
  });

  it('preserves null and scalar results', () => {
    expect(createFixture(nullable(idlType.Uint8Array), 'method', null).call('create')).toBeNull();
    expect(createFixture(idlType.DOMString, 'method', 'value').call('create')).toBe('value');
  });
});

function createFixture(
  type: WebIDLType,
  allocation: OperationMember['allocateIn'],
  // The returned bytes occupy only part of their backing buffer.
  value: unknown = Uint8Array.of(0, 1, 2, 3, 4, 0).subarray(1, 5),
) {
  const options = allocation === undefined ? {} : allocateIn(allocation);
  const definition = defineInterface({
    name: 'Result',
    exposed: '*',
    implementation: impl(ResultImpl),
    members: [
      op('create', type, [], options),
      op('existing', idlType.Uint8Array, [arg('value', idlType.Uint8Array)]),
      op('createAsync', promise(type), [], options),
      op('otherAsync', promise(type), [], allocateIn(allocation === 'method' ? 'receiver' : 'method')),
      op('existingAsync', promise(type)),
      op('failAsync', promise(type), [], options),
      staticOp('createStatic', sequence(idlType.ByteString), [], options),
      op('overloaded', sequence(idlType.ByteString),
        [arg('selector', idlType.long)], allocateIn('receiver'),
      ),
      op('overloaded', sequence(idlType.ByteString),
        [arg('selector', idlType.DOMString)], allocateIn('method'),
      ),
    ],
  });
  const bindings = new BindingWorld([
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
  const owner = allocation === 'method' ? methodContext : context;
  const other = allocation === 'method' ? context : methodContext;
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

  createAsync(): InternalPromise<unknown> { return this.pending ??= this.createPromise(this.env); }

  otherAsync(): InternalPromise<unknown> { return this.otherPending ??= this.createPromise(this.otherEnv); }

  existingAsync(): InternalPromise<unknown> { return this.env.exec.Promise.resolve(this.value, implementationType<unknown>(this.type)); }

  failAsync(): never { throw new Error('Failed to create result'); }

  overloaded(): string[] { return ['overloaded']; }

  static createStatic(): string[] { return ['static']; }

  private createPromise(env: JSEnvironment): InternalPromise<unknown> {
    const value = this.value instanceof Uint8Array ? env.exec.buffers.copyUint8Array(this.value) : this.value;
    return env.exec.Promise.resolve(value, implementationType<unknown>(this.type));
  }
}

class ItemImpl {}
