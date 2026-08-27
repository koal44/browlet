import {
  arg, ctor, defineDictionary, defineIncludes, defineInterface, dictMember,
  idlType, impl, op, promise, reference,
} from '../web-idl/declaration/index';
import {
  streamEnvironment, type StreamEnvironment, type StreamPromise,
} from './environment';
import type { ReadableStreamImpl } from './readable-stream';
import { ReadableStreamGenericReaderMixin } from './readable-stream-generic-reader';
import {
  readableStreamDefaultReaderRead, readableStreamDefaultReaderRelease,
  setUpReadableStreamDefaultReader,
} from './readable-stream-operations';

export class ReadableStreamDefaultReaderImpl {
  readonly #genericReader: ReadableStreamGenericReaderMixin;
  #readRequests: ReadRequest[] = [];

  constructor(
    environment: StreamEnvironment,
    stream?: ReadableStreamImpl,
  ) {
    this.#genericReader = new ReadableStreamGenericReaderMixin(environment);
    if (stream) setUpReadableStreamDefaultReader(this, stream);
  }

  get closed(): StreamPromise {
    return ReadableStreamDefaultReaderImpl.getGenericReader(this).closed;
  }

  cancel(reason?: unknown): StreamPromise {
    return ReadableStreamDefaultReaderImpl.getGenericReader(this).cancel(
      reason,
    );
  }

  read(): StreamPromise {
    const generic = ReadableStreamDefaultReaderImpl.getGenericReader(this);
    const environment = ReadableStreamGenericReaderMixin.getEnvironment(
      generic,
    );
    if (!ReadableStreamGenericReaderMixin.getState(generic).stream) {
      return environment.promises.createRejected(
        new TypeError('Cannot read from a stream using a released reader'),
        reference('ReadableStreamReadResult'),
      );
    }

    const promise = environment.promises.create(
      reference('ReadableStreamReadResult'),
    );
    readableStreamDefaultReaderRead(this, {
      chunkSteps(chunk) {
        environment.promises.resolve(promise, { done: false, value: chunk });
      },
      closeSteps() {
        environment.promises.resolve(
          promise,
          { done: true, value: undefined },
        );
      },
      errorSteps(reason) {
        environment.promises.reject(promise, reason);
      },
    });
    return promise;
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

  static getReadRequests(
    reader: ReadableStreamDefaultReaderImpl,
  ): ReadRequest[] {
    return reader.#readRequests;
  }

  static resetReadRequests(reader: ReadableStreamDefaultReaderImpl): void {
    reader.#readRequests = [];
  }
}

export type ReadRequest = {
  chunkSteps(chunk: unknown): void;
  closeSteps(): void;
  errorSteps(reason: unknown): void;
};

// -- Web IDL ------------------------------------------------------------

export const readableStreamDefaultReaderIDL = defineInterface({
  name: 'ReadableStreamDefaultReader',
  exposed: '*',
  implementation: impl(ReadableStreamDefaultReaderImpl, {
    withArgs: [streamEnvironment],
  }),
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
