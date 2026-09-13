import {
  type JSBufferViewName, copyMapData, copySetData, getArrayBufferMaxByteLength,
  getBigIntData, getBooleanData, getBufferSourceByteLength,
  getBufferSourceByteOffset, getBufferSourceCopy, getBufferSourceUnderlyingBuffer,
  getBufferTypeName, getDateValue, getNumberData, getRegExpData, getStringData,
  getTypedArrayLength, hasBigIntData, hasBooleanData, hasDateValue, hasErrorData,
  hasMapData, hasNumberData, hasRegExpMatcher, hasSetData, hasStringData,
  hasSymbolData, isArgumentsObject, isArrayBufferViewOutOfBounds,
  isBufferSourceDetached, isCryptoKeyObject, isExternalObject,
  isFinalizationRegistryObject, isGeneratorObject, isKeyObject,
  isLengthTrackingArrayBufferView, isMapIteratorObject, isModuleNamespaceObject,
  isPromiseObject, isProxyObject, isSetIteratorObject, isWeakMapObject,
  isWeakRefObject, isWeakSetObject, nativeCloneRejectsPropertylessObject,
  readErrorStack, toString,
} from '../../../js-engine/index';
import { throwDataCloneError } from '../../../web-idl/exceptions/dom-exception-core';
import type {
  WebIDLRealmHost,
} from '../../../web-idl/index';
import type { StructuredDataEnvironment } from './environment';
import {
  createStructuredDataRecord, isSerializedErrorName,
  type ArrayBufferSerializedRecord,
  type ArrayBufferViewSerializedRecord,
  type ErrorSerializedRecord, type MapSerializedRecord,
  type ObjectSerializedRecord, type PlatformObjectSerializedRecord,
  type SerializedRecord,
  type SetSerializedRecord, type SharedArrayBufferSerializedRecord,
  type StructuredSerializeMemory,
} from './records';
import { serializable } from './serializable';
import { isTransferableDetached } from './transferable';

export type StructuredSerializationEnvironment = StructuredDataEnvironment;

/** HTML §2.7.4, StructuredSerialize. */
export function structuredSerialize(
  value: unknown,
  environment: StructuredSerializationEnvironment,
): SerializedRecord {
  return structuredSerializeInternal(value, false, environment);
}

/** HTML §2.7.5, StructuredSerializeForStorage. */
export function structuredSerializeForStorage(
  value: unknown,
  environment: StructuredSerializationEnvironment,
): SerializedRecord {
  return structuredSerializeInternal(value, true, environment);
}

