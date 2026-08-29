import { domExceptionName, throwDOMException } from '../../../shared/dom-exception';
import {
  cloneSharedArrayBuffer, createArrayBuffer,
  createArrayBufferViewFromBuffer,
} from '../../../web-idl/buffer-source';
import type { WebIDLRealmHost } from '../../../web-idl/index';
import type { StructuredDataEnvironment } from './environment';
import type {
  ErrorSerializedRecord, SerializedErrorName, SerializedRecord,
  StructuredDeserializeMemory,
} from './records';
import { serializable } from './serializable';

export type StructuredDeserializationEnvironment = StructuredDataEnvironment;

/** HTML §2.7.6, StructuredDeserialize. */
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
      value = cloneSharedArrayBuffer(serialized.buffer, realm);
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
      value = createArrayBufferViewFromBuffer(
        serialized.constructor,
        buffer,
        serialized.byteOffset,
        serialized.byteLength,
        serialized.arrayLength,
        realm,
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
      value = Reflect.construct(realm.intrinsics.object, []);
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

  if (serialized.type === 'Map') {
    for (const entry of serialized.entries) {
      Reflect.apply(mapSet, value, [
        structuredDeserialize(entry.key, environment, memory),
        structuredDeserialize(entry.value, environment, memory),
      ]);
    }
  } else if (serialized.type === 'Set') {
    for (const entry of serialized.entries) {
      Reflect.apply(setAdd, value, [
        structuredDeserialize(entry, environment, memory),
      ]);
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

/** HTML §2.7.6, ArrayBuffer and ResizableArrayBuffer branches. */
function deserializeArrayBuffer(
  serialized: Extract<SerializedRecord, {
    type: 'ArrayBuffer' | 'ResizableArrayBuffer';
  }>,
  realm: WebIDLRealmHost,
): object {
  try {
    return createArrayBuffer(
      serialized.bytes,
      realm,
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
  value: unknown,
  environment: StructuredDeserializationEnvironment,
  memory: StructuredDeserializeMemory,
): void {
  if (!isObject(value)) throw new Error('A deep record has no object value');
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
  const status = Reflect.defineProperty(value, 'stack', {
    configurable: true,
    enumerable: false,
    value: serialized.stack,
    writable: true,
  });
  if (!status) throw new Error('Could not restore serialized Error stack');
  return value;
}

/** HTML §2.7.6, interesting accompanying [[ErrorData]]. */
function deserializeErrorCause(
  serialized: ErrorSerializedRecord,
  value: unknown,
  environment: StructuredDeserializationEnvironment,
  memory: StructuredDeserializeMemory,
): void {
  if (serialized.cause === undefined || !isObject(value)) return;
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
  return isObject(value) && typeof Reflect.get(value, 'type') === 'string';
}

function isObject(value: unknown): value is object {
  return value !== null && (
    typeof value === 'object' || typeof value === 'function'
  );
}

function throwDataCloneError(): never {
  return throwDOMException(domExceptionName.dataClone);
}

const mapSet = Reflect.get(
  Map.prototype,
  'set',
) as (this: object, key: unknown, value: unknown) => object;

const setAdd = Reflect.get(
  Set.prototype,
  'add',
) as (this: object, value: unknown) => object;
