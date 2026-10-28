import { InternalError } from '../../../infra/index';
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
  DOMExceptionImpl, DOMExceptionNames, StructuredData,
  type BindingContext, type ImplementationClass, type PlatformRecord,
} from '../../../web-idl/index';

import { DetachedTransferableStamper } from '../transferable';
import type { BrowletEnvironment } from '../../environment';

import {
  restrictToSameAgentCluster, isSerializedErrorName,
  type SerializedArrayBuffer, type SerializedArrayBufferView,
  type SerializedError, type SerializedMap, type SerializedArray,
  type SerializedObject, type SerializedPlatformObject, type SerializedRecord,
  type SerializedSet, type SerializedSharedArrayBuffer,
  type StructuredSerializeMemory,
} from './records';

// https://html.spec.whatwg.org/multipage/structured-data.html#structuredserialize
export function structuredSerialize(
  value: unknown,
  ctx: BindingContext<BrowletEnvironment>,
): SerializedRecord {
  return structuredSerializeInternal(value, false, ctx);
}

// https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeforstorage
export function structuredSerializeForStorage(
  value: unknown,
  ctx: BindingContext<BrowletEnvironment>,
): SerializedRecord {
  return structuredSerializeInternal(value, true, ctx);
}

// https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal
// BINDING_INTEGRATION: recognize stamped instances through either implementation or platform identity.
export function structuredSerializeInternal(
  value: unknown,
  forStorage: boolean,
  ctx: BindingContext<BrowletEnvironment>,
  memory: StructuredSerializeMemory = new Map(),
): SerializedRecord {
  return new StructuredSerializer(forStorage, ctx, memory).serialize(value);
}

/** One graph traversal, including all nested interface serialization steps. */
class StructuredSerializer {
  #forStorage: boolean;
  #ctx: BindingContext<BrowletEnvironment>;
  #memory: StructuredSerializeMemory;

  constructor(
    forStorage: boolean,
    ctx: BindingContext<BrowletEnvironment>,
    memory: StructuredSerializeMemory,
  ) {
    this.#forStorage = forStorage;
    this.#ctx = ctx;
    this.#memory = memory;
  }

  serialize(value: unknown): SerializedRecord {
    const record = this.#ctx.getObjectRecord(value);
    const remembered = this.#memory.get(record?.implInst ?? value);
    if (remembered !== undefined) return remembered;

    const serialized = this.#serializeValue(value, record);
    if (this.#forStorage && serialized.cluster !== null) {
      throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
    }
    return serialized;
  }

