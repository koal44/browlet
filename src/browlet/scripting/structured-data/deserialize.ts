import { InternalError } from '../../../infra/internal-error';
import {
  appendMapData, appendSetData, isAnyArrayBuffer, isObject, writeErrorStack,
  type JSBufferView,
} from '../../../js-engine/index';
import {
  DOMExceptionImpl, DOMExceptionNames, type BindingContext,
} from '../../../web-idl/index';

import type { BrowletEnvironment } from '../../environment';

import type {
  SerializedArray, SerializedArrayBuffer, SerializedArrayBufferView,
  SerializedError, SerializedErrorName, SerializedMap, SerializedObject,
  SerializedPlatformObject, SerializedRecord, SerializedSet, StructuredDeserializeMemory,
} from './records';

// https://html.spec.whatwg.org/multipage/structured-data.html#structureddeserialize
// BINDING_INTEGRATION: reconstruct platform objects in the destination realm.
export function structuredDeserialize(
  serialized: SerializedRecord,
  ctx: BindingContext<BrowletEnvironment>,
  memory: StructuredDeserializeMemory = new Map(),
): unknown {
  return new StructuredDeserializer(ctx, memory).deserialize(serialized);
}

/** One target-realm graph traversal, including nested interface deserialization steps. */
class StructuredDeserializer {
  #ctx: BindingContext<BrowletEnvironment>;
  #memory: StructuredDeserializeMemory;

  constructor(ctx: BindingContext<BrowletEnvironment>, memory: StructuredDeserializeMemory) {
    this.#ctx = ctx;
    this.#memory = memory;
  }

