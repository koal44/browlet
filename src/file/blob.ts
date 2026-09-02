import { utf8Decode, utf8Encode } from '../encoding/utf-8';
import { TextDecoderStreamImpl } from '../encoding/text-decoder-stream';
import { domExceptionName, createDOMException } from '../shared/dom-exception';
import {
  closeReadableStream, enqueueReadableStream, errorReadableStream,
  createReadableStreamWithByteReadingSupport, getReadableStreamReader,
  pipeReadableStreamThrough, readAllBytes, type ReadableStreamImpl,
} from '../streams/index';
import {
  createArrayBuffer, createArrayBufferView, getBufferSourceCopy,
} from '../web-idl/buffer-source';
import {
  arg, ctor, defineDictionary, defineEnumeration, defineInterface,
  defineTypedef, dictMember, emptyDictionary, emptySequence, idlType, op,
  promise, reference, roAttr, sequence, union, invokeWith, xattr,
  type WebIDLType,
} from '../web-idl/declaration/index';
import {
  bind, bindingContext, type BindingContext,
} from '../web-idl/projection';
import {
  BlobData, BlobReadFailure, type BlobSnapshotState,
} from './blob-data';
import {
  getNativeLineEnding, queueFileReadingTask, runFileStepsInParallel,
  type NativeLineEnding,
} from './environment';

/*
 * [Exposed=(Window,Worker), Serializable]
 * interface Blob {
 *   constructor(optional sequence<BlobPart> blobParts,
 *               optional BlobPropertyBag options = {});
 *
 *   readonly attribute unsigned long long size;
 *   readonly attribute DOMString type;
 *
 *   Blob slice(optional [Clamp] long long start,
 *              optional [Clamp] long long end,
 *              optional DOMString contentType);
 *
 *   [NewObject] ReadableStream stream();
 *   [NewObject] Promise<USVString> text();
 *   [NewObject] Promise<ArrayBuffer> arrayBuffer();
 *   [NewObject] ReadableStream textStream();
 *   [NewObject] Promise<Uint8Array> bytes();
 * };
 *
 * enum EndingType { "transparent", "native" };
 *
 * dictionary BlobPropertyBag {
 *   DOMString type = "";
 *   EndingType endings = "transparent";
 * };
 *
 * typedef (BufferSource or Blob or USVString) BlobPart;
 */
export class BlobImpl {
  #context: BindingContext | null;
  #data: BlobData;
  #nativeLineEnding: NativeLineEnding;
  #snapshotState: BlobSnapshotState;
  #type: string;

  constructor(
    contextOrLineEnding: BindingContext | NativeLineEnding,
    blobParts: Iterable<BlobPart> = [],
    options: BlobPropertyBag = {},
  ) {
    const context = typeof contextOrLineEnding === 'string'
      ? null
      : contextOrLineEnding;
    const nativeLineEnding = context === null
      ? contextOrLineEnding as NativeLineEnding
      : getNativeLineEnding(context);
    this.#context = context;
    this.#nativeLineEnding = nativeLineEnding;
    this.#data = processBlobParts(blobParts, options, nativeLineEnding);
    this.#snapshotState = this.#data.captureSnapshotState();
    this.#type = normalizeBlobType(options.type ?? '');
  }

  get size(): number {
    return this.#data.size;
  }

  get type(): string {
    return this.#type;
  }

  slice(
    start?: number,
    end?: number,
    contentType?: string,
  ): BlobImpl {
    return sliceBlob(this, start, end, contentType);
  }

