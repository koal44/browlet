import {
  appendMapData, appendSetData, getBufferTypeName, isObject, writeErrorStack,
} from '../../../js-engine/index';
import { throwDataCloneError } from '../../../web-idl/exceptions/dom-exception-core';
import type { WebIDLRealmHost } from '../../../web-idl/index';
import type { StructuredDataEnvironment } from './environment';
import type {
  ErrorSerializedRecord, SerializedErrorName, SerializedRecord,
  StructuredDeserializeMemory,
} from './records';
import { serializable } from './serializable';

export type StructuredDeserializationEnvironment = StructuredDataEnvironment;

/** HTML §2.7.6, StructuredDeserialize. */
// BINDING_INTEGRATION: reconstruct platform objects in the destination realm.
export function structuredDeserialize(
  serialized: SerializedRecord,
  environment: StructuredDeserializationEnvironment,
  memory: StructuredDeserializeMemory = new Map(),
): unknown {
  if (memory.has(serialized)) return memory.get(serialized);

  let value: unknown;
  let deep = false;
  let platformObject: ReturnType<
    StructuredDataEnvironment['context']['createPlatformObject']
  > | undefined;
  const { realm } = environment;

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
      if (environment.agentCluster !== serialized.agentCluster) {
        return throwDataCloneError();
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
        environment,
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
      const interface_ = environment.context.getInterface(
        serialized.interfaceName,
      );
      if (!interface_ || !environment.context.isInterfaceExposed(interface_)) {
        return throwDataCloneError();
      }
      platformObject = environment.context.createPlatformObject(interface_);
      value = platformObject.platformObject;
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
        structuredDeserialize(entry.key, environment, memory),
        structuredDeserialize(entry.value, environment, memory),
      );
    }
  } else if (serialized.type === 'Set') {
    for (const entry of serialized.entries) {
      appendSetData(
        value,
        structuredDeserialize(entry, environment, memory),
      );
    }
  } else if (serialized.type === 'Error') {
    deserializeErrorCause(serialized, value, environment, memory);
  } else if (serialized.type === 'Array' || serialized.type === 'Object') {
    deserializeProperties(serialized.properties, value, environment, memory);
  } else if (serialized.type === 'platform-object') {
    if (!platformObject) {
      throw new Error('A platform-object record was not created');
    }
    const steps = environment.context.getCapability(
      platformObject.primaryInterface.definition,
      serializable,
    );
    if (!steps) {
      throw new Error(
        `${platformObject.primaryInterface.definition.name} has no Serializable capability`,
      );
    }
    steps.deserializationSteps(
      serialized.fields,
      platformObject.implementation,
      realm,
      {
        getImplementation: (value, implementation) =>
          environment.context.getImplementation(value, implementation),
        subdeserialize: (subSerialized) => {
          if (!isSerializedRecord(subSerialized)) {
            throw new TypeError('Sub-deserialization requires a serialized record');
          }
          return structuredDeserialize(
            subSerialized,
            environment,
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
  realm: WebIDLRealmHost,
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
  realm: WebIDLRealmHost,
): ArrayBuffer {
  try {
    return realm.createArrayBuffer(
      serialized.bytes,
      serialized.maxByteLength,
    );
  } catch {
    return throwDataCloneError();
  }
}

/** HTML §2.7.6, enumerable own-property deserialization. */
function deserializeProperties(
  properties: Extract<SerializedRecord, {
    type: 'Array' | 'Object';
  }>['properties'],
  value: object,
  environment: StructuredDeserializationEnvironment,
  memory: StructuredDeserializeMemory,
): void {
  for (const entry of properties) {
    const status = Reflect.defineProperty(value, entry.key, {
      configurable: true,
      enumerable: true,
      value: structuredDeserialize(entry.value, environment, memory),
      writable: true,
    });
    if (!status) throw new Error(`Could not deserialize property ${entry.key}`);
  }
}

/** HTML §2.7.6, the [[ErrorData]] branch. */
function deserializeError(
  serialized: ErrorSerializedRecord,
  realm: WebIDLRealmHost,
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
  environment: StructuredDeserializationEnvironment,
  memory: StructuredDeserializeMemory,
): void {
  if (serialized.cause === undefined) return;
  const status = Reflect.defineProperty(value, 'cause', {
    configurable: true,
    enumerable: false,
    value: structuredDeserialize(serialized.cause, environment, memory),
    writable: true,
  });
  if (!status) throw new Error('Could not restore serialized Error cause');
}

function getErrorConstructor(
  name: SerializedErrorName,
  realm: WebIDLRealmHost,
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
