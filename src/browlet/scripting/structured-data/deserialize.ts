import {
  appendMapData, appendSetData, getBufferTypeName, isObject, writeErrorStack,
} from '../../../js-engine/index';
import {
  throwDOMException, type BindingContext, type PlatformRecord,
} from '../../../web-idl/index';
import type { Realm } from '../realm';
import type {
  ErrorSerializedRecord, SerializedErrorName, SerializedRecord,
  StructuredDeserializeMemory,
} from './records';
import { serializable } from './serializable';

/** HTML §2.7.6, StructuredDeserialize. */
// BINDING_INTEGRATION: reconstruct platform objects in the destination realm.
export function structuredDeserialize(
  serialized: SerializedRecord,
  ctx: BindingContext<Realm>,
  memory: StructuredDeserializeMemory = new Map(),
): unknown {
  if (memory.has(serialized)) return memory.get(serialized);

  let value: unknown;
  let deep = false;
  let platformRecord: PlatformRecord | undefined;
  const { realm } = ctx;

  switch (serialized.type) {
    case 'primitive':
      value = serialized.value;
      break;
    case 'Boolean':
      value = Reflect.construct(realm.intrinsics.boolean, [serialized.value]);
      break;
    case 'Number':
      value = Reflect.construct(realm.intrinsics.number, [serialized.value]);
      break;
    case 'BigInt':
      value = Reflect.apply(
        realm.intrinsics.object,
        undefined,
        [serialized.value],
      );
      break;
    case 'String':
      value = Reflect.construct(realm.intrinsics.string, [serialized.value]);
      break;
    case 'Date':
      value = Reflect.construct(realm.intrinsics.date, [serialized.value]);
      break;
    case 'RegExp':
      value = Reflect.construct(
        realm.intrinsics.regExp,
        [serialized.source, serialized.flags],
      );
      break;
    case 'SharedArrayBuffer':
    case 'GrowableSharedArrayBuffer':
      if (ctx.realm.agent.agentCluster !== serialized.agentCluster) {
        return throwDOMException('DataCloneError');
      }
      value = deserializeSharedArrayBuffer(serialized.buffer, realm);
      break;
    case 'ArrayBuffer':
    case 'ResizableArrayBuffer':
      value = deserializeArrayBuffer(serialized, realm);
      break;
    case 'ArrayBufferView': {
      const buffer = structuredDeserialize(
        serialized.buffer,
        ctx,
        memory,
      );
      if (!isObject(buffer)) {
        throw new Error('An ArrayBufferView record has no backing buffer');
      }
      const length = serialized.constructor === 'DataView'
        ? serialized.byteLength
        : serialized.arrayLength;
      if (length === undefined) {
        throw new Error(`${serialized.constructor} has no serialized array length`);
      }
      value = realm.createView(
        serialized.constructor,
        buffer as ArrayBufferLike,
        serialized.byteOffset,
        length === 'auto' ? undefined : length,
      );
      break;
    }
    case 'Map':
      value = Reflect.construct(realm.intrinsics.map, []);
      deep = true;
      break;
    case 'Set':
      value = Reflect.construct(realm.intrinsics.set, []);
      deep = true;
      break;
    case 'Array':
      value = Reflect.construct(realm.intrinsics.array, [serialized.length]);
      deep = true;
      break;
    case 'Object':
      value = realm.createOrdinaryObject(realm.intrinsics.objectPrototype);
      deep = true;
      break;
    case 'Error':
      value = deserializeError(serialized, realm);
      deep = true;
      break;
    case 'platform-object': {
      const definition = ctx.getInterface(
        serialized.interfaceName,
      );
      if (!definition || !ctx.isInterfaceExposed(definition)) {
        return throwDOMException('DataCloneError');
      }
      platformRecord = ctx.createPlatformRecord(definition);
      value = platformRecord.platformObject;
      deep = true;
      break;
    }
    case 'transfer-placeholder':
      throw new Error('Transfer placeholder has no received value');
  }

  memory.set(serialized, value);
  if (!deep) return value;
  if (!isObject(value)) {
    throw new Error('A deep record has no object value');
  }

  if (serialized.type === 'Map') {
    for (const entry of serialized.entries) {
      appendMapData(
        value,
        structuredDeserialize(entry.key, ctx, memory),
        structuredDeserialize(entry.value, ctx, memory),
      );
    }
  } else if (serialized.type === 'Set') {
    for (const entry of serialized.entries) {
      appendSetData(
        value,
        structuredDeserialize(entry, ctx, memory),
      );
    }
  } else if (serialized.type === 'Error') {
    deserializeErrorCause(serialized, value, ctx, memory);
  } else if (serialized.type === 'Array' || serialized.type === 'Object') {
    deserializeProperties(serialized.properties, value, ctx, memory);
  } else if (serialized.type === 'platform-object') {
    if (!platformRecord) {
      throw new Error('A platform-object record was not created');
    }
    const steps = ctx.getCapability(
      platformRecord.primaryInterface.definition,
      serializable,
    );
    if (!steps) {
      throw new Error(
        `${platformRecord.primaryInterface.definition.name} has no Serializable capability`,
      );
    }
    steps.deserializationSteps(
      serialized.fields,
      platformRecord.implInst,
      realm,
      {
        unwrap: (platformObject, implClass) =>
          ctx.unwrap(platformObject, implClass),
        subdeserialize: (subSerialized) => {
          if (!isSerializedRecord(subSerialized)) {
            throw new TypeError('Sub-deserialization requires a serialized record');
          }
          return structuredDeserialize(
            subSerialized,
            ctx,
            memory,
          );
        },
      },
    );
  } else {
    throw new Error(`Unsupported deep record ${serialized.type}`);
  }

  return value;
}

