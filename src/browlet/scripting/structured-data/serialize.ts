import type { ScriptingEnvironment } from '../environment';
import {
  type JSBufferView, copyMapData, copySetData, getArrayBufferMaxByteLength,
  getArrayBufferByteLength, getArrayBufferViewBuffer, getArrayBufferViewByteLength,
  getArrayBufferViewByteOffset, getBigIntData, getBooleanData, getBufferSourceCopy,
  getBufferViewTypeName, getDateValue, getNumberData, getRegExpData, getStringData,
  getTypedArrayLength, hasBigIntData, hasBooleanData, hasDateValue, hasErrorData,
  hasMapData, hasNumberData, hasRegExpMatcher, hasSetData, hasStringData,
  hasSymbolData, isAnyArrayBuffer, isArgumentsObject, isArrayBufferView, isArrayBufferViewOutOfBounds,
  isArrayIteratorObject, isCryptoKeyObject, isDataView, isDetachedArrayBuffer, isExternalObject,
  isFinalizationRegistryObject, isGeneratorObject, isKeyObject,
  isLengthTrackingArrayBufferView, isMapIteratorObject, isModuleNamespaceObject,
  isPromiseObject, isProxyObject, isRegExpStringIteratorObject,
  isSetIteratorObject, isSharedArrayBuffer, isStringIteratorObject, isWeakMapObject,
  isWeakRefObject, isWeakSetObject, nativeCloneRejectsPropertylessObject,
  readErrorStack, toString,
} from '../../../js-engine/index';
import {
  DOMExceptionImpl, DOMExceptionNames, type BindingContext, type ImplementationClass,
} from '../../../web-idl/index';
import type { Realm } from '../realm';
import {
  createStructuredDataRecord, isSerializedErrorName,
  type ArrayBufferSerializedRecord,
  type ArrayBufferViewSerializedRecord,
  type ErrorSerializedRecord, type MapSerializedRecord,
  type ObjectSerializedRecord,
  type SerializedRecord,
  type SetSerializedRecord, type SharedArrayBufferSerializedRecord,
  type StructuredSerializeMemory,
} from './records';
import { DetachedTransferableStamper } from './transferable';
import { InternalError } from '../../../infra/internal-error';

/** HTML §2.7.4, StructuredSerialize. */
export function structuredSerialize(
  value: unknown,
  ctx: BindingContext<ScriptingEnvironment>,
): SerializedRecord {
  return structuredSerializeInternal(value, false, ctx);
}

/** HTML §2.7.5, StructuredSerializeForStorage. */
export function structuredSerializeForStorage(
  value: unknown,
  ctx: BindingContext<ScriptingEnvironment>,
): SerializedRecord {
  return structuredSerializeInternal(value, true, ctx);
}

/** HTML §2.7.3, StructuredSerializeInternal. */
// BINDING_INTEGRATION: recognize stamped instances through either implementation or platform identity.
export function structuredSerializeInternal(
  value: unknown,
  forStorage: boolean,
  ctx: BindingContext<ScriptingEnvironment>,
  memory: StructuredSerializeMemory = new Map(),
): SerializedRecord {
  const record = ctx.getObjectRecord(value);
  const identity = record?.implInst ?? value;
  if (memory.has(identity)) return memory.get(identity)!;

  if (isPrimitive(value)) return { type: 'primitive', value };
  if (typeof value === 'symbol') throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);

  if (!record && isProxyObject(value)) {
    throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
  }
  let serialized: SerializedRecord;

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
    throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
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
    if (isAnyArrayBuffer(value)) {
      serialized = serializeBuffer(
        value,
        forStorage,
        ctx,
      );
    } else if (isArrayBufferView(value)) {
      if (isArrayBufferViewOutOfBounds(value)) {
        throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
      }
      const bufferSerialized = structuredSerializeInternal(
        getArrayBufferViewBuffer(value),
        forStorage,
        ctx,
        memory,
      );
      if (!isBufferSerializedRecord(bufferSerialized) &&
        bufferSerialized.type !== 'transfer-placeholder') {
        throw new InternalError('A buffer view did not serialize its backing buffer');
      }
      serialized = {
        type: 'ArrayBufferView',
        constructor: getBufferViewTypeName(value),
        buffer: bufferSerialized,
        byteOffset: getArrayBufferViewByteOffset(value),
        ...serializeArrayBufferViewLengths(value),
      };
    } else if (hasMapData(value)) {
      serialized = { type: 'Map', entries: [] };
      memory.set(identity, serialized);
      serializeMapData(value, serialized, forStorage, ctx, memory);
      return serialized;
    } else if (hasSetData(value)) {
      serialized = { type: 'Set', entries: [] };
      memory.set(identity, serialized);
      serializeSetData(value, serialized, forStorage, ctx, memory);
      return serialized;
    } else if (hasErrorData(value) && !record) {
      serialized = serializeError(value, ctx.realm);
      memory.set(identity, serialized);
      serializeErrorCause(value, serialized, forStorage, ctx, memory);
      return serialized;
    } else if (record) {
      const steps = record.assembled.serialSteps;
      if (!steps) throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
      if (DetachedTransferableStamper.has(record.implInst)) {
        throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
      }
      serialized = {
        type: 'platform-object',
        interfaceName: record.assembled.name,
        fields: createStructuredDataRecord(),
      };
      memory.set(identity, serialized);
      record.serializationSteps(
        serialized.fields,
        forStorage,
        {
          subserialize: (subValue: unknown, implClass?: ImplementationClass) => {
            if (implClass) {
              // The typed overload supplies an implementation; its containing object selects
              // the owner just as an interface-valued result does during projection.
              record.associateWithOwner(implClass, subValue as object);
            }
            return structuredSerializeInternal(subValue, forStorage, ctx, memory);
          },
        },
        steps,
      );
      return serialized;
    } else if (Array.isArray(value)) {
      const length = Reflect.getOwnPropertyDescriptor(value, 'length')?.value;
      if (typeof length !== 'number') {
        throw new InternalError('An Array exotic object has no numeric length');
      }
      serialized = { type: 'Array', length, properties: [] };
    } else if (typeof value === 'function') {
      throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
    } else if (hasUnsupportedInternalSlots(value) ||
      nativeCloneRejectsPropertylessObject(value)) {
      throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
    } else {
      serialized = { type: 'Object', properties: [] };
    }
  }

  memory.set(identity, serialized);
  if (serialized.type === 'Array' || serialized.type === 'Object') {
    serializeProperties(
      value,
      serialized,
      forStorage,
      ctx,
      memory,
    );
  }

  return serialized;
}

