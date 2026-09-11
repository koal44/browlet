import { utf8Decode, utf8Encode } from '../encoding/utf-8';
import { TextDecoderStreamImpl } from '../encoding/text-decoder-stream';
import {
  type PromiseValue, type RuntimeContext, getBufferSourceCopy,
} from '../js-engine/index';
import { domExceptionName, createDOMException } from '../web-idl/exceptions/dom-exception-core';
import { ReadableStreamImpl } from '../streams/index';
import {
  arg, atArg, contextValue, ctor, defineDictionary, defineEnumeration, defineInterface,
  defineTypedef, dictMember, emptyDictionary, emptySequence, idlType, impl, invokeWith,
  newBufferResult, op, promise, reference, roAttr, sequence, union, xattr,
} from '../web-idl/declaration/index';
import { runtimeContext, type BindingContext } from '../web-idl/projection';
import { BlobData, BlobReadFailure, type BlobSnapshotState } from './blob-data';
import {
  nativeLineEnding as nativeLineEndingCapability, type NativeLineEnding,
} from './integration';

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
  #data: BlobData;
  #snapshotState: BlobSnapshotState;
  #type: string;

  // SPEC_MISMATCH: Blob(blobParts?, options = {}) -> Blob
  constructor(
    blobParts: Iterable<BlobPart> = [],
    options: BlobPropertyBag = {},
    nativeLineEnding?: NativeLineEnding,
  ) {
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

  stream(runtime: RuntimeContext): ReadableStreamImpl {
    return getBlobStream(this, runtime);
  }

  // SPEC_MISMATCH: Blob.text() -> Promise<USVString>
  text(runtime: RuntimeContext): PromiseValue<string> {
    return readBlob(this, runtime).then(utf8Decode);
  }

  // SPEC_MISMATCH: Blob.arrayBuffer() -> Promise<ArrayBuffer>
  arrayBuffer(runtime: RuntimeContext): PromiseValue<Uint8Array> {
    return readBlob(this, runtime);
  }

  textStream(
    runtime: RuntimeContext,
  ): ReadableStreamImpl {
    const stream = getBlobStream(this, runtime);
    const decoder = new TextDecoderStreamImpl(
      'utf-8', { fatal: false, ignoreBOM: false }, runtime,
    );
    // SPEC_MISMATCH: File API pipe through(stream, decoder: TextDecoderStream) -> ReadableStream
    return stream.pipeThroughTransform(TextDecoderStreamImpl.getAssociatedTransform(decoder));
  }

  // SPEC_MISMATCH: Blob.bytes() -> Promise<Uint8Array>
  bytes(runtime: RuntimeContext): PromiseValue<Uint8Array> {
    return readBlob(this, runtime);
  }

  // -- Friends ----------------------------------------------------------

  static create(
    data: BlobData,
    type: string,
    snapshotState: BlobSnapshotState,
  ): BlobImpl {
    const blob = new BlobImpl();
    blob.#data = data;
    blob.#snapshotState = snapshotState;
    blob.#type = type;
    return blob;
  }

  static getData(blob: BlobImpl): BlobData {
    return blob.#data;
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
// SPEC_MISMATCH: (parts, options) -> bytes
export function processBlobParts(
  parts: Iterable<BlobPart>,
  options: BlobPropertyBag,
  nativeLineEnding?: NativeLineEnding,
): BlobData {
  const data: BlobData[] = [];
  for (const element of parts) {
    if (typeof element === 'string') {
      const string = options.endings === 'native'
        ? convertLineEndingsToNative(
          element,
          requireNativeLineEnding(nativeLineEnding),
        )
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
// SPEC_MISMATCH: (s) -> string
export function convertLineEndingsToNative(
  value: string,
  nativeLineEnding: '\n' | '\r\n',
): string {
  return value.replace(/\r\n|\r|\n/g, nativeLineEnding);
}

// BINDING_INTEGRATION: supply platform line-ending policy at Blob/File construction.
function getNativeLineEnding(context: BindingContext): NativeLineEnding {
  const value = context.getCapability(blobIDL, nativeLineEndingCapability);
  if (value === undefined) {
    throw new Error('Blob has no native line-ending capability');
  }
  return value;
}

function requireNativeLineEnding(
  value: NativeLineEnding | undefined,
): NativeLineEnding {
  if (value === undefined) {
    throw new Error('Native Blob line ending was not supplied');
  }
  return value;
}

export const nativeLineEndingForConstruction = contextValue(
  getNativeLineEnding,
);

/** File API §2, slice blob. */
// SPEC_MISMATCH: (blob, start: number | null, end: number | null, contentType: string | null) -> Blob
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
    BlobImpl.getData(blob).slice(relativeStart, span),
    normalizeBlobType(contentType ?? ''),
    BlobImpl.getSnapshotState(blob),
  );
}

/** Read an exact Blob byte range into fresh storage that the caller can transfer. */
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
  runtime: RuntimeContext,
): ReadableStreamImpl {
  const scheduling = runtime.fileReading;
  let canceled = false;
  const stream = ReadableStreamImpl.createWithByteReadingSupport(
    undefined,
    () => { canceled = true; },
    0,
    runtime,
  );

  // Backend I/O runs outside HTML; only the queued file tasks touch the stream.
  scheduling.runInParallel(() => { void readChunks(); });
  return stream;

  async function readChunks(): Promise<void> {
    let offset = 0;
    try {
      while (!canceled && offset < blob.size) {
        const byteLength = Math.min(blob.size - offset, blobReadChunkSize);
        const bytes = await readBlobBytes(blob, offset, byteLength);
        offset += bytes.length;
        scheduling.queueTask(() => {
          if (canceled) return;
          try {
            // Byte-stream enqueue transfers this read's storage into the stream runtime.
            stream.enqueueChunk(bytes);
          } catch (error) {
            canceled = true;
            stream.error(error);
          }
        });
      }
      if (!canceled) {
        scheduling.queueTask(() => {
          if (!canceled) stream.close();
        });
      }
    } catch (error) {
      scheduling.queueTask(() => {
        if (canceled) return;
        canceled = true;
        stream.error(realizeReadFailure(error));
      });
    }
  }
}

function readBlob(
  blob: BlobImpl,
  runtime: RuntimeContext,
): PromiseValue<Uint8Array> {
  const result = runtime.promises.withResolvers<Uint8Array>();
  const reader = getBlobStream(blob, runtime).getDefaultReader();
  // SPEC_MISMATCH: File API read all bytes(stream, reader) -> promise
  reader.readAllBytes(result.resolve, result.reject);
  return result.promise;
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
// BINDING_INTEGRATION: provide reading dependencies and project promises and fresh buffers.
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
  implementation: impl(BlobImpl, {
    constructWith: [atArg(2, nativeLineEndingForConstruction)],
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
      ...invokeWith(runtimeContext), ...xattr('NewObject'),
    }),
    op('text', promise(idlType.USVString), [], {
      ...invokeWith(
        runtimeContext,
      ),
      ...xattr('NewObject'),
    }),
    op('arrayBuffer', promise(idlType.ArrayBuffer), [], {
      ...xattr('NewObject'),
      binding: {
        ...invokeWith(runtimeContext).binding,
        ...newBufferResult().binding,
      },
    }),
    op('textStream', reference('ReadableStream'), [], {
      ...xattr('NewObject'),
      ...invokeWith(runtimeContext),
    }),
    op('bytes', promise(idlType.Uint8Array), [], {
      ...xattr('NewObject'),
      binding: {
        ...invokeWith(runtimeContext).binding,
        ...newBufferResult().binding,
      },
    }),
  ],
});

const blobReadChunkSize = 64 * 1024;