/** HTML §2.7.6, SharedArrayBuffer and GrowableSharedArrayBuffer branches. */
function deserializeSharedArrayBuffer(
  buffer: object,
  realm: Realm,
): object {
  if (getBufferTypeName(buffer) !== 'SharedArrayBuffer') {
    throw new Error('Only a SharedArrayBuffer can share its backing store');
  }
  const value = realm.intrinsics.bufferSource.cloneSharedArrayBuffer(buffer);
  if (getBufferTypeName(value) !== 'SharedArrayBuffer') {
    throw new Error('The host did not clone a SharedArrayBuffer');
  }
  const constructor = realm.intrinsics.bufferSource.sharedArrayBuffer;
  if (!constructor) {
    throw new Error('The target realm has no SharedArrayBuffer intrinsic');
  }
  if (!Reflect.setPrototypeOf(value, constructor.prototype)) {
    throw new Error('Could not apply the target SharedArrayBuffer prototype');
  }
  return value;
}

/** HTML §2.7.6, ArrayBuffer and ResizableArrayBuffer branches. */
function deserializeArrayBuffer(
  serialized: Extract<SerializedRecord, {
    type: 'ArrayBuffer' | 'ResizableArrayBuffer';
  }>,
  realm: Realm,
): ArrayBuffer {
  try {
    return realm.createArrayBuffer(
      serialized.bytes,
      serialized.maxByteLength,
    );
  } catch {
    return throwDOMException('DataCloneError');
  }
}

/** HTML §2.7.6, enumerable own-property deserialization. */
function deserializeProperties(
  properties: Extract<SerializedRecord, {
    type: 'Array' | 'Object';
  }>['properties'],
  value: object,
  ctx: BindingContext<Realm>,
  memory: StructuredDeserializeMemory,
): void {
  for (const entry of properties) {
    const status = Reflect.defineProperty(value, entry.key, {
      configurable: true,
      enumerable: true,
      value: structuredDeserialize(entry.value, ctx, memory),
      writable: true,
    });
    if (!status) throw new Error(`Could not deserialize property ${entry.key}`);
  }
}

/** HTML §2.7.6, the [[ErrorData]] branch. */
function deserializeError(
  serialized: ErrorSerializedRecord,
  realm: Realm,
): object {
  const constructor = getErrorConstructor(serialized.name, realm);
  const value = Reflect.construct(
    constructor,
    serialized.message === undefined ? [] : [serialized.message],
  ) as object;
  writeErrorStack(value, serialized.stack);
  return value;
}

/** HTML §2.7.6, interesting accompanying [[ErrorData]]. */
function deserializeErrorCause(
  serialized: ErrorSerializedRecord,
  value: object,
  ctx: BindingContext<Realm>,
  memory: StructuredDeserializeMemory,
): void {
  if (serialized.cause === undefined) return;
  const status = Reflect.defineProperty(value, 'cause', {
    configurable: true,
    enumerable: false,
    value: structuredDeserialize(serialized.cause, ctx, memory),
    writable: true,
  });
  if (!status) throw new Error('Could not restore serialized Error cause');
}

function getErrorConstructor(
  name: SerializedErrorName,
  realm: Realm,
): ErrorConstructor {
  switch (name) {
    case 'EvalError': return realm.intrinsics.evalError;
    case 'RangeError': return realm.intrinsics.rangeError;
    case 'ReferenceError': return realm.intrinsics.referenceError;
    case 'SyntaxError': return realm.intrinsics.syntaxError;
    case 'TypeError': return realm.intrinsics.typeError;
    case 'URIError': return realm.intrinsics.uriError;
    default: return realm.intrinsics.error;
  }
}

function isSerializedRecord(value: unknown): value is SerializedRecord {
  return isObject(value) &&
    typeof Reflect.get(value, 'type') === 'string';
}
