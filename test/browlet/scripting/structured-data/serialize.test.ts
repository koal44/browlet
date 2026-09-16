import { describe, expect, it } from 'vitest';
import { TypeError as TypeErrorRequest } from '../../../../src/js-engine/exceptions';

import {
  BindingWorld, defineInterface, impl, xattr, type BindingContext,
} from '../../../../src/web-idl/index';
import { DOMException as InternalDOMException } from '../../../../src/web-idl/core/dom-exception';
import { Realm } from '../../../../src/browlet/scripting/realm';
import { AgentCluster } from '../../../../src/browlet/scripting/agents';
import {
  domExceptionCapabilities,
} from '../../../../src/browlet/integration/dom-exception';
import type {
  SerializedRecord,
} from '../../../../src/browlet/scripting/structured-data/records';
import {
  structuredSerialize, structuredSerializeForStorage,
  structuredSerializeInternal,
} from '../../../../src/browlet/scripting/structured-data/serialize';
import {
  serializable,
} from '../../../../src/browlet/scripting/structured-data/serializable';

describe('HTML structured serialization', () => {
  it('serializes primitive values and rejects symbols', () => {
    const ctx = createContext();
    const primitives = [
      undefined, null, false, true, -0, 1, NaN, 1n, '', 'value',
    ];

    for (const value of primitives) {
      const serialized = structuredSerialize(value, ctx);
      expect(serialized).toEqual({ type: 'primitive', value });
      if (Object.is(value, -0)) {
        expect(Object.is(serializedValue(serialized), -0)).toBe(true);
      }
    }
    expectDataCloneError(() => structuredSerialize(Symbol(), ctx));
  });

  it('reads boxed primitives and built-ins by slots across realms', () => {
    const ctx = createContext();
    const { realm } = ctx;
    const values = realm.evaluate(`[
      new Boolean(false),
      new Number(-0),
      Object(2n),
      new String('text'),
      new Date(1234),
      /a+/dgimsy,
    ]`, 'structured-serialize-builtins.js') as object[];

    expect(structuredSerialize(values[0], ctx)).toEqual({
      type: 'Boolean', value: false,
    });
    const number = structuredSerialize(values[1], ctx);
    expect(number.type).toBe('Number');
    expect(Object.is(recordValue(number), -0)).toBe(true);
    expect(structuredSerialize(values[2], ctx)).toEqual({
      type: 'BigInt', value: 2n,
    });
    expect(structuredSerialize(values[3], ctx)).toEqual({
      type: 'String', value: 'text',
    });
    expect(structuredSerialize(values[4], ctx)).toEqual({
      type: 'Date', value: 1234,
    });
    expect(structuredSerialize(values[5], ctx)).toEqual({
      type: 'RegExp', source: 'a+', flags: 'dgimsy',
    });
    expectDataCloneError(
      () => structuredSerialize(realm.evaluate(
        'Object(Symbol())',
        'structured-serialize-symbol.js',
      ), ctx),
    );
  });

  it('recognizes collection and buffer slots across realms', () => {
    const ctx = createContext();
    const { realm } = ctx;
    const [map, set, buffer, view] = realm.evaluate(`(() => {
      const buffer = new ArrayBuffer(4);
      return [new Map([[1, 2]]), new Set([3]), buffer, new Uint8Array(buffer)];
    })()`, 'structured-serialize-cross-realm.js') as object[];

    expect(structuredSerialize(map, ctx)).toMatchObject({
      type: 'Map',
      entries: [{
        key: { type: 'primitive', value: 1 },
        value: { type: 'primitive', value: 2 },
      }],
    });
    expect(structuredSerialize(set, ctx)).toMatchObject({
      type: 'Set',
      entries: [{ type: 'primitive', value: 3 }],
    });
    expect(structuredSerialize(buffer, ctx)).toMatchObject({
      type: 'ArrayBuffer', byteLength: 4,
    });
    expect(structuredSerialize(view, ctx)).toMatchObject({
      type: 'ArrayBufferView', constructor: 'Uint8Array',
    });
  });

  it('copies ArrayBuffers and describes their views', () => {
    const ctx = createContext();
    const buffer = new ArrayBuffer(8);
    new Uint8Array(buffer).set([1, 2, 3, 4]);
    const view = new Uint16Array(buffer, 2, 2);
    const serializedBuffer = structuredSerialize(buffer, ctx);

    expect(serializedBuffer).toMatchObject({
      type: 'ArrayBuffer',
      byteLength: 8,
    });
    if (serializedBuffer.type !== 'ArrayBuffer') {
      throw new Error('ArrayBuffer serialized to the wrong record');
    }
    expect([...serializedBuffer.bytes]).toEqual([1, 2, 3, 4, 0, 0, 0, 0]);
    new Uint8Array(buffer)[0] = 9;
    expect(serializedBuffer.bytes[0]).toBe(1);

    const serializedView = structuredSerialize(view, ctx);
    expect(serializedView).toMatchObject({
      type: 'ArrayBufferView',
      constructor: 'Uint16Array',
      buffer: { type: 'ArrayBuffer' },
      byteLength: 4,
      byteOffset: 2,
      arrayLength: 2,
    });
    expect(structuredSerialize(new DataView(buffer, 1, 3), ctx))
      .toMatchObject({
        type: 'ArrayBufferView',
        constructor: 'DataView',
        byteLength: 3,
        byteOffset: 1,
      });
  });

  it('preserves resizable buffer bounds and rejects invalid views', () => {
    const ctx = createContext();
    const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
    const serialized = structuredSerialize(buffer, ctx);

    expect(serialized).toMatchObject({
      type: 'ResizableArrayBuffer',
      byteLength: 8,
      maxByteLength: 16,
    });

    new Uint8Array(buffer).set([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(structuredSerialize(
      new Uint16Array(buffer, 2),
      ctx,
    )).toMatchObject({
      type: 'ArrayBufferView',
      byteLength: 'auto',
      arrayLength: 'auto',
    });
    expect(structuredSerialize(
      new Uint16Array(buffer, 2, 3),
      ctx,
    )).toMatchObject({
      type: 'ArrayBufferView',
      byteLength: 6,
      arrayLength: 3,
    });
    expect(structuredSerialize(
      new DataView(buffer, 1),
      ctx,
    )).toMatchObject({
      type: 'ArrayBufferView',
      byteLength: 'auto',
    });
    expect(buffer.byteLength).toBe(8);
    expect([...new Uint8Array(buffer)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const bounded = new ArrayBuffer(8, { maxByteLength: 8 });
    new Uint8Array(bounded).set([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(structuredSerialize(
      new Uint16Array(bounded, 2),
      ctx,
    )).toMatchObject({
      byteLength: 'auto',
      arrayLength: 'auto',
    });
    expect(structuredSerialize(
      new Uint16Array(bounded, 2, 3),
      ctx,
    )).toMatchObject({
      byteLength: 6,
      arrayLength: 3,
    });
    expect(structuredSerialize(
      new DataView(bounded, 1),
      ctx,
    )).toMatchObject({ byteLength: 'auto' });
    expect([...new Uint8Array(bounded)]).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);

    const view = new Uint8Array(buffer, 4, 4);
    buffer.resize(2);
    expectDataCloneError(() => structuredSerialize(view, ctx));

    const detached = new ArrayBuffer(2);
    structuredClone(detached, { transfer: [detached] });
    expectDataCloneError(() => structuredSerialize(detached, ctx));
  });

  it('shares SharedArrayBuffers only within non-storage isolated data', () => {
    const agentCluster = new AgentCluster('concrete');
    const isolated = createContext({ agentCluster, crossOriginIsolated: true });
    const unisolated = createContext({
      agentCluster,
      crossOriginIsolated: false,
    });
    const buffer = new SharedArrayBuffer(4);
    const serialized = structuredSerialize(buffer, isolated);

    expect(serialized).toMatchObject({
      type: 'SharedArrayBuffer',
      buffer,
      byteLength: 4,
      agentCluster,
    });
    const growable = new SharedArrayBuffer(4, { maxByteLength: 8 });
    expect(structuredSerialize(growable, isolated)).toMatchObject({
      type: 'GrowableSharedArrayBuffer',
      buffer: growable,
      byteLength: 4,
      maxByteLength: 8,
      agentCluster,
    });
    expectDataCloneError(() => structuredSerialize(buffer, unisolated));
    expectDataCloneError(() => structuredSerializeForStorage(buffer, isolated));
  });

  it('preserves repeated identity and cycles in arrays and objects', () => {
    const ctx = createContext();
    const child = { value: 1 };
    const source: Record<string, unknown> = { first: child, second: child };
    source.self = source;
    const first: Record<string, unknown> = {};
    const second: Record<string, unknown> = { first };
    first.second = second;
    const serialized = structuredSerialize(source, ctx);

    if (serialized.type !== 'Object') {
      throw new Error('Object serialized to the wrong record');
    }
    const properties = Object.fromEntries(
      serialized.properties.map(({ key, value }) => [key, value]),
    );
    expect(properties.first).toBe(properties.second);
    expect(properties.self).toBe(serialized);
    const serializedMutual = structuredSerialize(first, ctx);
    if (serializedMutual.type !== 'Object') {
      throw new Error('Object serialized to the wrong record');
    }
    const serializedSecond = serializedMutual.properties[0]!.value;
    if (serializedSecond.type !== 'Object') {
      throw new Error('Nested object serialized to the wrong record');
    }
    expect(serializedSecond.properties[0]!.value).toBe(serializedMutual);

    const sparse: unknown[] = [];
    sparse.length = 4;
    sparse[2] = sparse;
    Reflect.set(sparse, 'extra', 3);
    const serializedSparse = structuredSerialize(sparse, ctx);
    expect(serializedSparse).toMatchObject({
      type: 'Array',
      length: 4,
      properties: [
        { key: '2' },
        { key: 'extra', value: { type: 'primitive', value: 3 } },
      ],
    });
    if (serializedSparse.type !== 'Array') {
      throw new Error('Array serialized to the wrong record');
    }
    expect(serializedSparse.properties[0]?.value).toBe(serializedSparse);
  });

  it('snapshots Map and Set data before recursive serialization', () => {
    const ctx = createContext();
    const map = new Map<unknown, unknown>();
    const mutator = Object.defineProperty({}, 'run', {
      enumerable: true,
      get() {
        map.set('late', 2);
        return 1;
      },
    });
    map.set('first', mutator);
    map.set(map, 'self');
    const serializedMap = structuredSerialize(map, ctx);

    if (serializedMap.type !== 'Map') {
      throw new Error('Map serialized to the wrong record');
    }
    expect(serializedMap.entries).toHaveLength(2);
    expect(serializedMap.entries[1]?.key).toBe(serializedMap);
    expect(map.has('late')).toBe(true);

    const set = new Set<unknown>();
    set.add('first');
    set.add(set);
    const serializedSet = structuredSerialize(set, ctx);
    if (serializedSet.type !== 'Set') {
      throw new Error('Set serialized to the wrong record');
    }
    expect(serializedSet.entries[1]).toBe(serializedSet);
  });

  it('serializes specified Error state without invoking message accessors', () => {
    const ctx = createContext();
    const { realm } = ctx;
    const error = realm.evaluate(`(() => {
      const error = new TypeError('bad');
      error.name = 'RangeError';
      return error;
    })()`, 'structured-serialize-error.js') as object;
    const serialized = structuredSerialize(error, ctx);

    expect(serialized).toMatchObject({
      type: 'Error',
      name: 'RangeError',
      message: 'bad',
    });
    if (serialized.type !== 'Error') {
      throw new Error('Error serialized to the wrong record');
    }
    expect(serialized.stack).toBeTypeOf('string');

    const accessorMessage = new Error();
    Object.defineProperty(accessorMessage, 'message', {
      get() {
        throw new Error('must not run');
      },
    });
    expect(structuredSerialize(accessorMessage, ctx)).toMatchObject({
      type: 'Error', message: undefined,
    });

    let stackGetterRan = false;
    const accessorStack = new Error();
    Object.defineProperty(accessorStack, 'stack', {
      get() {
        stackGetterRan = true;
        return 'author stack';
      },
    });
    expect(structuredSerialize(accessorStack, ctx)).toMatchObject({
      type: 'Error', stack: '',
    });
    expect(stackGetterRan).toBe(false);

    const symbolMessage = realm.evaluate(`(() => {
      const error = new Error();
      Object.defineProperty(error, 'message', { value: Symbol() });
      return error;
    })()`, 'structured-serialize-symbol-message.js') as object;
    expect(() => structuredSerialize(symbolMessage, ctx))
      .toThrow(TypeErrorRequest);
  });

  it('serializes Error cause through the shared graph memory', () => {
    const ctx = createContext();
    const cause: Record<string, unknown> = { marker: 'cause' };
    const error = new Error('failed', { cause });
    cause.error = error;

    const serialized = structuredSerialize(error, ctx);

    expect(serialized.type).toBe('Error');
    if (serialized.type !== 'Error' || serialized.cause === undefined) {
      throw new Error('Error cause was not serialized');
    }
    expect(serialized.cause.type).toBe('Object');
    if (serialized.cause.type !== 'Object') {
      throw new Error('Error cause serialized to the wrong record');
    }
    expect(serialized.cause.properties).toContainEqual({
      key: 'error',
      value: serialized,
    });
  });

  it('uses enumerable-key snapshots and propagates author exceptions', () => {
    const ctx = createContext();
    const expected = new Error('getter failure');
    const source = Object.defineProperties({}, {
      hidden: { enumerable: false, value: 1 },
      visible: { enumerable: true, value: 2 },
    });
    expect(structuredSerialize(source, ctx)).toEqual({
      type: 'Object',
      properties: [{
        key: 'visible',
        value: { type: 'primitive', value: 2 },
      }],
    });

    const failure = Object.defineProperty({}, 'value', {
      enumerable: true,
      get() {
        throw expected;
      },
    });
    expect(() => structuredSerialize(failure, ctx)).toThrow(expected);
  });

  it('rejects callable, proxy, and unsupported internal-slot objects', () => {
    const ctx = createContext();
    let proxyTrapRan = false;
    const proxy = new Proxy([], {
      ownKeys() {
        proxyTrapRan = true;
        return [];
      },
    });
    const unsupported = [
      () => {},
      Promise.resolve(),
      new WeakMap(),
      new WeakSet(),
      new WeakRef({}),
      new FinalizationRegistry(() => {}),
      new Map().entries(),
      new Set().values(),
      proxy,
    ];

    for (const value of unsupported) {
      expectDataCloneError(() => structuredSerialize(value, ctx));
    }
    expect(proxyTrapRan).toBe(false);
  });

  it('rejects Array Iterator internal slots without advancing it', () => {
    const ctx = createContext();
    const iterator = [1, 2][Symbol.iterator]();
    expectDataCloneError(() => structuredSerialize(iterator, ctx));
    expect(iterator.next()).toEqual({ value: 1, done: false });
  });

  it('rejects String Iterator internal slots without advancing it', () => {
    const ctx = createContext();
    const iterator = 'ab'[Symbol.iterator]();
    expectDataCloneError(() => structuredSerialize(iterator, ctx));
    expect(iterator.next()).toEqual({ value: 'a', done: false });
  });

  it('does not infer Iterator slots from the prototype alone', () => {
    const ctx = createContext();
    const iteratorPrototype = Reflect.getPrototypeOf(
      [][Symbol.iterator](),
    )!;
    const impostor = Object.create(iteratorPrototype) as object;

    expect(structuredSerialize(impostor, ctx)).toEqual({
      type: 'Object',
      properties: [],
    });
  });

  it.fails('rejects decorated Array Iterator internal slots', () => {
    const ctx = createContext();
    const iterator = Object.assign([][Symbol.iterator](), { marker: true });
    expectDataCloneError(() => structuredSerialize(iterator, ctx));
  });

  it('dispatches serializable platform objects by exact primary interface', () => {
    const ctx = createContext();
    const { realm } = ctx;
    const DOMException_ = Reflect.get(
      realm.global,
      'DOMException',
    ) as typeof DOMException;
    const source = new DOMException_('message', 'IndexSizeError');
    Reflect.set(source, 'ignored', true);
    const serialized = structuredSerialize(source, ctx);

    expect(serialized).toMatchObject({
      type: 'platform-object',
      interfaceName: 'DOMException',
    });
    if (serialized.type !== 'platform-object') {
      throw new Error('DOMException serialized to the wrong record');
    }
    expect(serialized.fields.get('Name')).toBe('IndexSizeError');
    expect(serialized.fields.get('Message')).toBe('message');
    expect(serialized.fields.has('ignored')).toBe(false);
  });

  it('binds platform sub-serialization to the same memory and storage mode', () => {
    class ContainerImpl {
      child: unknown;

      constructor() {
        this.child = this;
      }
    }

    const containerIDL = defineInterface({
      name: 'SerializableContainer',
      exposed: '*',
      ...xattr('Serializable'),
      implementation: impl(ContainerImpl),
      members: [],
    });
    const capabilities = [serializable.for(containerIDL, {
      serializationSteps(value, record, forStorage, context) {
        const container = value as ContainerImpl;
        record.set('Child', context.subserialize(container.child));
        record.set('ForStorage', forStorage);
      },
      deserializationSteps() {},
    })];
    const bindings = new BindingWorld<Realm>([containerIDL], { capabilities });
    const realm = new Realm();
    const ctx = bindings.register(realm);
    const container = ctx.createPlatformRecord(containerIDL);
    const implInst = ctx.unwrap(container.platformObject, ContainerImpl)!;
    implInst.child = container.platformObject;
    const serialized = structuredSerializeForStorage(
      container.platformObject,
      ctx,
    );

    if (serialized.type !== 'platform-object') {
      throw new Error('Container serialized to the wrong record');
    }
    expect(serialized.fields.get('Child')).toBe(serialized);
    expect(serialized.fields.get('ForStorage')).toBe(true);
  });

  it('uses caller memory internally and fresh memory in each wrapper call', () => {
    const ctx = createContext();
    const source = {};
    const memory = new Map<unknown, SerializedRecord>();
    const first = structuredSerializeInternal(
      source,
      false,
      ctx,
      memory,
    );
    const second = structuredSerializeInternal(
      source,
      false,
      ctx,
      memory,
    );

    expect(second).toBe(first);
    expect(structuredSerialize(source, ctx)).not.toBe(first);
    expect(structuredSerializeForStorage(source, ctx)).not.toBe(first);
  });
});

function createContext(options: {
  agentCluster?: AgentCluster;
  crossOriginIsolated?: boolean;
} = {}): BindingContext<Realm> {
  const bindings = new BindingWorld<Realm>([], {
    capabilities: domExceptionCapabilities,
  });
  const realm = new Realm({
    crossOriginIsolated: options.crossOriginIsolated,
  });
  const agentCluster = options.agentCluster ?? new AgentCluster(
    options.crossOriginIsolated ? 'concrete' : 'none',
  );
  agentCluster.add(realm.agent);
  const ctx = bindings.register(realm);
  ctx.install(realm.global);
  return ctx;
}

function expectDataCloneError(steps: () => unknown): void {
  try {
    steps();
  } catch (error) {
    expect(InternalDOMException.is(error)).toBe(true);
    expect(error).toMatchObject({
      message: '',
      name: 'DataCloneError',
    });
    return;
  }
  throw new Error('Expected a DataCloneError DOMException');
}

function serializedValue(record: SerializedRecord): unknown {
  return 'value' in record ? record.value : undefined;
}

function recordValue(record: SerializedRecord): unknown {
  return 'value' in record ? record.value : undefined;
}