  deserialize(serialized: SerializedRecord): unknown {
    if (this.#memory.has(serialized)) return this.#memory.get(serialized);
    const { realm } = this.#ctx;
    if (serialized.cluster !== null && serialized.cluster !== realm.agent.agentCluster) {
      throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
    }

    let value: unknown;
    switch (serialized.type) {
      case 'primitive':
        return serialized.value;
      case 'Boolean':
        value = Reflect.construct(realm.intrinsics.boolean, [serialized.value]);
        break;
      case 'Number':
        value = Reflect.construct(realm.intrinsics.number, [serialized.value]);
        break;
      case 'BigInt':
        value = Reflect.apply(realm.intrinsics.object, undefined, [serialized.value]);
        break;
      case 'String':
        value = Reflect.construct(realm.intrinsics.string, [serialized.value]);
        break;
      case 'Date':
        value = Reflect.construct(realm.intrinsics.date, [serialized.value]);
        break;
      case 'RegExp':
        value = Reflect.construct(realm.intrinsics.regExp, [serialized.source, serialized.flags]);
        break;
      case 'SharedArrayBuffer':
      case 'GrowableSharedArrayBuffer':
        value = realm.cloneSharedArrayBuffer(serialized.buffer);
        break;
      case 'ArrayBuffer':
      case 'ResizableArrayBuffer':
        value = this.#deserializeArrayBuffer(serialized);
        break;
      case 'ArrayBufferView':
        value = this.#deserializeBufferView(serialized);
        break;
      case 'Map':
        return this.#deserializeMap(serialized);
      case 'Set':
        return this.#deserializeSet(serialized);
      case 'Array':
        return this.#deserializeProperties(serialized, new realm.intrinsics.array<unknown>(serialized.length));
      case 'Object':
        return this.#deserializeProperties(serialized, realm.createOrdinaryObject(realm.intrinsics.objectPrototype));
      case 'Error':
        return this.#deserializeError(serialized);
      case 'platform-object':
        return this.#deserializePlatformObject(serialized);
      case 'transfer-placeholder':
        throw new InternalError('Transfer placeholder has no received value');
    }

    this.#memory.set(serialized, value);
    return value;
  }

  // StructuredDeserialize: ArrayBuffer and ResizableArrayBuffer branches.
  // https://html.spec.whatwg.org/multipage/structured-data.html#structureddeserialize
  #deserializeArrayBuffer(serialized: SerializedArrayBuffer): ArrayBuffer {
    try {
      return this.#ctx.realm.createArrayBuffer(
        serialized.bytes,
        serialized.maxByteLength,
      );
    } catch {
      throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
    }
  }

  // StructuredDeserialize: the ArrayBufferView branch.
  // https://html.spec.whatwg.org/multipage/structured-data.html#structureddeserialize
  #deserializeBufferView(serialized: SerializedArrayBufferView): JSBufferView {
    const buffer = this.deserialize(serialized.buffer);
    if (!isAnyArrayBuffer(buffer)) {
      throw new InternalError('An ArrayBufferView record has no backing buffer');
    }
    const length = serialized.constructor === 'DataView'
      ? serialized.byteLength
      : serialized.arrayLength;
    if (length === undefined) {
      throw new InternalError(`${serialized.constructor} has no serialized array length`);
    }
    return this.#ctx.realm.createView(
      serialized.constructor, buffer, serialized.byteOffset,
      length === 'auto' ? undefined : length,
    );
  }

  // StructuredDeserialize: deep deserialization of [[MapData]].
  // https://html.spec.whatwg.org/multipage/structured-data.html#structureddeserialize
  #deserializeMap(serialized: SerializedMap): Map<unknown, unknown> {
    const value = new this.#ctx.realm.intrinsics.map<unknown, unknown>();
    this.#memory.set(serialized, value);
    for (const entry of serialized.entries) {
      appendMapData(value, this.deserialize(entry.key), this.deserialize(entry.value));
    }
    return value;
  }

  // StructuredDeserialize: deep deserialization of [[SetData]].
  // https://html.spec.whatwg.org/multipage/structured-data.html#structureddeserialize
  #deserializeSet(serialized: SerializedSet): Set<unknown> {
    const value = new this.#ctx.realm.intrinsics.set<unknown>();
    this.#memory.set(serialized, value);
    for (const entry of serialized.entries) {
      appendSetData(value, this.deserialize(entry));
    }
    return value;
  }

  // StructuredDeserialize: enumerable own-property deserialization.
  // https://html.spec.whatwg.org/multipage/structured-data.html#structureddeserialize
  #deserializeProperties(serialized: SerializedArray | SerializedObject, value: object): object {
    this.#memory.set(serialized, value);
    for (const entry of serialized.properties) {
      const status = Reflect.defineProperty(value, entry.key, {
        configurable: true,
        enumerable: true,
        value: this.deserialize(entry.value),
        writable: true,
      });
      if (!status) throw new InternalError(`Could not deserialize property ${entry.key}`);
    }
    return value;
  }

  // StructuredDeserialize: [[ErrorData]] and its accompanying data.
  // https://html.spec.whatwg.org/multipage/structured-data.html#structureddeserialize
  #deserializeError(serialized: SerializedError): Error {
    const constructor = this.#getErrorConstructor(serialized.name);
    const value = new constructor(serialized.message);
    writeErrorStack(value, serialized.stack);
    this.#memory.set(serialized, value);
    if (serialized.cause === undefined) return value;
    const status = Reflect.defineProperty(value, 'cause', {
      configurable: true,
      enumerable: false,
      value: this.deserialize(serialized.cause),
      writable: true,
    });
    if (!status) throw new InternalError('Could not restore serialized Error cause');
    return value;
  }

  #getErrorConstructor(name: SerializedErrorName): ErrorConstructor {
    const { intrinsics } = this.#ctx.realm;
    switch (name) {
      case 'EvalError': return intrinsics.evalError;
      case 'RangeError': return intrinsics.rangeError;
      case 'ReferenceError': return intrinsics.referenceError;
      case 'SyntaxError': return intrinsics.syntaxError;
      case 'TypeError': return intrinsics.typeError;
      case 'URIError': return intrinsics.uriError;
      default: return intrinsics.error;
    }
  }

  // StructuredDeserialize: serializable platform objects.
  // https://html.spec.whatwg.org/multipage/structured-data.html#structureddeserialize
  #deserializePlatformObject(serialized: SerializedPlatformObject): object {
    const platformRecord = this.#ctx.createPlatformRecord(serialized.interfaceName);
    if (!platformRecord) throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
    const value = platformRecord.platformObject;
    this.#memory.set(serialized, value);
    if (value === undefined) throw new InternalError('A platform-object record has no platform object');
    const steps = platformRecord.assembled.serialSteps;
    if (!steps) {
      throw new InternalError(
        `${platformRecord.assembled.name} has no serialization steps`,
      );
    }
    platformRecord.deserializationSteps(
      serialized.data,
      {
        unwrap: (platformObject, implClass) => {
          const implementation = this.#ctx.unwrap(platformObject, implClass);
          if (!implementation) {
            throw new InternalError('Deserialized value does not implement the expected interface');
          }
          return implementation;
        },
        subdeserialize: (subSerialized) => {
          if (!isSerializedRecord(subSerialized)) {
            throw new InternalError('Sub-deserialization requires a serialized record');
          }
          return this.deserialize(subSerialized);
        },
      },
      steps,
    );
    return value;
  }
}

function isSerializedRecord(value: unknown): value is SerializedRecord {
  return isObject(value) &&
    typeof Reflect.get(value, 'type') === 'string';
}