  stream(context: BindingContext): ReadableStreamImpl {
    return getBlobStream(this, this.#context ?? context);
  }

  text(context: BindingContext): object {
    return readBlob(
      this,
      this.#context ?? context,
      idlType.USVString,
      utf8Decode,
    );
  }

  arrayBuffer(context: BindingContext): object {
    context = this.#context ?? context;
    return readBlob(
      this,
      context,
      idlType.ArrayBuffer,
      (bytes) => createArrayBuffer(bytes, context.realm),
    );
  }

  textStream(context: BindingContext): ReadableStreamImpl {
    context = this.#context ?? context;
    const stream = getBlobStream(this, context);
    const decoder = context.construct(TextDecoderStreamImpl);
    return pipeReadableStreamThrough(
      stream,
      TextDecoderStreamImpl.getAssociatedTransform(decoder),
    );
  }

  bytes(context: BindingContext): object {
    context = this.#context ?? context;
    return readBlob(
      this,
      context,
      idlType.Uint8Array,
      (bytes) => createArrayBufferView('Uint8Array', bytes, context.realm),
    );
  }

  // -- Friends ----------------------------------------------------------

  static create(
    nativeLineEnding: NativeLineEnding,
    data: BlobData,
    type: string,
    snapshotState: BlobSnapshotState,
    context: BindingContext | null = null,
  ): BlobImpl {
    const blob = context
      ? context.construct(BlobImpl)
      : new BlobImpl(nativeLineEnding);
    blob.#data = data;
    blob.#nativeLineEnding = nativeLineEnding;
    blob.#snapshotState = snapshotState;
    blob.#type = type;
    return blob;
  }

  static getData(blob: BlobImpl): BlobData {
    return blob.#data;
  }

  static getContext(blob: BlobImpl): BindingContext | null {
    return blob.#context;
  }

  static adoptContext(
    blob: BlobImpl,
    context: BindingContext,
  ): void {
    if (blob.#context && blob.#context !== context) {
      throw new TypeError('Blob already belongs to another binding context');
    }
    blob.#context = context;
  }

  static getNativeLineEnding(blob: BlobImpl): NativeLineEnding {
    return blob.#nativeLineEnding;
  }

  static getSnapshotState(blob: BlobImpl): BlobSnapshotState {
    return blob.#snapshotState;
  }

  static getSerializationState(blob: BlobImpl): BlobSerializationState {
    return {
      data: blob.#data,
      snapshotState: blob.#snapshotState,
      type: blob.#type,
    };
  }

  static setSerializationState(
    blob: BlobImpl,
    state: BlobSerializationState,
  ): void {
    blob.#data = state.data;
    blob.#snapshotState = state.snapshotState;
    blob.#type = state.type;
  }

  static is(value: unknown): value is BlobImpl {
    return value !== null && typeof value === 'object' && #data in value;
  }
}

export type EndingType = 'transparent' | 'native';

export type BlobPropertyBag = {
  type?: string;
  endings?: EndingType;
};

export type BlobPart = BufferSource | BlobImpl | string;

export type BlobSerializationState = {
  data: BlobData;
  snapshotState: BlobSnapshotState;
  type: string;
};

/** File API §3.1, process blob parts. */
export function processBlobParts(
  parts: Iterable<BlobPart>,
  options: BlobPropertyBag,
  nativeLineEnding: NativeLineEnding,
): BlobData {
  const data: BlobData[] = [];
  for (const element of parts) {
    if (typeof element === 'string') {
      const string = options.endings === 'native'
        ? convertLineEndingsToNative(element, nativeLineEnding)
        : element;
      data.push(BlobData.fromOwnedBytes(utf8Encode(string)));
    } else if (BlobImpl.is(element)) {
      data.push(BlobImpl.getData(element));
    } else {
      data.push(BlobData.fromOwnedBytes(getBufferSourceCopy(element)));
    }
  }
  return BlobData.concatenate(data);
}

/** File API §3.1, convert line endings to native. */
export function convertLineEndingsToNative(
  value: string,
  nativeLineEnding: '\n' | '\r\n',
): string {
  return value.replace(/\r\n|\r|\n/g, nativeLineEnding);
}

/** File API §2, slice blob. */
export function sliceBlob(
  blob: BlobImpl,
  start?: number,
  end?: number,
  contentType?: string,
): BlobImpl {
  const originalSize = blob.size;
  const relativeStart = normalizeSlicePosition(start, originalSize, 0);
  const relativeEnd = normalizeSlicePosition(end, originalSize, originalSize);
  const span = Math.max(relativeEnd - relativeStart, 0);

  return BlobImpl.create(
    BlobImpl.getNativeLineEnding(blob),
    BlobImpl.getData(blob).slice(relativeStart, span),
    normalizeBlobType(contentType ?? ''),
    BlobImpl.getSnapshotState(blob),
    BlobImpl.getContext(blob),
  );
}

/** Read an exact Blob byte range for future Streams, Fetch, and XHR consumers. */
export function readBlobBytes(
  blob: BlobImpl,
  start = 0,
  length = blob.size - start,
): Promise<Uint8Array> {
  return BlobImpl.getData(blob).read(start, length);
}

/** File API §3, get stream. */
export function getBlobStream(
  blob: BlobImpl,
  context: BindingContext,
): ReadableStreamImpl {
  let canceled = false;
  const stream = createReadableStreamWithByteReadingSupport(
    context,
    undefined,
    () => { canceled = true; },
  );

  runFileStepsInParallel(context, () => { void readChunks(); });
  return stream;

  async function readChunks(): Promise<void> {
    let offset = 0;
    try {
      while (!canceled && offset < blob.size) {
        const byteLength = Math.min(blob.size - offset, blobReadChunkSize);
        const bytes = await readBlobBytes(blob, offset, byteLength);
        offset += bytes.length;
        queueFileReadingTask(context, () => {
          if (canceled) return;
          try {
            enqueueReadableStream(
              stream,
              createArrayBufferView('Uint8Array', bytes, context.realm),
            );
          } catch (error) {
            canceled = true;
            errorReadableStream(
              stream,
              context.realizeException(error),
            );
          }
        });
      }
      if (!canceled) {
        queueFileReadingTask(context, () => {
          if (!canceled) closeReadableStream(stream);
        });
      }
    } catch (error) {
      queueFileReadingTask(context, () => {
        if (canceled) return;
        canceled = true;
        errorReadableStream(
          stream,
          context.realizeException(realizeReadFailure(error)),
        );
      });
    }
  }
}

function readBlob(
  blob: BlobImpl,
  context: BindingContext,
  resultType: WebIDLType,
  transform: (bytes: Uint8Array) => unknown,
): object {
  const promise = context.createPromise(resultType);
  try {
    const reader = getReadableStreamReader(getBlobStream(blob, context));
    readAllBytes(
      reader,
      (bytes) => {
        try {
          context.resolvePromise(promise, transform(bytes));
        } catch (error) {
          context.rejectPromise(promise, error);
        }
      },
      (reason) => context.rejectPromise(promise, reason),
    );
  } catch (error) {
    context.rejectPromise(promise, error);
  }
  return promise;
}

function realizeReadFailure(error: unknown): unknown {
  if (!(error instanceof BlobReadFailure)) return error;

  const failure = error;
  const name = failure.reason === 'NotFound'
    ? domExceptionName.notFound
    : failure.reason === 'UnsafeFile' || failure.reason === 'TooManyReads'
      ? domExceptionName.security
      : domExceptionName.notReadable;
  return createDOMException(name, failure.message);
}

function normalizeSlicePosition(
  value: number | undefined,
  size: number,
  defaultValue: number,
): number {
  if (value === undefined) return defaultValue;
  return value < 0 ? Math.max(size + value, 0) : Math.min(value, size);
}

function normalizeBlobType(value: string): string {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code > 0x7e) return '';
  }
  return value.toLowerCase();
}

