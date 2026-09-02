import { types as nodeTypes } from 'node:util';

import { domExceptionName, throwDOMException } from '../../../shared/dom-exception';
import {
  getBufferSourceByteLength,
  getBufferSourceByteOffset, getBufferSourceCopy,
  getBufferSourceMaxByteLength, getBufferSourceUnderlyingBuffer,
  getBufferSourceViewLengths, getBufferTypeName, isBufferSourceDetached,
  isBufferSourceViewOutOfBounds,
} from '../../../web-idl/buffer-source';
import type {
  WebIDLRealmHost,
} from '../../../web-idl/index';
import type { StructuredDataEnvironment } from './environment';
import {
  createStructuredDataRecord, type ArrayBufferSerializedRecord,
  type ErrorSerializedRecord, type MapSerializedRecord,
  type ObjectSerializedRecord, type PlatformObjectSerializedRecord,
  type SerializedErrorName, type SerializedRecord,
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
  if (!platformObject && nodeTypes.isProxy(value)) {
    return throwDataCloneError();
  }
  let serialized: SerializedRecord;
  let deep = false;

  if (nodeTypes.isBooleanObject(value)) {
    serialized = {
      type: 'Boolean',
      value: Reflect.apply(booleanValueOf, value, []),
    };
  } else if (nodeTypes.isNumberObject(value)) {
    serialized = {
      type: 'Number',
      value: Reflect.apply(numberValueOf, value, []),
    };
  } else if (nodeTypes.isBigIntObject(value)) {
    serialized = {
      type: 'BigInt',
      value: Reflect.apply(bigIntValueOf, value, []),
    };
  } else if (nodeTypes.isStringObject(value)) {
    serialized = {
      type: 'String',
      value: Reflect.apply(stringValueOf, value, []),
    };
  } else if (nodeTypes.isSymbolObject(value)) {
    return throwDataCloneError();
  } else if (nodeTypes.isDate(value)) {
    serialized = {
      type: 'Date',
      value: Reflect.apply(dateValueOf, value, []),
    };
  } else if (nodeTypes.isRegExp(value)) {
    serialized = {
      type: 'RegExp',
      source: Reflect.apply(regExpSource, value, []) as string,
      flags: getRegExpFlags(value),
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
      if (isBufferSourceViewOutOfBounds(value)) {
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
        ...getBufferSourceViewLengths(value),
      };
    } else if (nodeTypes.isMap(value)) {
      serialized = { type: 'Map', entries: [] };
      deep = true;
    } else if (nodeTypes.isSet(value)) {
      serialized = { type: 'Set', entries: [] };
      deep = true;
    } else if (nodeTypes.isNativeError(value) && !platformObject) {
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

/** HTML §2.7.3, ArrayBuffer and SharedArrayBuffer branches. */
function serializeBuffer(
  value: object,
  type: 'ArrayBuffer' | 'SharedArrayBuffer',
  forStorage: boolean,
  environment: StructuredSerializationEnvironment,
): ArrayBufferSerializedRecord | SharedArrayBufferSerializedRecord {
  const byteLength = getBufferSourceByteLength(value);
  const maxByteLength = getBufferSourceMaxByteLength(value);

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
  const copiedEntries = copyMapEntries(value);
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
  const copiedEntries = copySetEntries(value);
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
  const name = serializedErrorNames.has(candidateName as SerializedErrorName)
    ? candidateName as SerializedErrorName
    : 'Error';
  const messageDescriptor = Reflect.getOwnPropertyDescriptor(value, 'message');
  const message = messageDescriptor && 'value' in messageDescriptor
    ? toString(messageDescriptor.value, realm)
    : undefined;
  const stack = getErrorStack(value, realm);
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

function getErrorStack(value: object, realm: WebIDLRealmHost): string {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, 'stack');
  if (!descriptor) return '';
  if ('value' in descriptor) {
    return typeof descriptor.value === 'string' ? descriptor.value : '';
  }
  const getter = realm.intrinsics.errorStack;
  if (getter && descriptor.get === getter) {
    const stack = Reflect.apply(getter, value, []);
    return typeof stack === 'string' ? stack : '';
  }
  return '';
}

function copyMapEntries(value: object): Array<[unknown, unknown]> {
  const iterator = Reflect.apply(mapEntries, value, []) as object;
  const copied: Array<[unknown, unknown]> = [];
  while (true) {
    const result = Reflect.apply(mapIteratorNext, iterator, []);
    if (result.done) return copied;
    copied.push([result.value[0], result.value[1]]);
  }
}

function copySetEntries(value: object): unknown[] {
  const iterator = Reflect.apply(setValues, value, []) as object;
  const copied: unknown[] = [];
  while (true) {
    const result = Reflect.apply(setIteratorNext, iterator, []);
    if (result.done) return copied;
    copied.push(result.value);
  }
}

function getRegExpFlags(value: object): string {
  // RegExp.prototype.flags performs observable property Gets. Applying the
  // captured accessors reads the RegExp internal slots without author hooks.
  let result = '';
  for (const [getter, flag] of regExpFlagAccessors) {
    if (getter && Reflect.apply(getter, value, []) === true) result += flag;
  }
  return result;
}

function hasUnsupportedInternalSlots(value: object): boolean {
  return nodeTypes.isArgumentsObject(value) ||
    nodeTypes.isCryptoKey(value) ||
    nodeTypes.isExternal(value) ||
    nodeTypes.isGeneratorObject(value) ||
    nodeTypes.isKeyObject(value) ||
    nodeTypes.isMapIterator(value) ||
    nodeTypes.isModuleNamespaceObject(value) ||
    nodeTypes.isPromise(value) ||
    nodeTypes.isSetIterator(value) ||
    nodeTypes.isWeakMap(value) ||
    nodeTypes.isWeakSet(value) ||
    hasWeakRefSlots(value) ||
    hasFinalizationRegistrySlots(value);
}

function nativeCloneRejectsPropertylessObject(value: object): boolean {
  // Node does not expose predicates for Array or String Iterator internal
  // slots. A propertyless native-clone probe distinguishes the real branded
  // objects from prototype impostors without advancing an iterator or
  // traversing an author-controlled property graph.
  if (Object.keys(value).length !== 0) return false;

  try {
    nativeStructuredClone(value);
    return false;
  } catch (error) {
    if (isNativeDataCloneError(error)) return true;
    throw error;
  }
}

function isNativeDataCloneError(value: unknown): boolean {
  return typeof value === 'object' && value !== null &&
    Reflect.get(value, 'name') === 'DataCloneError';
}

function hasWeakRefSlots(value: object): boolean {
  if (!weakRefDeref) return false;
  try {
    Reflect.apply(weakRefDeref, value, []);
    return true;
  } catch {
    return false;
  }
}

function hasFinalizationRegistrySlots(value: object): boolean {
  if (!finalizationRegistryUnregister) return false;
  try {
    Reflect.apply(finalizationRegistryUnregister, value, [brandProbe]);
    return true;
  } catch {
    return false;
  }
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

function throwDataCloneError(): never {
  return throwDOMException(domExceptionName.dataClone);
}

function toString(value: unknown, realm: WebIDLRealmHost): string {
  if (typeof value === 'symbol') {
    throw new realm.intrinsics.typeError(
      'Cannot convert a Symbol value to a string',
    );
  }
  return Reflect.apply(realm.intrinsics.string, undefined, [value]);
}

function getAccessor(
  object: object,
  key: PropertyKey,
): (this: object) => unknown {
  const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
  if (typeof descriptor?.get !== 'function') {
    throw new Error(`Missing intrinsic accessor ${String(key)}`);
  }
  return descriptor.get;
}

function getOptionalAccessor(
  object: object,
  key: PropertyKey,
): ((this: object) => unknown) | undefined {
  const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
  return typeof descriptor?.get === 'function' ? descriptor.get : undefined;
}

const booleanValueOf = Reflect.get(
  Boolean.prototype,
  'valueOf',
);
const numberValueOf = Reflect.get(
  Number.prototype,
  'valueOf',
);
const bigIntValueOf = Reflect.get(
  BigInt.prototype,
  'valueOf',
);
const stringValueOf = Reflect.get(
  String.prototype,
  'valueOf',
);
const dateValueOf = Reflect.get(
  Date.prototype,
  'getTime',
);
const regExpSource = getAccessor(RegExp.prototype, 'source');
const regExpFlagAccessors = [
  [getOptionalAccessor(RegExp.prototype, 'hasIndices'), 'd'],
  [getOptionalAccessor(RegExp.prototype, 'global'), 'g'],
  [getOptionalAccessor(RegExp.prototype, 'ignoreCase'), 'i'],
  [getOptionalAccessor(RegExp.prototype, 'multiline'), 'm'],
  [getOptionalAccessor(RegExp.prototype, 'dotAll'), 's'],
  [getOptionalAccessor(RegExp.prototype, 'unicode'), 'u'],
  [getOptionalAccessor(RegExp.prototype, 'unicodeSets'), 'v'],
  [getOptionalAccessor(RegExp.prototype, 'sticky'), 'y'],
] as const;

const mapEntries = Reflect.get(
  Map.prototype,
  'entries',
) as (this: object) => MapIterator<[unknown, unknown]>;
const mapIteratorNext = Reflect.get(
  Reflect.getPrototypeOf(new Map().entries())!,
  'next',
) as (this: object) => IteratorResult<[unknown, unknown]>;
const setValues = Reflect.get(
  Set.prototype,
  'values',
) as (this: object) => SetIterator<unknown>;
const setIteratorNext = Reflect.get(
  Reflect.getPrototypeOf(new Set().values())!,
  'next',
) as (this: object) => IteratorResult<unknown>;

const weakRefDeref = typeof WeakRef === 'undefined'
  ? undefined
  : Reflect.get(
    WeakRef.prototype,
    'deref',
  ) as (this: object) => object | undefined;
const finalizationRegistryUnregister = typeof FinalizationRegistry === 'undefined'
  ? undefined
  : Reflect.get(
    FinalizationRegistry.prototype,
    'unregister',
  );
const brandProbe = {};
const nativeStructuredClone = globalThis.structuredClone;

const serializedErrorNames = new Set<SerializedErrorName>([
  'Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'TypeError', 'URIError',
]);
