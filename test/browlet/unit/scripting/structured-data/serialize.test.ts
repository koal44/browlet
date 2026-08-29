import { describe, expect, it } from 'vitest';

import {
  getDOMExceptionRequest,
} from '../../../../../src/shared/dom-exception';
import {
  createBindings, defineInterface, impl, xattr,
} from '../../../../../src/web-idl/index';
import { Realm } from '../../../../../src/browlet/scripting/realm';
import {
  domExceptionCapabilities,
} from '../../../../../src/browlet/scripting/structured-data/platform-objects/dom-exception';
import type {
  SerializedRecord,
} from '../../../../../src/browlet/scripting/structured-data/records';
import {
  structuredSerialize, structuredSerializeForStorage,
  structuredSerializeInternal, type StructuredSerializationEnvironment,
} from '../../../../../src/browlet/scripting/structured-data/serialize';
import {
  serializable,
} from '../../../../../src/browlet/scripting/structured-data/serializable';

describe('HTML structured serialization', () => {
  it('serializes primitive values and rejects symbols', () => {
    const environment = createEnvironment().environment;
    const primitives = [
      undefined, null, false, true, -0, 1, NaN, 1n, '', 'value',
    ];

    for (const value of primitives) {
      const serialized = structuredSerialize(value, environment);
      expect(serialized).toEqual({ type: 'primitive', value });
      if (Object.is(value, -0)) {
        expect(Object.is(serializedValue(serialized), -0)).toBe(true);
      }
    }
    expectDataCloneError(() => structuredSerialize(Symbol(), environment));
  });

  it('reads boxed primitives and built-ins by slots across realms', () => {
    const { environment, realm } = createEnvironment();
    const values = realm.evaluate(`[
      new Boolean(false),
      new Number(-0),
      Object(2n),
      new String('text'),
      new Date(1234),
      /a+/dgimsy,
    ]`, 'structured-serialize-builtins.js') as object[];

    expect(structuredSerialize(values[0], environment)).toEqual({
      type: 'Boolean', value: false,
    });
    const number = structuredSerialize(values[1], environment);
    expect(number.type).toBe('Number');
    expect(Object.is(recordValue(number), -0)).toBe(true);
    expect(structuredSerialize(values[2], environment)).toEqual({
      type: 'BigInt', value: 2n,
    });
    expect(structuredSerialize(values[3], environment)).toEqual({
      type: 'String', value: 'text',
    });
    expect(structuredSerialize(values[4], environment)).toEqual({
      type: 'Date', value: 1234,
    });
    expect(structuredSerialize(values[5], environment)).toEqual({
      type: 'RegExp', source: 'a+', flags: 'dgimsy',
    });
    expectDataCloneError(
      () => structuredSerialize(realm.evaluate(
        'Object(Symbol())',
        'structured-serialize-symbol.js',
      ), environment),
    );
  });

  it('recognizes collection and buffer slots across realms', () => {
    const { environment, realm } = createEnvironment();
    const [map, set, buffer, view] = realm.evaluate(`(() => {
      const buffer = new ArrayBuffer(4);
      return [new Map([[1, 2]]), new Set([3]), buffer, new Uint8Array(buffer)];
    })()`, 'structured-serialize-cross-realm.js') as object[];

    expect(structuredSerialize(map, environment)).toMatchObject({
      type: 'Map',
      entries: [{
        key: { type: 'primitive', value: 1 },
        value: { type: 'primitive', value: 2 },
      }],
    });
    expect(structuredSerialize(set, environment)).toMatchObject({
      type: 'Set',
      entries: [{ type: 'primitive', value: 3 }],
    });
    expect(structuredSerialize(buffer, environment)).toMatchObject({
      type: 'ArrayBuffer', byteLength: 4,
    });
    expect(structuredSerialize(view, environment)).toMatchObject({
      type: 'ArrayBufferView', constructor: 'Uint8Array',
    });
  });

  it('copies ArrayBuffers and describes their views', () => {
    const environment = createEnvironment().environment;
    const buffer = new ArrayBuffer(8);
    new Uint8Array(buffer).set([1, 2, 3, 4]);
    const view = new Uint16Array(buffer, 2, 2);
    const serializedBuffer = structuredSerialize(buffer, environment);

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

    const serializedView = structuredSerialize(view, environment);
    expect(serializedView).toMatchObject({
      type: 'ArrayBufferView',
      constructor: 'Uint16Array',
      buffer: { type: 'ArrayBuffer' },
      byteLength: 4,
      byteOffset: 2,
      arrayLength: 2,
    });
    expect(structuredSerialize(new DataView(buffer, 1, 3), environment))
      .toMatchObject({
        type: 'ArrayBufferView',
        constructor: 'DataView',
        byteLength: 3,
        byteOffset: 1,
      });
  });

  it('preserves resizable buffer bounds and rejects invalid views', () => {
    const environment = createEnvironment().environment;
    const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
    const serialized = structuredSerialize(buffer, environment);

    expect(serialized).toMatchObject({
      type: 'ResizableArrayBuffer',
      byteLength: 8,
      maxByteLength: 16,
    });

    new Uint8Array(buffer).set([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(structuredSerialize(
      new Uint16Array(buffer, 2),
      environment,
    )).toMatchObject({
      type: 'ArrayBufferView',
      byteLength: 'auto',
      arrayLength: 'auto',
    });
    expect(structuredSerialize(
      new Uint16Array(buffer, 2, 3),
      environment,
    )).toMatchObject({
      type: 'ArrayBufferView',
      byteLength: 6,
      arrayLength: 3,
    });
    expect(structuredSerialize(
      new DataView(buffer, 1),
      environment,
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
      environment,
    )).toMatchObject({
      byteLength: 'auto',
      arrayLength: 'auto',
    });
    expect(structuredSerialize(
      new Uint16Array(bounded, 2, 3),
      environment,
    )).toMatchObject({
      byteLength: 6,
      arrayLength: 3,
    });
    expect(structuredSerialize(
      new DataView(bounded, 1),
      environment,
    )).toMatchObject({ byteLength: 'auto' });
    expect([...new Uint8Array(bounded)]).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);

    const view = new Uint8Array(buffer, 4, 4);
    buffer.resize(2);
    expectDataCloneError(() => structuredSerialize(view, environment));

    const detached = new ArrayBuffer(2);
    structuredClone(detached, { transfer: [detached] });
    expectDataCloneError(() => structuredSerialize(detached, environment));
  });

  it('shares SharedArrayBuffers only within non-storage isolated data', () => {
    const agentCluster = {};
    const isolated = createEnvironment({ agentCluster, crossOriginIsolated: true })
      .environment;
    const unisolated = createEnvironment({
      agentCluster,
      crossOriginIsolated: false,
    }).environment;
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
    const environment = createEnvironment().environment;
    const child = { value: 1 };
    const source: Record<string, unknown> = { first: child, second: child };
    source.self = source;
    const first: Record<string, unknown> = {};
    const second: Record<string, unknown> = { first };
    first.second = second;
    const serialized = structuredSerialize(source, environment);

    if (serialized.type !== 'Object') {
      throw new Error('Object serialized to the wrong record');
    }
    const properties = Object.fromEntries(
      serialized.properties.map(({ key, value }) => [key, value]),
    );
    expect(properties.first).toBe(properties.second);
    expect(properties.self).toBe(serialized);
    const serializedMutual = structuredSerialize(first, environment);
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
    const serializedSparse = structuredSerialize(sparse, environment);
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
    const environment = createEnvironment().environment;
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
    const serializedMap = structuredSerialize(map, environment);

    if (serializedMap.type !== 'Map') {
      throw new Error('Map serialized to the wrong record');
    }
    expect(serializedMap.entries).toHaveLength(2);
    expect(serializedMap.entries[1]?.key).toBe(serializedMap);
    expect(map.has('late')).toBe(true);

    const set = new Set<unknown>();
    set.add('first');
    set.add(set);
    const serializedSet = structuredSerialize(set, environment);
    if (serializedSet.type !== 'Set') {
      throw new Error('Set serialized to the wrong record');
    }
    expect(serializedSet.entries[1]).toBe(serializedSet);
  });

  it('serializes specified Error state without invoking message accessors', () => {
    const { environment, realm } = createEnvironment();
    const error = realm.evaluate(`(() => {
      const error = new TypeError('bad');
      error.name = 'RangeError';
      return error;
    })()`, 'structured-serialize-error.js') as object;
    const serialized = structuredSerialize(error, environment);

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
    expect(structuredSerialize(accessorMessage, environment)).toMatchObject({
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
    expect(structuredSerialize(accessorStack, environment)).toMatchObject({
      type: 'Error', stack: '',
    });
    expect(stackGetterRan).toBe(false);

    const symbolMessage = realm.evaluate(`(() => {
      const error = new Error();
      Object.defineProperty(error, 'message', { value: Symbol() });
      return error;
    })()`, 'structured-serialize-symbol-message.js') as object;
    const TypeError_ = Reflect.get(realm.global, 'TypeError') as typeof TypeError;
    expect(() => structuredSerialize(symbolMessage, environment))
      .toThrow(TypeError_);
  });

  it('serializes Error cause through the shared graph memory', () => {
    const environment = createEnvironment().environment;
    const cause: Record<string, unknown> = { marker: 'cause' };
    const error = new Error('failed', { cause });
    cause.error = error;

    const serialized = structuredSerialize(error, environment);

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
    const environment = createEnvironment().environment;
    const expected = new Error('getter failure');
    const source = Object.defineProperties({}, {
      hidden: { enumerable: false, value: 1 },
      visible: { enumerable: true, value: 2 },
    });
    expect(structuredSerialize(source, environment)).toEqual({
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
    expect(() => structuredSerialize(failure, environment)).toThrow(expected);
  });

  it('rejects callable, proxy, and unsupported internal-slot objects', () => {
    const environment = createEnvironment().environment;
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
      expectDataCloneError(() => structuredSerialize(value, environment));
    }
    expect(proxyTrapRan).toBe(false);
  });

  it('rejects Array Iterator internal slots without advancing it', () => {
    const environment = createEnvironment().environment;
    const iterator = [1, 2][Symbol.iterator]();
    expectDataCloneError(() => structuredSerialize(iterator, environment));
    expect(iterator.next()).toEqual({ value: 1, done: false });
  });

  it('rejects String Iterator internal slots without advancing it', () => {
    const environment = createEnvironment().environment;
    const iterator = 'ab'[Symbol.iterator]();
    expectDataCloneError(() => structuredSerialize(iterator, environment));
    expect(iterator.next()).toEqual({ value: 'a', done: false });
  });

  it('does not infer Iterator slots from the prototype alone', () => {
    const environment = createEnvironment().environment;
    const iteratorPrototype = Reflect.getPrototypeOf(
      [][Symbol.iterator](),
    )!;
    const impostor = Object.create(iteratorPrototype) as object;

    expect(structuredSerialize(impostor, environment)).toEqual({
      type: 'Object',
      properties: [],
    });
  });

  it.fails('rejects decorated Array Iterator internal slots', () => {
    const environment = createEnvironment().environment;
    const iterator = Object.assign([][Symbol.iterator](), { marker: true });
    expectDataCloneError(() => structuredSerialize(iterator, environment));
  });

  it('dispatches serializable platform objects by exact primary interface', () => {
    const { environment, realm } = createEnvironment();
    const DOMException_ = Reflect.get(
      realm.global,
      'DOMException',
    ) as typeof DOMException;
    const source = new DOMException_('message', 'IndexSizeError');
    Reflect.set(source, 'ignored', true);
    const serialized = structuredSerialize(source, environment);

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
    const bindings = createBindings([containerIDL], { capabilities });
    const realm = new Realm();
    const registration = bindings.register(realm);
    const container = registration.context.createPlatformObject(containerIDL);
    const implementation = container.implementation as ContainerImpl;
    implementation.child = container.platformObject;
    const environment: StructuredSerializationEnvironment = {
      agentCluster: {},
      context: registration.context,
      realm,
    };
    const serialized = structuredSerializeForStorage(
      container.platformObject,
      environment,
    );

    if (serialized.type !== 'platform-object') {
      throw new Error('Container serialized to the wrong record');
    }
    expect(serialized.fields.get('Child')).toBe(serialized);
    expect(serialized.fields.get('ForStorage')).toBe(true);
  });

  it('uses caller memory internally and fresh memory in each wrapper call', () => {
    const environment = createEnvironment().environment;
    const source = {};
    const memory = new Map<unknown, SerializedRecord>();
    const first = structuredSerializeInternal(
      source,
      false,
      environment,
      memory,
    );
    const second = structuredSerializeInternal(
      source,
      false,
      environment,
      memory,
    );

    expect(second).toBe(first);
    expect(structuredSerialize(source, environment)).not.toBe(first);
    expect(structuredSerializeForStorage(source, environment)).not.toBe(first);
  });
});

function createEnvironment(options: {
  agentCluster?: object;
  crossOriginIsolated?: boolean;
} = {}): {
  environment: StructuredSerializationEnvironment;
  realm: Realm;
} {
  const bindings = createBindings([], {
    capabilities: domExceptionCapabilities,
  });
  const realm = new Realm({
    crossOriginIsolated: options.crossOriginIsolated,
  });
  const registration = bindings.register(realm);
  registration.install(realm.global);
  return {
    environment: {
      agentCluster: options.agentCluster ?? {},
      context: registration.context,
      realm,
    },
    realm,
  };
}

function expectDataCloneError(steps: () => unknown): void {
  try {
    steps();
  } catch (error) {
    expect(getDOMExceptionRequest(error)).toEqual({
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