// -- Web IDL ------------------------------------------------------------

export const endingTypeIDL = defineEnumeration({
  name: 'EndingType',
  values: ['transparent', 'native'],
});

export const blobPropertyBagIDL = defineDictionary({
  name: 'BlobPropertyBag',
  members: [
    dictMember('type', idlType.DOMString, { default: '' }),
    dictMember('endings', reference(endingTypeIDL.name), {
      default: 'transparent',
    }),
  ],
});

export const blobPartIDL = defineTypedef({
  name: 'BlobPart',
  type: union(
    reference('BufferSource'),
    reference('Blob'),
    idlType.USVString,
  ),
});

export const blobIDL = defineInterface({
  name: 'Blob',
  exposed: ['Window', 'Worker'],
  ...xattr('Serializable'),
  implementation: bind(BlobImpl, {
    constructWith: [bindingContext],
    initializeImplementation(context, value) {
      BlobImpl.adoptContext(value as BlobImpl, context);
    },
  }),
  members: [
    ctor([
      arg('blobParts', sequence(reference(blobPartIDL.name)), {
        default: emptySequence,
        optional: true,
      }),
      arg('options', reference(blobPropertyBagIDL.name), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
    roAttr('size', idlType.unsignedLongLong),
    roAttr('type', idlType.DOMString),
    op('slice', reference('Blob'), [
      arg('start', idlType.longLong, {
        optional: true,
        ...xattr('Clamp'),
      }),
      arg('end', idlType.longLong, {
        optional: true,
        ...xattr('Clamp'),
      }),
      arg('contentType', idlType.DOMString, { optional: true }),
    ]),
    op('stream', reference('ReadableStream'), [], {
      ...invokeWith(bindingContext),
      ...xattr('NewObject'),
    }),
    op('text', promise(idlType.USVString), [], {
      ...invokeWith(bindingContext),
      ...xattr('NewObject'),
    }),
    op('arrayBuffer', promise(idlType.ArrayBuffer), [], {
      ...invokeWith(bindingContext),
      ...xattr('NewObject'),
    }),
    op('textStream', reference('ReadableStream'), [], {
      ...invokeWith(bindingContext),
      ...xattr('NewObject'),
    }),
    op('bytes', promise(idlType.Uint8Array), [], {
      ...invokeWith(bindingContext),
      ...xattr('NewObject'),
    }),
  ],
});

const blobReadChunkSize = 64 * 1024;
