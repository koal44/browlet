// @rollup-cycle streams-readable
import {
  arg, ctor, defineDictionary, defineIncludes, defineInterface, dictMember,
  idlType, impl, op, promise, reference,
} from '../web-idl/declaration/index';
import { TypeError } from '../js-engine/simple-exception';
import { InternalPromise } from '../js-engine/index';
import type { ReadableStreamImpl } from './readable-stream';
import { ReadableStreamGenericReaderMixin } from './readable-stream-generic-reader';
import {
  readableStreamDefaultReaderRead, readableStreamDefaultReaderRelease,
  setUpReadableStreamDefaultReader,
} from './readable-stream-operations';

export class ReadableStreamDefaultReaderImpl {
  readonly #genericReader: ReadableStreamGenericReaderMixin;
  #readRequests: ReadRequest[] = [];

  // SPEC_MISMATCH: ReadableStreamDefaultReader(stream) -> ReadableStreamDefaultReader
  constructor(
    stream?: ReadableStreamImpl,
  ) {
    this.#genericReader = new ReadableStreamGenericReaderMixin();
    if (stream) setUpReadableStreamDefaultReader(this, stream);
  }

  get closed(): Promise<void> {
    return ReadableStreamDefaultReaderImpl.getGenericReader(this).closed;
  }

  cancel(reason?: unknown): Promise<void> {
    return ReadableStreamDefaultReaderImpl.getGenericReader(this).cancel(
      reason,
    );
  }

  // SPEC_MISMATCH: read() -> Promise<ReadableStreamReadResult>
  read(): InternalPromise<ReadableStreamReadResult> {
    const promise = InternalPromise.withResolvers<ReadableStreamReadResult>();
    const generic = ReadableStreamDefaultReaderImpl.getGenericReader(this);
    if (!ReadableStreamGenericReaderMixin.getState(generic).stream) {
      promise.reject(new TypeError(
        'Cannot read from a stream using a released reader',
      ));
      return promise.promise;
    }

    readableStreamDefaultReaderRead(this, {
      chunkSteps(chunk) {
        promise.resolve({ value: chunk, done: false });
      },
      closeSteps() {
        promise.resolve({ value: undefined, done: true });
      },
      errorSteps(reason) {
        promise.reject(reason);
      },
    });
    return promise.promise;
  }

  releaseLock(): void {
    const generic = ReadableStreamDefaultReaderImpl.getGenericReader(this);
    if (!ReadableStreamGenericReaderMixin.getState(generic).stream) return;
    readableStreamDefaultReaderRelease(this);
  }

  // -- Friends ----------------------------------------------------------

  static getGenericReader(
    reader: ReadableStreamDefaultReaderImpl,
  ): ReadableStreamGenericReaderMixin {
    return reader.#genericReader;
  }

  static is(value: unknown): value is ReadableStreamDefaultReaderImpl {
    return typeof value === 'object' && value !== null && #genericReader in value;
  }

  static getReadRequests(
    reader: ReadableStreamDefaultReaderImpl,
  ): ReadRequest[] {
    return reader.#readRequests;
  }

  static resetReadRequests(reader: ReadableStreamDefaultReaderImpl): void {
    reader.#readRequests = [];
  }
}

export type ReadableStreamReadResult = {
  value: unknown;
  done: boolean;
};

export type ReadRequest = {
  chunkSteps(chunk: unknown): void;
  closeSteps(): void;
  errorSteps(reason: unknown): void;
};

// -- Web IDL ------------------------------------------------------------

export const readableStreamDefaultReaderIDL = defineInterface({
  name: 'ReadableStreamDefaultReader',
  exposed: '*',
  implementation: impl(ReadableStreamDefaultReaderImpl),
  members: [
    ctor([arg('stream', reference('ReadableStream'))]),
    op('read', promise(reference('ReadableStreamReadResult'))),
    op('releaseLock', idlType.undefined),
  ],
});

export const readableStreamDefaultReaderIncludesGenericReaderIDL =
  defineIncludes({
    interface: 'ReadableStreamDefaultReader',
    mixin: 'ReadableStreamGenericReader',
  });

export const readableStreamReadResultIDL = defineDictionary({
  name: 'ReadableStreamReadResult',
  members: [
    dictMember('value', idlType.any),
    dictMember('done', idlType.boolean),
  ],
});