/** HTML §2.7.3, ArrayBufferView [[ByteLength]] and [[ArrayLength]]. */
function serializeArrayBufferViewLengths(
  value: JSBufferView,
): Pick<ArrayBufferViewSerializedRecord, 'arrayLength' | 'byteLength'> {
  if (isLengthTrackingArrayBufferView(value)) {
    return isDataView(value)
      ? { byteLength: 'auto' }
      : { arrayLength: 'auto', byteLength: 'auto' };
  }
  return isDataView(value)
    ? { byteLength: getArrayBufferViewByteLength(value) }
    : {
      arrayLength: getTypedArrayLength(value),
      byteLength: getArrayBufferViewByteLength(value),
    };
}

/** HTML §2.7.3, ArrayBuffer and SharedArrayBuffer branches. */
function serializeBuffer(
  value: ArrayBufferLike,
  forStorage: boolean,
  ctx: BindingContext<ScriptingEnvironment>,
): ArrayBufferSerializedRecord | SharedArrayBufferSerializedRecord {
  const byteLength = getArrayBufferByteLength(value);
  const maxByteLength = getArrayBufferMaxByteLength(value);

  if (isSharedArrayBuffer(value)) {
    if (!ctx.realm.crossOriginIsolated || forStorage) {
      throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
    }
    const agentCluster = ctx.realm.agent.agentCluster;
    if (!agentCluster) throw new InternalError('Realm agent has no agent cluster');
    return maxByteLength === undefined
      ? {
        type: 'SharedArrayBuffer',
        buffer: value,
        byteLength,
        agentCluster,
      }
      : {
        type: 'GrowableSharedArrayBuffer',
        buffer: value,
        byteLength,
        maxByteLength,
        agentCluster,
      };
  }

  if (isDetachedArrayBuffer(value)) throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
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
  value: Map<unknown, unknown>,
  serialized: MapSerializedRecord,
  forStorage: boolean,
  ctx: BindingContext<ScriptingEnvironment>,
  memory: StructuredSerializeMemory,
): void {
  const copiedEntries = copyMapData(value);
  for (const [key, entryValue] of copiedEntries) {
    serialized.entries.push({
      key: structuredSerializeInternal(key, forStorage, ctx, memory),
      value: structuredSerializeInternal(
        entryValue,
        forStorage,
        ctx,
        memory,
      ),
    });
  }
}

/** HTML §2.7.3, deep serialization of [[SetData]]. */
function serializeSetData(
  value: Set<unknown>,
  serialized: SetSerializedRecord,
  forStorage: boolean,
  ctx: BindingContext<ScriptingEnvironment>,
  memory: StructuredSerializeMemory,
): void {
  const copiedEntries = copySetData(value);
  for (const entry of copiedEntries) {
    serialized.entries.push(structuredSerializeInternal(
      entry,
      forStorage,
      ctx,
      memory,
    ));
  }
}

/** HTML §2.7.3, enumerable own-property serialization. */
function serializeProperties(
  value: object,
  serialized: ObjectSerializedRecord | Extract<SerializedRecord, {
    type: 'Array';
  }>,
  forStorage: boolean,
  ctx: BindingContext<ScriptingEnvironment>,
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
        ctx,
        memory,
      ),
    });
  }
}

/** HTML §2.7.3, the [[ErrorData]] branch. */
function serializeError(
  value: Error,
  realm: Realm,
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
  value: Error,
  serialized: ErrorSerializedRecord,
  forStorage: boolean,
  ctx: BindingContext<ScriptingEnvironment>,
  memory: StructuredSerializeMemory,
): void {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, 'cause');
  if (!descriptor || !('value' in descriptor)) return;
  serialized.cause = structuredSerializeInternal(
    descriptor.value,
    forStorage,
    ctx,
    memory,
  );
}

function hasUnsupportedInternalSlots(value: object): boolean {
  return isArgumentsObject(value) ||
    isArrayIteratorObject?.(value) ||
    isCryptoKeyObject(value) ||
    isExternalObject(value) ||
    isGeneratorObject(value) ||
    isKeyObject(value) ||
    isMapIteratorObject(value) ||
    isModuleNamespaceObject(value) ||
    isPromiseObject(value) ||
    isRegExpStringIteratorObject?.(value) ||
    isSetIteratorObject(value) ||
    isStringIteratorObject?.(value) ||
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
