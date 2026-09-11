import {
  fileIDL, FileImpl,
} from '../../../../file/index';
import type { StructuredDataRecord } from '../../../scripting/structured-data/records';
import {
  serializable, type SerializableSteps,
} from '../../../scripting/structured-data/serializable';
import { blobSerializable } from './blob';

/*
 * File API defines File's record fields. HTML owns their registration and
 * composes the inherited Blob state into File's standalone capability.
 */
const fileSerializable: SerializableSteps = {
  serializationSteps(value, serialized, forStorage) {
    if (!FileImpl.is(value)) {
      throw new TypeError('File serialization requires a File implementation');
    }
    blobSerializable.serializationSteps(value, serialized, forStorage);
    const state = value.getFileSerializationState();
    serialized.set('Name', state.name);
    serialized.set('LastModified', state.lastModified);
  },

  deserializationSteps(serialized, value) {
    if (!FileImpl.is(value)) {
      throw new TypeError('File deserialization requires a File implementation');
    }
    blobSerializable.deserializationSteps(serialized, value);
    value.setFileSerializationState({
      lastModified: requireNumber(serialized, 'LastModified'),
      name: requireString(serialized, 'Name'),
    });
  },
};

export const fileSerializableCapabilities = [
  serializable.for(fileIDL, fileSerializable),
];

function requireNumber(
  record: StructuredDataRecord,
  field: string,
): number {
  const value = record.get(field);
  if (typeof value !== 'number') {
    throw new TypeError(
      `Structured-data field [[${field}]] is not a number`,
    );
  }
  return value;
}

function requireString(
  record: StructuredDataRecord,
  field: string,
): string {
  const value = record.get(field);
  if (typeof value !== 'string') {
    throw new TypeError(
      `Structured-data field [[${field}]] is not a string`,
    );
  }
  return value;
}
