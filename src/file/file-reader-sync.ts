import {
  arg, atArg, ctor, defineInterface, idlType, impl, op, reference,
} from '../web-idl/core/index';

import type { BlobImpl } from './blob';
import { BlobReadFailure } from './blob-data';
import type { FileEnvironment } from './environment';
import { packageData } from './package-data';

/** Reads Blob backing synchronously in dedicated and shared workers. */
// https://w3c.github.io/FileAPI/#FileReaderSync
export class FileReaderSyncImpl {
  /** Realm used to allocate returned ArrayBuffers. */
  #env: FileEnvironment;

  constructor(env: FileEnvironment) {
    this.#env = env;
  }

  /** Copy the complete Blob into a new ArrayBuffer in this reader's realm. */
  readAsArrayBuffer(blob: BlobImpl): ArrayBuffer {
    return packageData(this.#readBytes(blob), 'ArrayBuffer', blob.type, undefined, this.#env);
  }

  /** Return one code unit per byte, including zero and non-ASCII bytes. */
  readAsBinaryString(blob: BlobImpl): string {
    return packageData(this.#readBytes(blob), 'BinaryString', blob.type, undefined, this.#env);
  }

  /** Decode using the supplied label, MIME charset, and BOM rules. */
  readAsText(blob: BlobImpl, encoding?: string): string {
    return packageData(this.#readBytes(blob), 'Text', blob.type, encoding, this.#env);
  }

  /** Encode the Blob bytes and media type as a base64 data URL. */
  readAsDataURL(blob: BlobImpl): string {
    return packageData(this.#readBytes(blob), 'DataURL', blob.type, undefined, this.#env);
  }

  /** Read internal storage and translate source failures without running author jobs. */
  #readBytes(blob: BlobImpl): Uint8Array {
    // The read methods specify an internal Blob stream followed by a synchronous
    // wait. Read the same backing directly: no author stream() lookup, nested
    // event loop, or Promise pumping. Async-only host sources remain a dependency.
    try {
      return blob.data.readSync();
    } catch (error) {
      throw error instanceof BlobReadFailure ? error.toDOMException() : error;
    }
  }
}

export const fileReaderSyncIDL = defineInterface<FileEnvironment>({
  name: 'FileReaderSync',
  exposed: ['DedicatedWorker', 'SharedWorker'],
  implementation: impl(FileReaderSyncImpl, {
    constructWith: [atArg(0, (env) => env)],
  }),
  members: [
    ctor(),
    op('readAsArrayBuffer', idlType.ArrayBuffer, [arg('blob', reference('Blob'))]),
    op('readAsBinaryString', idlType.DOMString, [arg('blob', reference('Blob'))]),
    op('readAsText', idlType.DOMString, [
      arg('blob', reference('Blob')),
      arg('encoding', idlType.DOMString, { optional: true }),
    ]),
    op('readAsDataURL', idlType.DOMString, [arg('blob', reference('Blob'))]),
  ],
});