/** HTML §2.7.3, StructuredSerializeInternal. */
// BINDING_INTEGRATION: recognize platform objects before serializing JavaScript data.
export function structuredSerializeInternal(
  value: unknown,
  forStorage: boolean,
  environment: StructuredSerializationEnvironment,
  memory: StructuredSerializeMemory = new Map(),
): SerializedRecord {
  if (memory.has(value)) return memory.get(value)!;

  if (isPrimitive(value)) return { type: 'primitive', value };
  if (typeof value === 'symbol') return throwDataCloneError();

  const platformObject = environment.context.resolvePlatformObject(value);
  if (!platformObject && isProxyObject(value)) {
    return throwDataCloneError();
  }
  let serialized: SerializedRecord;
  let deep = false;

  if (hasBooleanData(value)) {
    serialized = {
      type: 'Boolean',
      value: getBooleanData(value),
    };
  } else if (hasNumberData(value)) {
    serialized = {
      type: 'Number',
      value: getNumberData(value),
    };
  } else if (hasBigIntData(value)) {
    serialized = {
      type: 'BigInt',
      value: getBigIntData(value),
    };
  } else if (hasStringData(value)) {
    serialized = {
      type: 'String',
      value: getStringData(value),
    };
  } else if (hasSymbolData(value)) {
    return throwDataCloneError();
  } else if (hasDateValue(value)) {
    serialized = {
      type: 'Date',
      value: getDateValue(value),
    };
  } else if (hasRegExpMatcher(value)) {
    const { flags, source } = getRegExpData(value);
    serialized = {
      type: 'RegExp',
      source,
      flags,
    };
  } else {
    const bufferType = getBufferTypeName(value);
    if (bufferType === 'ArrayBuffer' || bufferType === 'SharedArrayBuffer') {
      serialized = serializeBuffer(
        value,
        bufferType,
        forStorage,
        environment,
      );
    } else if (bufferType !== undefined) {
      if (isArrayBufferViewOutOfBounds(value)) {
        return throwDataCloneError();
      }
      const bufferSerialized = structuredSerializeInternal(
        getBufferSourceUnderlyingBuffer(value),
        forStorage,
        environment,
        memory,
      );
      if (!isBufferSerializedRecord(bufferSerialized) &&
        bufferSerialized.type !== 'transfer-placeholder') {
        throw new Error('A buffer view did not serialize its backing buffer');
      }
      serialized = {
        type: 'ArrayBufferView',
        constructor: bufferType,
        buffer: bufferSerialized,
        byteOffset: getBufferSourceByteOffset(value),
        ...serializeArrayBufferViewLengths(value, bufferType),
      };
    } else if (hasMapData(value)) {
      serialized = { type: 'Map', entries: [] };
      deep = true;
    } else if (hasSetData(value)) {
      serialized = { type: 'Set', entries: [] };
      deep = true;
    } else if (hasErrorData(value) &&
      !platformObject) {
      serialized = serializeError(value, environment.realm);
      deep = true;
    } else if (platformObject) {
      const steps = environment.context.getCapability(
        platformObject.primaryInterface.definition,
        serializable,
      );
      if (!steps) return throwDataCloneError();
      if (isTransferableDetached(platformObject.implementation)) {
        return throwDataCloneError();
      }
      serialized = {
        type: 'platform-object',
        interfaceName: platformObject.primaryInterface.definition.name,
        fields: createStructuredDataRecord(),
      };
      deep = true;
    } else if (Array.isArray(value)) {
      const length = Reflect.getOwnPropertyDescriptor(value, 'length')?.value;
      if (typeof length !== 'number') {
        throw new Error('An Array exotic object has no numeric length');
      }
      serialized = { type: 'Array', length, properties: [] };
      deep = true;
    } else if (typeof value === 'function') {
      return throwDataCloneError();
    } else if (hasUnsupportedInternalSlots(value) ||
      nativeCloneRejectsPropertylessObject(value)) {
      return throwDataCloneError();
    } else {
      serialized = { type: 'Object', properties: [] };
      deep = true;
    }
  }

  memory.set(value, serialized);
  if (!deep) return serialized;

  if (serialized.type === 'Map') {
    serializeMapData(value, serialized, forStorage, environment, memory);
  } else if (serialized.type === 'Set') {
    serializeSetData(value, serialized, forStorage, environment, memory);
  } else if (serialized.type === 'platform-object') {
    serializePlatformObject(
      value,
      serialized,
      forStorage,
      environment,
      memory,
    );
  } else if (serialized.type === 'Error') {
    serializeErrorCause(
      value,
      serialized,
      forStorage,
      environment,
      memory,
    );
  } else if (serialized.type === 'Array' || serialized.type === 'Object') {
    serializeProperties(
      value,
      serialized,
      forStorage,
      environment,
      memory,
    );
  } else {
    throw new Error(`Unsupported deep record ${serialized.type}`);
  }

  return serialized;
}

/** HTML §2.7.3, ArrayBufferView [[ByteLength]] and [[ArrayLength]]. */
function serializeArrayBufferViewLengths(
  value: object,
  type: JSBufferViewName,
): Pick<ArrayBufferViewSerializedRecord, 'arrayLength' | 'byteLength'> {
  if (isLengthTrackingArrayBufferView(value)) {
    return type === 'DataView'
      ? { byteLength: 'auto' }
      : { arrayLength: 'auto', byteLength: 'auto' };
  }
  return type === 'DataView'
    ? { byteLength: getBufferSourceByteLength(value) }
    : {
      arrayLength: getTypedArrayLength(value),
      byteLength: getBufferSourceByteLength(value),
    };
}

/** HTML §2.7.3, ArrayBuffer and SharedArrayBuffer branches. */
function serializeBuffer(
  value: object,
  type: 'ArrayBuffer' | 'SharedArrayBuffer',
  forStorage: boolean,
  environment: StructuredSerializationEnvironment,
): ArrayBufferSerializedRecord | SharedArrayBufferSerializedRecord {
  const byteLength = getBufferSourceByteLength(value);
  const maxByteLength = getArrayBufferMaxByteLength(value);

  if (type === 'SharedArrayBuffer') {
    if (!environment.realm.crossOriginIsolated || forStorage) {
      return throwDataCloneError();
    }
    return maxByteLength === undefined
      ? {
        type: 'SharedArrayBuffer',
        buffer: value,
        byteLength,
        agentCluster: environment.agentCluster,
      }
      : {
        type: 'GrowableSharedArrayBuffer',
        buffer: value,
        byteLength,
        maxByteLength,
        agentCluster: environment.agentCluster,
      };
  }

  if (isBufferSourceDetached(value)) return throwDataCloneError();
  const bytes = getBufferSourceCopy(value);
  return maxByteLength === undefined
    ? { type: 'ArrayBuffer', bytes, byteLength }
    : {
      type: 'ResizableArrayBuffer',
      bytes,
      byteLength,
      maxByteLength,
    };
}

