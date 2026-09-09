// @rollup-cycle streams-readable
import { InternalPromise } from '../js-engine/internal-promise';
import {
  arg, ctor, defineDictionary, defineIncludes, defineInterface, dictMember,
  emptyDictionary, idlType, impl, integer, op, promise, reference, xattr,
  type BufferViewTypeName,
} from '../web-idl/declaration/index';
import {
  getBufferSourceByteLength, getBufferSourceUnderlyingBuffer,
  getBufferTypeName, isBufferSourceDetached,
} from '../web-idl/buffer-source';
import { RangeError, TypeError } from '../js-engine/simple-exception';
import type { ReadableStreamReadResult } from './readable-stream-default-reader';
import type { ReadableStreamImpl } from './readable-stream';
import { ReadableStreamGenericReaderMixin } from './readable-stream-generic-reader';
import {
  readableStreamBYOBReaderRead, readableStreamBYOBReaderRelease,
  setUpReadableStreamBYOBReader,
} from './readable-byte-stream-operations';

export class ReadableStreamBYOBReaderImpl {
  readonly #genericReader: ReadableStreamGenericReaderMixin;
  #readIntoRequests: ReadIntoRequest[] = [];

  // SPEC_MISMATCH: ReadableStreamBYOBReader(stream) -> ReadableStreamBYOBReader
  constructor(stream?: ReadableStreamImpl) {
    this.#genericReader = new ReadableStreamGenericReaderMixin();
    if (stream) setUpReadableStreamBYOBReader(this, stream);
  }

  // SPEC_MISMATCH: get closed() -> Promise<undefined>
  get closed(): InternalPromise<void> {
    return ReadableStreamBYOBReaderImpl.getGenericReader(this).closed;
  }

  // SPEC_MISMATCH: cancel(reason?) -> Promise<undefined>
  cancel(reason?: unknown): InternalPromise<void> {
    return ReadableStreamBYOBReaderImpl.getGenericReader(this).cancel(reason);
  }

  // SPEC_MISMATCH: read(view, options = {}) -> Promise<ReadableStreamReadResult>
  read(view: object, options: ReadableStreamBYOBReaderReadOptions): InternalPromise<ReadableStreamReadResult> {
    const generic = ReadableStreamBYOBReaderImpl.getGenericReader(this);
    const viewByteLength = getBufferSourceByteLength(view);
    const buffer = getBufferSourceUnderlyingBuffer(view);
    if (viewByteLength === 0) {
      return rejectedTypeError('view must have non-zero byteLength');
    }
    if (getBufferSourceByteLength(buffer) === 0) {
      return rejectedTypeError(
        'view\'s buffer must have non-zero byteLength',
      );
    }
    if (isBufferSourceDetached(buffer)) {
      return rejectedTypeError('view\'s buffer is detached');
    }
    if (options.min === 0) {
      return rejectedTypeError('options.min must be greater than 0');
    }

    const type = requireBufferViewType(view);
    const elementSize = bufferViewElementSizes[type];
    const viewLength = type === 'DataView'
      ? viewByteLength
      : viewByteLength / elementSize;
    if (options.min > viewLength) {
      return InternalPromise.reject(new RangeError(
        `options.min must not exceed the view's ${
            type === 'DataView' ? 'byteLength' : 'length'
        }`,
      ));
    }
    if (!ReadableStreamGenericReaderMixin.getState(generic).stream) {
      return rejectedTypeError(
        'Cannot read from a stream using a released reader',
      );
    }

    const promise = InternalPromise.withResolvers<ReadableStreamReadResult>();
    readableStreamBYOBReaderRead(this, view, options.min, {
      chunkSteps: (chunk) => promise.resolve({ value: chunk, done: false }),
      closeSteps: (chunk) => promise.resolve({ value: chunk, done: true }),
      errorSteps: (reason) => promise.reject(reason),
    });
    return promise.promise;
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
  exposed: '*',
  implementation: impl(ReadableStreamBYOBReaderImpl),
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
  message: string,
): InternalPromise<never> {
  return InternalPromise.reject(new TypeError(message));
}

function requireBufferViewType(view: object): BufferViewTypeName {
  const type = getBufferTypeName(view);
  if (!type || type === 'ArrayBuffer' || type === 'SharedArrayBuffer') {
    throw new Error('ArrayBuffer view has no recognized view type');
  }
  return type;
}
