import {
  arg, defineInterface, idlType, impl, indexedGetter, nullable, op, reference,
  roAttr, xattr, type SerialSteps,
} from '../web-idl/index';
import { FileImpl } from './file';

/*
 * [Exposed=(Window,Worker), Serializable]
 * interface FileList {
 *   getter File? item(unsigned long index);
 *   readonly attribute unsigned long length;
 * };
 */
export class FileListImpl {
  #files: FileImpl[];

  constructor(files: Iterable<FileImpl> = []) {
    this.#files = [...files];
  }

  get length(): number {
    return this.#files.length;
  }

  item(index: number): FileImpl | null {
    return this.#files[index] ?? null;
  }

  [Symbol.iterator](): Iterator<FileImpl> {
    return this.#files[Symbol.iterator]();
  }

  // -- Internal operations ----------------------------------------------

  add(file: FileImpl): void {
    this.#files.push(file);
  }

  replace(files: Iterable<FileImpl>): void {
    this.#files = [...files];
  }

  static is(value: unknown): value is FileListImpl {
    return value !== null && typeof value === 'object' && #files in value;
  }
}

// https://w3c.github.io/FileAPI/#filelist-section
// Nested operations share the enclosing clone's memory, preserving repeated File identities.
const fileListSerialSteps = {
  serializationSteps(value, serialized, _forStorage, context) {
    const files = [];
    for (const file of value) files.push(context.subserialize(file, FileImpl));
    serialized.set('Files', files);
  },
  deserializationSteps(serialized, value, _targetRealm, context) {
    const files = serialized.get('Files').map((serializedFile) => {
      const platformFile = context.subdeserialize(serializedFile);
      return context.unwrap(platformFile, FileImpl);
    });
    value.replace(files);
  },
} satisfies SerialSteps<FileListImpl, { Files: object[]; }>;

export const fileListIDL = defineInterface({
  name: 'FileList',
  exposed: ['Window', 'Worker'],
  ...xattr('Serializable'),
  serialSteps: fileListSerialSteps,
  implementation: impl(FileListImpl),
  members: [
    op('item', nullable(reference('File')),
      [arg('index', idlType.unsignedLong)],
      indexedGetter(
        function* (list: FileListImpl) {
          for (let index = 0; index < list.length; index++) yield index;
        },
        { unsupportedValue: null },
      ),
    ),
    roAttr('length', idlType.unsignedLong),
  ],
});
