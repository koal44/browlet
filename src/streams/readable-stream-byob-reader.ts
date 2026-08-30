// @rollup-cycle streams-readable
import {
  arg, ctor, defineDictionary, defineIncludes, defineInterface, dictMember,
  emptyDictionary, idlType, impl, integer, op, promise, reference, xattr,
  type BufferViewTypeName,
} from '../web-idl/declaration/index';
import {
  getBufferSourceByteLength, getBufferSourceUnderlyingBuffer,
  getBufferTypeName, isBufferSourceDetached,
} from '../web-idl/buffer-source';
import { createDictionaryValue } from '../web-idl/conversion';
import {
  bindingContext, type BindingContext,
} from '../web-idl/projection';
import type { StreamPromise } from './promise';
import type { ReadableStreamImpl } from './readable-stream';
import { ReadableStreamGenericReaderMixin } from './readable-stream-generic-reader';
import {
  readableStreamBYOBReaderRead, readableStreamBYOBReaderRelease,
  setUpReadableStreamBYOBReader,
} from './readable-byte-stream-operations';

export class ReadableStreamBYOBReaderImpl {
  readonly #genericReader: ReadableStreamGenericReaderMixin;
  #readIntoRequests: ReadIntoRequest[] = [];

  constructor(context: BindingContext, stream?: ReadableStreamImpl) {
    this.#genericReader = new ReadableStreamGenericReaderMixin(context);
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
    const context = ReadableStreamGenericReaderMixin.getContext(generic);
    const viewByteLength = getBufferSourceByteLength(view);
    const buffer = getBufferSourceUnderlyingBuffer(view);
    if (viewByteLength === 0) {
      return rejectedTypeError(context, 'view must have non-zero byteLength');
    }
    if (getBufferSourceByteLength(buffer) === 0) {
      return rejectedTypeError(
        context,
        'view\'s buffer must have non-zero byteLength',
      );
    }
    if (isBufferSourceDetached(buffer)) {
      return rejectedTypeError(context, 'view\'s buffer is detached');
    }
    if (options.min === 0) {
      return rejectedTypeError(context, 'options.min must be greater than 0');
    }

    const type = requireBufferViewType(view);
    const elementSize = bufferViewElementSizes[type];
    const viewLength = type === 'DataView'
      ? viewByteLength
      : viewByteLength / elementSize;
    if (options.min > viewLength) {
      return context.createRejectedPromise(
        new context.realm.intrinsics.rangeError(
          `options.min must not exceed the view's ${
            type === 'DataView' ? 'byteLength' : 'length'
          }`,
        ),
        reference('ReadableStreamReadResult'),
      );
    }
    if (!ReadableStreamGenericReaderMixin.getState(generic).stream) {
      return rejectedTypeError(
        context,
        'Cannot read from a stream using a released reader',
      );
    }

    const promise = context.createPromise(
      reference('ReadableStreamReadResult'),
    );
    readableStreamBYOBReaderRead(this, view, options.min, {
      chunkSteps: (chunk) => context.resolvePromise(
        promise,
        createDictionaryValue([
          ['value', chunk],
          ['done', false],
        ]),
      ),
      closeSteps: (chunk) => context.resolvePromise(
        promise,
        createDictionaryValue([
          ['value', chunk],
          ['done', true],
        ]),
      ),
      errorSteps: (reason) => context.rejectPromise(promise, reason),
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
  exposed: '*',
  implementation: impl(ReadableStreamBYOBReaderImpl, {
    constructWith: [bindingContext],
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
  context: BindingContext,
  message: string,
): StreamPromise {
  return context.createRejectedPromise(
    new context.realm.intrinsics.typeError(message),
    reference('ReadableStreamReadResult'),
  );
}

function requireBufferViewType(view: object): BufferViewTypeName {
  const type = getBufferTypeName(view);
  if (!type || type === 'ArrayBuffer' || type === 'SharedArrayBuffer') {
    throw new Error('ArrayBuffer view has no recognized view type');
  }
  return type;
}
