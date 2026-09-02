import {
  domExceptionIDL, getDOMExceptionSerializationState,
  getQuotaExceededErrorSerializationState, quotaExceededErrorIDL,
  setDOMExceptionSerializationState,
  setQuotaExceededErrorSerializationState,
} from '../../web-idl/dom-exception';
import type { StructuredDataRecord } from '../scripting/structured-data/records';
import {
  serializable, type SerializableSteps,
} from '../scripting/structured-data/serializable';

/*
 * Web IDL owns DOMException's semantic state. This HTML integration owns the
 * Serializable capability contract and its realm-independent record fields.
 */
const domExceptionSerializable: SerializableSteps = {
  serializationSteps(value, serialized) {
    const state = getDOMExceptionSerializationState(value);
    serialized.set('Name', state.name);
    serialized.set('Message', state.message);
  },

  deserializationSteps(serialized, value) {
    setDOMExceptionSerializationState(value, {
      message: requireString(serialized, 'Message'),
      name: requireString(serialized, 'Name'),
    });
  },
};

const quotaExceededErrorSerializable: SerializableSteps = {
  serializationSteps(value, serialized, forStorage, context) {
    domExceptionSerializable.serializationSteps(
      value,
      serialized,
      forStorage,
      context,
    );
    const state = getQuotaExceededErrorSerializationState(value);
    serialized.set('Quota', state.quota);
    serialized.set('Requested', state.requested);
  },

  deserializationSteps(serialized, value, targetRealm, context) {
    domExceptionSerializable.deserializationSteps(
      serialized,
      value,
      targetRealm,
      context,
    );
    setQuotaExceededErrorSerializationState(value, {
      quota: requireNullableNumber(serialized, 'Quota'),
      requested: requireNullableNumber(serialized, 'Requested'),
    });
  },
};

export const domExceptionCapabilities = [
  serializable.for(domExceptionIDL, domExceptionSerializable),
  serializable.for(quotaExceededErrorIDL, quotaExceededErrorSerializable),
];

function requireString(
  record: StructuredDataRecord,
  field: string,
): string {
  const value = record.get(field);
  if (typeof value !== 'string') {
    throw new TypeError(`Structured-data field [[${field}]] is not a string`);
  }
  return value;
}

function requireNullableNumber(
  record: StructuredDataRecord,
  field: string,
): number | null {
  const value = record.get(field);
  if (value !== null && typeof value !== 'number') {
    throw new TypeError(
      `Structured-data field [[${field}]] is not a nullable number`,
    );
  }
  return value;
}
