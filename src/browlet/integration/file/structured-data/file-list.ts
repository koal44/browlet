import {
  fileListIDL, FileImpl, FileListImpl,
} from '../../../../file/index';
import type { StructuredDataRecord } from '../../../scripting/structured-data/records';
import {
  serializable, type SerializableSteps,
} from '../../../scripting/structured-data/serializable';

/*
 * FileList sub-serialization uses HTML's shared memory so a File repeated in
 * the list and elsewhere in the graph retains one deserialized identity.
 */
const fileListSerializable: SerializableSteps = {
  serializationSteps(value, serialized, _forStorage, context) {
    if (!FileListImpl.is(value)) {
      throw new TypeError(
        'FileList serialization requires a FileList implementation',
      );
    }
    const files = [];
    for (const file of value) files.push(context.subserialize(file));
    serialized.set('Files', files);
  },

  deserializationSteps(serialized, value, _targetRealm, context) {
    if (!FileListImpl.is(value)) {
      throw new TypeError(
        'FileList deserialization requires a FileList implementation',
      );
    }
    const files = requireFiles(serialized).map((serializedFile) => {
      const object = context.subdeserialize(serializedFile);
      const file = context.getImplementation(object, FileImpl);
      if (!file) {
        throw new TypeError('A FileList entry did not deserialize to File');
      }
      return file;
    });
    value.replace(files);
  },
};

export const fileListSerializableCapabilities = [
  serializable.for(fileListIDL, fileListSerializable),
];

function requireFiles(record: StructuredDataRecord): unknown[] {
  const value = record.get('Files');
  if (!Array.isArray(value)) {
    throw new TypeError('Structured-data field [[Files]] is not a list');
  }
  return value;
}
