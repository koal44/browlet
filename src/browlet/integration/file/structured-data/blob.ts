import {
  blobIDL, BlobData, BlobImpl,
} from '../../../../file/index';
import {
  domExceptionName, throwDOMException,
} from '../../../../web-idl/exceptions/dom-exception-core';
import type { StructuredDataRecord } from '../../../scripting/structured-data/records';
import {
  serializable, type SerializableSteps,
} from '../../../scripting/structured-data/serializable';

/*
 * File API defines Blob's record fields. HTML owns their registration and
 * execution through the generic Serializable machinery.
 */
export const blobSerializable = {
  serializationSteps(value, serialized, forStorage) {
    if (!BlobImpl.is(value)) {
      throw new TypeError('Blob serialization requires a Blob implementation');
    }
    const state = value.getSerializationState();
    let data = state.data;
    if (forStorage) {
      try {
        data = data.cloneForStorage();
      } catch {
        return throwDOMException(
          domExceptionName.dataClone,
          'The Blob byte source cannot be serialized for storage',
        );
      }
    }
    serialized.set('SnapshotState', state.snapshotState);
    serialized.set('ByteSequence', data);

    // Preserve the MIME type, which the draft's listed record fields omit.
    serialized.set('Type', state.type);
  },

  deserializationSteps(serialized, value) {
    if (!BlobImpl.is(value)) {
      throw new TypeError('Blob deserialization requires a Blob implementation');
    }
    value.setSerializationState({
      data: requireBlobData(serialized, 'ByteSequence'),
      snapshotState: serialized.get('SnapshotState'),
      type: requireString(serialized, 'Type'),
    });
  },
} satisfies SerializableSteps;

export const blobSerializableCapabilities = [
  serializable.for(blobIDL, blobSerializable),
];

function requireBlobData(
  record: StructuredDataRecord,
  field: string,
): BlobData {
  const value = record.get(field);
  if (!(value instanceof BlobData)) {
    throw new TypeError(
      `Structured-data field [[${field}]] is not Blob data`,
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