  #serializeValue(value: unknown, record: Readonly<PlatformRecord> | undefined): SerializedRecord {
    if (isPrimitive(value)) return { type: 'primitive', value, cluster: null };
    if (typeof value === 'symbol') throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
    if (!record && isProxyObject(value)) throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);

    let serialized: SerializedRecord;
    if (hasBooleanData(value)) {
      serialized = {
        type: 'Boolean',
        value: getBooleanData(value),
        cluster: null,
      };
    } else if (hasNumberData(value)) {
      serialized = {
        type: 'Number',
        value: getNumberData(value),
        cluster: null,
      };
    } else if (hasBigIntData(value)) {
      serialized = {
        type: 'BigInt',
        value: getBigIntData(value),
        cluster: null,
      };
    } else if (hasStringData(value)) {
      serialized = {
        type: 'String',
        value: getStringData(value),
        cluster: null,
      };
    } else if (hasSymbolData(value)) {
      throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
    } else if (hasDateValue(value)) {
      serialized = {
        type: 'Date',
        value: getDateValue(value),
        cluster: null,
      };
    } else if (hasRegExpMatcher(value)) {
      const { flags, source } = getRegExpData(value);
      serialized = {
        type: 'RegExp',
        source,
        flags,
        cluster: null,
      };
    } else if (isAnyArrayBuffer(value)) {
      serialized = this.#serializeBuffer(value);
    } else if (isArrayBufferView(value)) {
      serialized = this.#serializeBufferView(value);
    } else if (hasMapData(value)) {
      return this.#serializeMap(value);
    } else if (hasSetData(value)) {
      return this.#serializeSet(value);
    } else if (hasErrorData(value) && !record) {
      return this.#serializeError(value);
    } else if (record) {
      return this.#serializePlatformObject(record);
    } else if (Array.isArray(value)) {
      const length = Reflect.getOwnPropertyDescriptor(value, 'length')?.value;
      if (typeof length !== 'number') {
        throw new InternalError('An Array exotic object has no numeric length');
      }
      return this.#serializeProperties(value, { type: 'Array', length, properties: [], cluster: null });
    } else if (typeof value === 'function') {
      throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
    } else if (hasUnsupportedInternalSlots(value)) {
      throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
    } else {
      const keys = Object.keys(value);
      if (nativeCloneRejectsPropertylessObject(value, keys)) {
        throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
      }
      return this.#serializeProperties(value, { type: 'Object', properties: [], cluster: null }, keys);
    }

    this.#memory.set(record?.implInst ?? value, serialized);
    return serialized;
  }

  // StructuredSerializeInternal: ArrayBuffer and SharedArrayBuffer branches.
  // https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal
  #serializeBuffer(value: ArrayBufferLike): SerializedArrayBuffer | SerializedSharedArrayBuffer {
    const byteLength = getArrayBufferByteLength(value);
    const maxByteLength = getArrayBufferMaxByteLength(value);

    if (isSharedArrayBuffer(value)) {
      if (!this.#ctx.realm.crossOriginIsolated) {
        throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
      }
      const serialized: SerializedSharedArrayBuffer = maxByteLength === undefined
        ? {
          type: 'SharedArrayBuffer',
          buffer: value,
          byteLength,
          cluster: null,
        }
        : {
          type: 'GrowableSharedArrayBuffer',
          buffer: value,
          byteLength,
          maxByteLength,
          cluster: null,
        };
      restrictToSameAgentCluster(serialized, this.#ctx.getEnvironment());
      return serialized;
    }

    if (isDetachedArrayBuffer(value)) throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
    const bytes = getBufferSourceCopy(value);
    return maxByteLength === undefined
      ? { type: 'ArrayBuffer', bytes, byteLength, cluster: null }
      : {
        type: 'ResizableArrayBuffer',
        bytes,
        byteLength,
        maxByteLength,
        cluster: null,
      };
  }

  // StructuredSerializeInternal: the ArrayBufferView branch.
  // https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal
  #serializeBufferView(value: JSBufferView): SerializedArrayBufferView {
    if (isArrayBufferViewOutOfBounds(value)) {
      throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
    }
    const bufferSerialized = this.serialize(getArrayBufferViewBuffer(value));
    if (!isBufferSerializedRecord(bufferSerialized) &&
      bufferSerialized.type !== 'transfer-placeholder') {
      throw new InternalError('A buffer view did not serialize its backing buffer');
    }
    return {
      type: 'ArrayBufferView',
      constructor: getBufferViewTypeName(value),
      buffer: bufferSerialized,
      byteOffset: getArrayBufferViewByteOffset(value),
      ...serializeArrayBufferViewLengths(value),
      cluster: null,
    };
  }

  // StructuredSerializeInternal: deep serialization of [[MapData]].
  // https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal
  #serializeMap(value: Map<unknown, unknown>): SerializedMap {
    const serialized: SerializedMap = { type: 'Map', entries: [], cluster: null };
    this.#memory.set(value, serialized);
    const copiedEntries = copyMapData(value);
    for (const [key, entryValue] of copiedEntries) {
      serialized.entries.push({ key: this.serialize(key), value: this.serialize(entryValue) });
    }
    return serialized;
  }

  // StructuredSerializeInternal: deep serialization of [[SetData]].
  // https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal
  #serializeSet(value: Set<unknown>): SerializedSet {
    const serialized: SerializedSet = { type: 'Set', entries: [], cluster: null };
    this.#memory.set(value, serialized);
    const copiedEntries = copySetData(value);
    for (const entry of copiedEntries) {
      serialized.entries.push(this.serialize(entry));
    }
    return serialized;
  }

  // StructuredSerializeInternal: [[ErrorData]] and its accompanying data.
  // https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal
  #serializeError(value: Error): SerializedError {
    const candidateName = Reflect.get(value, 'name', value) as unknown;
    const name = isSerializedErrorName(candidateName) ? candidateName : 'Error';
    const messageDescriptor = Reflect.getOwnPropertyDescriptor(value, 'message');
    const message = messageDescriptor && 'value' in messageDescriptor
      ? toString(messageDescriptor.value)
      : undefined;
    const stackValue = readErrorStack(value, this.#ctx.realm);
    const stack = typeof stackValue === 'string' ? stackValue : '';
    const serialized: SerializedError = { type: 'Error', name, message, stack, cluster: null };
    this.#memory.set(value, serialized);

    const descriptor = Reflect.getOwnPropertyDescriptor(value, 'cause');
    if (descriptor && 'value' in descriptor) {
      serialized.cause = this.serialize(descriptor.value);
    }
    return serialized;
  }

  // StructuredSerializeInternal: serializable platform objects.
  // https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal
  #serializePlatformObject(record: Readonly<PlatformRecord>): SerializedPlatformObject {
    const steps = record.assembled.serialSteps;
    if (!steps) throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
    if (DetachedTransferableStamper.has(record.implInst)) {
      throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
    }
    const serialized: SerializedPlatformObject = {
      type: 'platform-object',
      interfaceName: record.assembled.name,
      data: new StructuredData(),
      cluster: null,
    };
    serialized.data.shouldRestrict = record.assembled.hasExtendedAttribute('SameAgentCluster', false);
    if (serialized.data.shouldRestrict) {
      restrictToSameAgentCluster(serialized, this.#ctx.getEnvironment());
    }
    this.#memory.set(record.implInst, serialized);
    record.serializationSteps(
      serialized.data,
      this.#forStorage,
      {
        subserialize: (value: unknown, implClass?: ImplementationClass) => {
          if (implClass) {
            // The typed overload supplies an implementation; its containing object selects
            // the owner just as an interface-valued result does during projection.
            record.associateWithOwner(implClass, value as object);
          }
          return this.serialize(value);
        },
      },
      steps,
    );
    if (serialized.data.shouldRestrict && serialized.cluster === null) {
      restrictToSameAgentCluster(serialized, this.#ctx.getEnvironment());
    }
    return serialized;
  }

  // StructuredSerializeInternal: enumerable own-property serialization.
  // https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal
  #serializeProperties(
    value: object,
    serialized: SerializedObject | SerializedArray,
    keys = Object.keys(value),
  ): SerializedObject | SerializedArray {
    this.#memory.set(value, serialized);
    for (const key of keys) {
      if (!Object.hasOwn(value, key)) continue;
      const inputValue = Reflect.get(value, key, value) as unknown;
      serialized.properties.push({ key, value: this.serialize(inputValue) });
    }
    return serialized;
  }
}

// StructuredSerializeInternal: ArrayBufferView [[ByteLength]] and [[ArrayLength]].
// https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal
function serializeArrayBufferViewLengths(
  value: JSBufferView,
): Pick<SerializedArrayBufferView, 'arrayLength' | 'byteLength'> {
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
): value is SerializedArrayBuffer | SerializedSharedArrayBuffer {
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
