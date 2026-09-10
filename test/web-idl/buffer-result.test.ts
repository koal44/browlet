import { describe, expect, it } from 'vitest';
import {
  arg, createBindings, ctor, defineInterface, idlType, impl, newBufferResult,
  op, promise, type WebIDLType,
} from '../../src/web-idl/index';
import {
  getBufferSourceCopy, getBufferSourceUnderlyingBuffer, writeArrayBuffer,
} from '../../src/js-engine/index';
import { TestRealm } from './test-realm';

describe('Web IDL buffer results', () => {
  it.each([
    'ArrayBuffer', 'SharedArrayBuffer', 'Uint8Array', 'Uint16Array', 'DataView',
  ] as const)('allocates a fresh %s in the receiver realm', (name) => {
    const { call, implementation, realm, foreignRealm } = createFixture(idlType[name]);
    const first = call('create');
    const second = call('create');
    const buffer = getBufferSourceUnderlyingBuffer(first);
    const bufferName = name === 'SharedArrayBuffer' ? name : 'ArrayBuffer';

    expect(first).toBeInstanceOf(Reflect.get(realm.global, name));
    expect(first).not.toBeInstanceOf(Reflect.get(foreignRealm.global, name));
    expect(buffer).toBeInstanceOf(Reflect.get(realm.global, bufferName));
    expect(getBufferSourceCopy(first)).toEqual(Uint8Array.of(1, 2, 3, 4));
    expect(first).not.toBe(implementation.bytes);
    expect(second).not.toBe(first);
    expect(getBufferSourceUnderlyingBuffer(second)).not.toBe(buffer);
    writeArrayBuffer(buffer, [9]);
    expect(Array.from(implementation.bytes)).toEqual([1, 2, 3, 4]);
    expect(getBufferSourceCopy(second)).toEqual(Uint8Array.of(1, 2, 3, 4));
  });

  it('preserves existing view and buffer identities without the declaration', () => {
    const { call, foreignRealm } = createFixture(idlType.Uint8Array);
    const value = foreignRealm.evaluate(
      'new Uint8Array(new ArrayBuffer(8), 2, 3)',
      'existing-buffer-result.js',
    ) as Uint8Array;
    const result = call('existing', value);

    expect(result).toBe(value);
    expect(getBufferSourceUnderlyingBuffer(result)).toBe(value.buffer);
    value[0] = 7;
    expect(getBufferSourceCopy(result)).toEqual(Uint8Array.of(7, 0, 0));
    expect(call('existing', value)).toBe(value);
  });

  it('rejects the allocation declaration on a non-buffer return type', () => {
    const { call } = createFixture(idlType.DOMString);
    expect(() => call('create')).toThrow('newBufferResult requires a buffer source return type');
  });

  it('allocates promised bytes in the receiver realm without changing existing results', async () => {
    const { call, implementation, realm, foreignRealm } = createFixture(idlType.Uint8Array);
    const result = call('createAsync') as Promise<Uint8Array>;
    expect(result).toBeInstanceOf(Reflect.get(realm.global, 'Promise'));
    const bytes = await result;
    expect(bytes).toBeInstanceOf(Reflect.get(realm.global, 'Uint8Array'));
    expect(bytes).not.toBeInstanceOf(Reflect.get(foreignRealm.global, 'Uint8Array'));
    expect(getBufferSourceCopy(bytes)).toEqual(implementation.bytes);
    expect(await (call('existingAsync') as Promise<Uint8Array>)).toBe(implementation.bytes);
    expect(call('createAsync')).toBe(result);
  });
});

function createFixture(type: WebIDLType) {
  const definition = defineInterface({
    name: 'BufferResult',
    exposed: '*',
    implementation: impl(BufferResultImpl),
    members: [
      ctor(),
      op('create', type, [], newBufferResult()),
      op('existing', idlType.Uint8Array, [arg('value', idlType.Uint8Array)]),
      op('createAsync', promise(idlType.Uint8Array), [], newBufferResult()),
      op('existingAsync', promise(idlType.Uint8Array)),
    ],
  });
  const bindings = createBindings([definition]);
  const realm = new TestRealm();
  const foreignRealm = new TestRealm();
  bindings.register(realm).install(realm.global);
  bindings.register(foreignRealm).install(foreignRealm.global);
  const Constructor = Reflect.get(realm.global, definition.name) as new() => object;
  const receiver = new Constructor();
  const implementation = bindings.getImplementationObject(receiver) as BufferResultImpl;
  const ForeignConstructor = Reflect.get(foreignRealm.global, definition.name) as {
    prototype: object;
  };

  return {
    call: (name: string, ...args: unknown[]): object => {
      const method = Reflect.get(ForeignConstructor.prototype, name) as CallableFunction;
      return Reflect.apply(method, receiver, args) as object;
    },
    implementation, realm, foreignRealm,
  };
}

class BufferResultImpl {
  // The returned bytes occupy only part of their backing buffer.
  readonly bytes = Uint8Array.of(0, 1, 2, 3, 4, 0).subarray(1, 5);
  readonly pending = Promise.resolve(this.bytes);

  create(): Uint8Array {
    return this.bytes;
  }

  existing(value: Uint8Array): Uint8Array {
    return value;
  }

  createAsync(): Promise<Uint8Array> { return this.pending; }

  existingAsync(): Promise<Uint8Array> { return this.pending; }
}
