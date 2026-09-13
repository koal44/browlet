import {
  domExceptionIDL, quotaExceededErrorIDL,
  type DOMExceptionImpl, type QuotaExceededErrorImpl,
} from '../../web-idl/index';
import type { StructuredDataRecord } from '../scripting/structured-data/records';
import {
  serializable, type SerializableSteps,
} from '../scripting/structured-data/serializable';

/*
 * Web IDL owns DOMException's implementation state. This HTML integration owns the
 * Serializable capability contract and its realm-independent record fields.
 */
const domExceptionSerializable = {
  serializationSteps(value: DOMExceptionImpl, serialized) {
    serialized.set('Name', value.name);
    serialized.set('Message', value.message);
  },

  deserializationSteps(serialized, value: DOMExceptionImpl) {
    value.setExceptionState(
      requireString(serialized, 'Message'),
      requireString(serialized, 'Name'),
    );
  },
} satisfies SerializableSteps;

const quotaExceededErrorSerializable = {
  serializationSteps(value: QuotaExceededErrorImpl, serialized) {
    domExceptionSerializable.serializationSteps(value, serialized);
    serialized.set('Quota', value.quota);
    serialized.set('Requested', value.requested);
  },

  deserializationSteps(serialized, value: QuotaExceededErrorImpl) {
    domExceptionSerializable.deserializationSteps(serialized, value);
    value.setQuotaState(
      requireNullableNumber(serialized, 'Quota'),
      requireNullableNumber(serialized, 'Requested'),
    );
  },
} satisfies SerializableSteps;

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
