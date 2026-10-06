import type { ScriptingEnvironment } from '../environment';
import {
  appendMapData, appendSetData, isAnyArrayBuffer, isObject, writeErrorStack,
} from '../../../js-engine/index';
import {
  DOMExceptionImpl, DOMExceptionNames, type BindingContext, type PlatformRecord,
} from '../../../web-idl/index';
import type { Realm } from '../realm';
import type {
  ErrorSerializedRecord, SerializedErrorName, SerializedRecord,
  StructuredDeserializeMemory,
} from './records';
import { InternalError } from '../../../infra/internal-error';

/** HTML §2.7.6, StructuredDeserialize. */
// BINDING_INTEGRATION: reconstruct platform objects in the destination realm.
export function structuredDeserialize(
  serialized: SerializedRecord,
  ctx: BindingContext<ScriptingEnvironment>,
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
        throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
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
      if (!isAnyArrayBuffer(buffer)) {
        throw new InternalError('An ArrayBufferView record has no backing buffer');
      }
      const length = serialized.constructor === 'DataView'
        ? serialized.byteLength
        : serialized.arrayLength;
      if (length === undefined) {
        throw new InternalError(`${serialized.constructor} has no serialized array length`);
      }
      value = realm.createView(
        serialized.constructor,
        buffer,
        serialized.byteOffset,
        length === 'auto' ? undefined : length,
      );
      break;
    }
    case 'Map': {
      const value = new realm.intrinsics.map<unknown, unknown>();
      memory.set(serialized, value);
      for (const entry of serialized.entries) {
        appendMapData(
          value,
          structuredDeserialize(entry.key, ctx, memory),
          structuredDeserialize(entry.value, ctx, memory),
        );
      }
      return value;
    }
    case 'Set': {
      const value = new realm.intrinsics.set<unknown>();
      memory.set(serialized, value);
      for (const entry of serialized.entries) {
        appendSetData(value, structuredDeserialize(entry, ctx, memory));
      }
      return value;
    }
    case 'Array':
      value = Reflect.construct(realm.intrinsics.array, [serialized.length]);
      deep = true;
      break;
    case 'Object':
      value = realm.createOrdinaryObject(realm.intrinsics.objectPrototype);
      deep = true;
      break;
    case 'Error': {
      const value = deserializeError(serialized, realm);
      memory.set(serialized, value);
      deserializeErrorCause(serialized, value, ctx, memory);
      return value;
    }
    case 'platform-object': {
      platformRecord = ctx.createPlatformRecord(serialized.interfaceName);
      if (!platformRecord) throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
      value = platformRecord.platformObject;
      deep = true;
      break;
    }
    case 'transfer-placeholder':
      throw new InternalError('Transfer placeholder has no received value');
  }

  memory.set(serialized, value);
  if (!deep) return value;
  if (!isObject(value)) {
    throw new InternalError('A deep record has no object value');
  }

  if (serialized.type === 'Array' || serialized.type === 'Object') {
    deserializeProperties(serialized.properties, value, ctx, memory);
  } else if (serialized.type === 'platform-object') {
    if (!platformRecord) {
      throw new InternalError('A platform-object record was not created');
    }
    const steps = platformRecord.assembled.serialSteps;
    if (!steps) {
      throw new InternalError(
        `${platformRecord.assembled.name} has no serialization steps`,
      );
    }
    platformRecord.deserializationSteps(
      serialized.fields,
      {
        unwrap: (platformObject, implClass) => {
          const implementation = ctx.unwrap(platformObject, implClass);
          if (!implementation) {
            throw new InternalError('Deserialized value does not implement the expected interface');
          }
          return implementation;
        },
        subdeserialize: (subSerialized) => {
          if (!isSerializedRecord(subSerialized)) {
            throw new InternalError('Sub-deserialization requires a serialized record');
          }
          return structuredDeserialize(
            subSerialized,
            ctx,
            memory,
          );
        },
      },
      steps,
    );
  } else {
    throw new InternalError(`Unsupported deep record ${serialized.type}`);
  }

  return value;
}

/** HTML §2.7.6, SharedArrayBuffer and GrowableSharedArrayBuffer branches. */
function deserializeSharedArrayBuffer(
  buffer: SharedArrayBuffer,
  realm: Realm,
): SharedArrayBuffer {
  const value = realm.intrinsics.bufferSource.cloneSharedArrayBuffer(buffer);
  const constructor = realm.intrinsics.bufferSource.sharedArrayBuffer;
  if (!constructor) {
    throw new InternalError('The target realm has no SharedArrayBuffer intrinsic');
  }
  if (!Reflect.setPrototypeOf(value, constructor.prototype)) {
    throw new InternalError('Could not apply the target SharedArrayBuffer prototype');
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
    throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
  }
}

/** HTML §2.7.6, enumerable own-property deserialization. */
function deserializeProperties(
  properties: Extract<SerializedRecord, {
    type: 'Array' | 'Object';
  }>['properties'],
  value: object,
  ctx: BindingContext<ScriptingEnvironment>,
  memory: StructuredDeserializeMemory,
): void {
  for (const entry of properties) {
    const status = Reflect.defineProperty(value, entry.key, {
      configurable: true,
      enumerable: true,
      value: structuredDeserialize(entry.value, ctx, memory),
      writable: true,
    });
    if (!status) throw new InternalError(`Could not deserialize property ${entry.key}`);
  }
}

/** HTML §2.7.6, the [[ErrorData]] branch. */
function deserializeError(
  serialized: ErrorSerializedRecord,
  realm: Realm,
): Error {
  const constructor = getErrorConstructor(serialized.name, realm);
  const value = new constructor(serialized.message);
  writeErrorStack(value, serialized.stack);
  return value;
}

/** HTML §2.7.6, interesting accompanying [[ErrorData]]. */
function deserializeErrorCause(
  serialized: ErrorSerializedRecord,
  value: Error,
  ctx: BindingContext<ScriptingEnvironment>,
  memory: StructuredDeserializeMemory,
): void {
  if (serialized.cause === undefined) return;
  const status = Reflect.defineProperty(value, 'cause', {
    configurable: true,
    enumerable: false,
    value: structuredDeserialize(serialized.cause, ctx, memory),
    writable: true,
  });
  if (!status) throw new InternalError('Could not restore serialized Error cause');
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
