import {
  arg, ctor, defineDictionary, defineIncludes, defineInterface, dictMember,
  idlType, op, promise, reference,
} from '../web-idl/declaration/index';
import { bind } from '../web-idl';
import {
  getStreamEnvironment, type StreamEnvironment, type StreamPromise,
} from './environment';
import type { ReadableStreamImpl } from './readable-stream';
import { ReadableStreamGenericReaderMixin } from './readable-stream-generic-reader';
import {
  readableStreamDefaultReaderRead, readableStreamDefaultReaderRelease,
  setUpReadableStreamDefaultReader,
} from './readable-stream-operations';

export class ReadableStreamDefaultReaderImpl {
  #genericReader?: ReadableStreamGenericReaderMixin;
  #readRequests: ReadRequest[] = [];

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
    if (!reader.#genericReader) {
      throw new Error('ReadableStreamDefaultReader has no reader mixin');
    }
    return reader.#genericReader;
  }

  static getReadRequests(
    reader: ReadableStreamDefaultReaderImpl,
  ): ReadRequest[] {
    return reader.#readRequests;
  }

  static initializeForBinding(
    reader: ReadableStreamDefaultReaderImpl,
    environment: StreamEnvironment,
  ): void {
    reader.#genericReader = new ReadableStreamGenericReaderMixin(environment);
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
  binding: bind(ReadableStreamDefaultReaderImpl, {
    initialize(context, value) {
      ReadableStreamDefaultReaderImpl.initializeForBinding(
        value as ReadableStreamDefaultReaderImpl,
        getStreamEnvironment(context),
      );
    },
  }),
  exposed: '*',
  members: [
    ctor([arg('stream', reference('ReadableStream'))], bind({
      invoke(_context, stream) {
        setUpReadableStreamDefaultReader(
          this as ReadableStreamDefaultReaderImpl,
          stream as ReadableStreamImpl,
        );
      },
    })),
    op('read', promise(reference('ReadableStreamReadResult'))),
    op('releaseLock', idlType.undefined),
  ],
  name: 'ReadableStreamDefaultReader',
});

export const readableStreamDefaultReaderIncludesGenericReaderIDL =
  defineIncludes({
    interface: 'ReadableStreamDefaultReader',
    mixin: 'ReadableStreamGenericReader',
  });

export const readableStreamReadResultIDL = defineDictionary({
  members: [
    dictMember('value', idlType.any),
    dictMember('done', idlType.boolean),
  ],
  name: 'ReadableStreamReadResult',
});