/** HTML §2.7.3, deep serialization of [[MapData]]. */
function serializeMapData(
  value: object,
  serialized: MapSerializedRecord,
  forStorage: boolean,
  environment: StructuredSerializationEnvironment,
  memory: StructuredSerializeMemory,
): void {
  const copiedEntries = copyMapData(value);
  for (const [key, entryValue] of copiedEntries) {
    serialized.entries.push({
      key: structuredSerializeInternal(key, forStorage, environment, memory),
      value: structuredSerializeInternal(
        entryValue,
        forStorage,
        environment,
        memory,
      ),
    });
  }
}

/** HTML §2.7.3, deep serialization of [[SetData]]. */
function serializeSetData(
  value: object,
  serialized: SetSerializedRecord,
  forStorage: boolean,
  environment: StructuredSerializationEnvironment,
  memory: StructuredSerializeMemory,
): void {
  const copiedEntries = copySetData(value);
  for (const entry of copiedEntries) {
    serialized.entries.push(structuredSerializeInternal(
      entry,
      forStorage,
      environment,
      memory,
    ));
  }
}

/** HTML §2.7.3, serializable platform-object steps. */
// BINDING_INTEGRATION: dispatch the registered interface's serialization steps.
function serializePlatformObject(
  value: object,
  serialized: PlatformObjectSerializedRecord,
  forStorage: boolean,
  environment: StructuredSerializationEnvironment,
  memory: StructuredSerializeMemory,
): void {
  const platformObject = environment.context.resolvePlatformObject(value);
  if (!platformObject) {
    throw new Error('A resolved platform object became unavailable');
  }
  const steps = environment.context.getCapability(
    platformObject.primaryInterface.definition,
    serializable,
  );
  if (!steps) {
    throw new Error('A serializable platform object lost its capability');
  }
  steps.serializationSteps(
    platformObject.implementation,
    serialized.fields,
    forStorage,
    {
      subserialize: (subValue) => {
        const platformObject = environment.context.resolvePlatformObject(
          subValue,
        )?.platformObject ?? subValue;
        return structuredSerializeInternal(
          platformObject,
          forStorage,
          environment,
          memory,
        );
      },
    },
  );
}

/** HTML §2.7.3, enumerable own-property serialization. */
function serializeProperties(
  value: object,
  serialized: ObjectSerializedRecord | Extract<SerializedRecord, {
    type: 'Array';
  }>,
  forStorage: boolean,
  environment: StructuredSerializationEnvironment,
  memory: StructuredSerializeMemory,
): void {
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) continue;
    const inputValue = Reflect.get(value, key, value) as unknown;
    serialized.properties.push({
      key,
      value: structuredSerializeInternal(
        inputValue,
        forStorage,
        environment,
        memory,
      ),
    });
  }
}

/** HTML §2.7.3, the [[ErrorData]] branch. */
function serializeError(
  value: object,
  realm: WebIDLRealmHost,
): ErrorSerializedRecord {
  const candidateName = Reflect.get(value, 'name', value) as unknown;
  const name = isSerializedErrorName(candidateName)
    ? candidateName
    : 'Error';
  const messageDescriptor = Reflect.getOwnPropertyDescriptor(value, 'message');
  const message = messageDescriptor && 'value' in messageDescriptor
    ? toString(messageDescriptor.value)
    : undefined;
  const stackValue = readErrorStack(value, realm);
  const stack = typeof stackValue === 'string' ? stackValue : '';
  return { type: 'Error', name, message, stack };
}

/** HTML §2.7.3, interesting accompanying [[ErrorData]]. */
function serializeErrorCause(
  value: object,
  serialized: ErrorSerializedRecord,
  forStorage: boolean,
  environment: StructuredSerializationEnvironment,
  memory: StructuredSerializeMemory,
): void {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, 'cause');
  if (!descriptor || !('value' in descriptor)) return;
  serialized.cause = structuredSerializeInternal(
    descriptor.value,
    forStorage,
    environment,
    memory,
  );
}

function hasUnsupportedInternalSlots(value: object): boolean {
  return isArgumentsObject(value) ||
    isCryptoKeyObject(value) ||
    isExternalObject(value) ||
    isGeneratorObject(value) ||
    isKeyObject(value) ||
    isMapIteratorObject(value) ||
    isModuleNamespaceObject(value) ||
    isPromiseObject(value) ||
    isSetIteratorObject(value) ||
    isWeakMapObject(value) ||
    isWeakSetObject(value) ||
    isWeakRefObject(value) ||
    isFinalizationRegistryObject(value);
}

function isBufferSerializedRecord(
  value: SerializedRecord,
): value is ArrayBufferSerializedRecord | SharedArrayBufferSerializedRecord {
  return value.type === 'ArrayBuffer' ||
    value.type === 'ResizableArrayBuffer' ||
    value.type === 'SharedArrayBuffer' ||
    value.type === 'GrowableSharedArrayBuffer';
}

function isPrimitive(
  value: unknown,
): value is undefined | null | boolean | number | bigint | string {
  return value === null || value === undefined ||
    typeof value === 'boolean' || typeof value === 'number' ||
    typeof value === 'bigint' || typeof value === 'string';
}
