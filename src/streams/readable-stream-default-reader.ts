// @rollup-cycle streams-readable
import {
  arg, ctor, defineDictionary, defineIncludes, defineInterface, dictMember,
  idlType, impl, op, promise, reference,
} from '../web-idl/declaration/index';
import { createDictionaryValue } from '../web-idl/conversion';
import {
  bindingContext, type BindingContext,
} from '../web-idl/projection';
import type { StreamPromise } from './promise';
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
    context: BindingContext,
    stream?: ReadableStreamImpl,
  ) {
    this.#genericReader = new ReadableStreamGenericReaderMixin(context);
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
    const context = ReadableStreamGenericReaderMixin.getContext(
      generic,
    );
    if (!ReadableStreamGenericReaderMixin.getState(generic).stream) {
      return context.createRejectedPromise(
        new context.realm.intrinsics.typeError(
          'Cannot read from a stream using a released reader',
        ),
        reference('ReadableStreamReadResult'),
      );
    }

    const promise = context.createPromise(
      reference('ReadableStreamReadResult'),
    );
    readableStreamDefaultReaderRead(this, {
      chunkSteps(chunk) {
        context.resolvePromise(promise, createDictionaryValue([
          ['value', chunk],
          ['done', false],
        ]));
      },
      closeSteps() {
        context.resolvePromise(
          promise,
          createDictionaryValue([
            ['value', undefined],
            ['done', true],
          ]),
        );
      },
      errorSteps(reason) {
        context.rejectPromise(promise, reason);
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
    constructWith: [bindingContext],
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
