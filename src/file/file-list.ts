import {
  arg, defineInterface, idlType, impl, indexedGetter, nullable, op, reference,
  roAttr, xattr,
} from '../web-idl/declaration/index';
import type { FileImpl } from './file';

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

  // Owner operations. These are not members of the projected FileList.

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

// -- Web IDL ------------------------------------------------------------

export const fileListIDL = defineInterface({
  name: 'FileList',
  exposed: ['Window', 'Worker'],
  ...xattr('Serializable'),
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
