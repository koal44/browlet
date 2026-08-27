import {
  arg, ctor, defineDictionary, defineIncludes, defineInterface, dictMember,
  emptyDictionary, idlType, impl, integer, op, promise, reference, xattr,
} from '../web-idl/declaration/index';
import {
  streamEnvironment, type StreamEnvironment, type StreamPromise,
} from './environment';
import type { ReadableStreamImpl } from './readable-stream';
import { ReadableStreamGenericReaderMixin } from './readable-stream-generic-reader';
import {
  readableStreamBYOBReaderRead, readableStreamBYOBReaderRelease,
  setUpReadableStreamBYOBReader,
} from './readable-byte-stream-operations';

export class ReadableStreamBYOBReaderImpl {
  readonly #genericReader: ReadableStreamGenericReaderMixin;
  #readIntoRequests: ReadIntoRequest[] = [];

  constructor(environment: StreamEnvironment, stream?: ReadableStreamImpl) {
    this.#genericReader = new ReadableStreamGenericReaderMixin(environment);
    if (stream) setUpReadableStreamBYOBReader(this, stream);
  }

  get closed(): StreamPromise {
    return ReadableStreamBYOBReaderImpl.getGenericReader(this).closed;
  }

  cancel(reason?: unknown): StreamPromise {
    return ReadableStreamBYOBReaderImpl.getGenericReader(this).cancel(reason);
  }

  read(view: object, options: ReadableStreamBYOBReaderReadOptions): StreamPromise {
    const generic = ReadableStreamBYOBReaderImpl.getGenericReader(this);
    const environment = ReadableStreamGenericReaderMixin.getEnvironment(generic);
    const buffers = environment.buffers;
    const viewByteLength = buffers.getByteLength(view);
    const buffer = buffers.getBuffer(view);
    if (viewByteLength === 0) {
      return rejectedTypeError(environment, 'view must have non-zero byteLength');
    }
    if (buffers.getByteLength(buffer) === 0) {
      return rejectedTypeError(
        environment,
        'view\'s buffer must have non-zero byteLength',
      );
    }
    if (buffers.isDetached(buffer)) {
      return rejectedTypeError(environment, 'view\'s buffer is detached');
    }
    if (options.min === 0) {
      return rejectedTypeError(environment, 'options.min must be greater than 0');
    }

    const type = buffers.getViewType(view);
    const elementSize = bufferViewElementSizes[type];
    const viewLength = type === 'DataView'
      ? viewByteLength
      : viewByteLength / elementSize;
    if (options.min > viewLength) {
      return environment.promises.createRejected(
        new RangeError(
          `options.min must not exceed the view's ${
            type === 'DataView' ? 'byteLength' : 'length'
          }`,
        ),
        reference('ReadableStreamReadResult'),
      );
    }
    if (!ReadableStreamGenericReaderMixin.getState(generic).stream) {
      return rejectedTypeError(
        environment,
        'Cannot read from a stream using a released reader',
      );
    }

    const promise = environment.promises.create(
      reference('ReadableStreamReadResult'),
    );
    readableStreamBYOBReaderRead(this, view, options.min, {
      chunkSteps: (chunk) => environment.promises.resolve(
        promise,
        environment.dictionaries.create([
          ['value', chunk],
          ['done', false],
        ]),
      ),
      closeSteps: (chunk) => environment.promises.resolve(
        promise,
        environment.dictionaries.create([
          ['value', chunk],
          ['done', true],
        ]),
      ),
      errorSteps: (reason) => environment.promises.reject(promise, reason),
    });
    return promise;
  }

  releaseLock(): void {
    const generic = ReadableStreamBYOBReaderImpl.getGenericReader(this);
    if (!ReadableStreamGenericReaderMixin.getState(generic).stream) return;
    readableStreamBYOBReaderRelease(this);
  }

  // -- Friends ----------------------------------------------------------

  static getGenericReader(
    reader: ReadableStreamBYOBReaderImpl,
  ): ReadableStreamGenericReaderMixin {
    return reader.#genericReader;
  }

  static is(value: unknown): value is ReadableStreamBYOBReaderImpl {
    return typeof value === 'object' && value !== null && #genericReader in value;
  }

  static getReadIntoRequests(
    reader: ReadableStreamBYOBReaderImpl,
  ): ReadIntoRequest[] {
    return reader.#readIntoRequests;
  }

  static resetReadIntoRequests(reader: ReadableStreamBYOBReaderImpl): void {
    reader.#readIntoRequests = [];
  }
}

export type ReadIntoRequest = {
  chunkSteps(chunk: object): void;
  closeSteps(chunk: object | undefined): void;
  errorSteps(reason: unknown): void;
};

export type ReadableStreamBYOBReaderReadOptions = {
  readonly min: number;
};

export const readableStreamBYOBReaderIDL = defineInterface({
  name: 'ReadableStreamBYOBReader',
  exposed: ['Window', 'Worker', 'Worklet'],
  implementation: impl(ReadableStreamBYOBReaderImpl, {
    withArgs: [streamEnvironment],
  }),
  members: [
    ctor([arg('stream', reference('ReadableStream'))]),
    op('read', promise(reference('ReadableStreamReadResult')), [
      arg('view', reference('ArrayBufferView')),
      arg('options', reference('ReadableStreamBYOBReaderReadOptions'), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
    op('releaseLock', idlType.undefined),
  ],
});

export const readableStreamBYOBReaderIncludesGenericReaderIDL =
  defineIncludes({
    interface: 'ReadableStreamBYOBReader',
    mixin: 'ReadableStreamGenericReader',
  });

export const readableStreamBYOBReaderReadOptionsIDL = defineDictionary({
  name: 'ReadableStreamBYOBReaderReadOptions',
  members: [dictMember('min', idlType.unsignedLongLong, {
    default: integer(1),
    ...xattr('EnforceRange'),
  })],
});

const bufferViewElementSizes = {
  BigInt64Array: 8,
  BigUint64Array: 8,
  DataView: 1,
  Float16Array: 2,
  Float32Array: 4,
  Float64Array: 8,
  Int16Array: 2,
  Int32Array: 4,
  Int8Array: 1,
  Uint16Array: 2,
  Uint32Array: 4,
  Uint8Array: 1,
  Uint8ClampedArray: 1,
} as const;

function rejectedTypeError(
  environment: StreamEnvironment,
  message: string,
): StreamPromise {
  return environment.promises.createRejected(
    new TypeError(message),
    reference('ReadableStreamReadResult'),
  );
}
