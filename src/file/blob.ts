import { utf8Decode, utf8Encode } from '../encoding/codecs/utf-8';
import { TextDecoderStreamImpl } from '../encoding/text-decoder-stream';
import {
  type PromiseValue, type RuntimeContext, getBufferSourceCopy,
} from '../js-engine/index';
import { domExceptionName, createDOMException } from '../web-idl/exceptions/dom-exception-core';
import { ReadableStreamImpl } from '../streams/index';
import {
  arg, atArg, ctor, defineDictionary, defineEnumeration, defineInterface,
  defineTypedef, dictMember, emptyDictionary, emptySequence, idlType, impl,
  newBufferResult, op, promise, reference, roAttr, sequence, union, xattr,
} from '../web-idl/declaration/index';
import { runtimeContext } from '../web-idl/projection';
import { BlobData, BlobReadFailure, type BlobSnapshotState } from './blob-data';

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
  readonly #runtime: RuntimeContext;
  #snapshotState: BlobSnapshotState;
  #type: string;

  constructor(
    blobParts: Iterable<BlobPart> = [],
    options: BlobPropertyBag = {},
    runtime: RuntimeContext,
  ) {
    this.#runtime = runtime;
    this.#data = processBlobParts(blobParts, options, runtime);
    this.#snapshotState = this.#data.captureSnapshotState();
    this.#type = normalizeBlobType(options.type ?? '');
  }

  get size(): number {
    return this.#data.size;
  }

  get type(): string {
    return this.#type;
  }

  /** File API §2, slice blob. */
  slice(
    start?: number,
    end?: number,
    contentType?: string,
  ): BlobImpl {
    const relativeStart = normalizeSlicePosition(start, this.size, 0);
    const relativeEnd = normalizeSlicePosition(end, this.size, this.size);
    const span = Math.max(relativeEnd - relativeStart, 0);
    return BlobImpl.create(
      this.#data.slice(relativeStart, span),
      normalizeBlobType(contentType ?? ''),
      this.#snapshotState,
      this.#runtime,
    );
  }

  /** File API §3, get stream. */
  stream(): ReadableStreamImpl {
    const scheduling = this.#runtime.fileReading;
    const data = this.#data;
    let canceled = false;
    const stream = ReadableStreamImpl.createWithByteReadingSupport(
      undefined,
      () => { canceled = true; },
      0,
      this.#runtime,
    );

    // Backend awaits resume on Node's microtask queue. File-reading tasks deliver
    // bytes, completion, and failure to the stream's owning HTML event loop.
    scheduling.runInParallel(() => { void readChunks(); });
    return stream;

    // eslint-disable-next-line no-restricted-syntax -- Node schedules backing reads; queueTask controls delivery to the stream.
    async function readChunks(): Promise<void> {
      let offset = 0;
      try {
        while (!canceled && offset < data.size) {
          const byteLength = Math.min(data.size - offset, blobReadChunkSize);
          // eslint-disable-next-line no-restricted-syntax -- Resume on Node's queue before queuing the file-reading task below.
          const bytes = await data.read(offset, byteLength);
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

  text(): PromiseValue<string> {
    return this.#read().then(utf8Decode);
  }

  /** File API §3.3.4; the binding allocates the result ArrayBuffer from these bytes. */
  arrayBuffer(): PromiseValue<Uint8Array> {
    return this.#read();
  }

  /** File API §3.3.6, pipe through the decoder's associated transform. */
  textStream(): ReadableStreamImpl {
    const stream = this.stream();
    const decoder = new TextDecoderStreamImpl(
      'utf-8', { fatal: false, ignoreBOM: false }, this.#runtime,
    );
    return stream.pipeThroughTransform(decoder.getAssociatedTransform());
  }

  bytes(): PromiseValue<Uint8Array> {
    return this.#read();
  }

  /** File API §3.3.3–5, promise-based reads using Streams §9.1.2 callbacks. */
  #read(): PromiseValue<Uint8Array> {
    const result = this.#runtime.promises.withResolvers<Uint8Array>();
    const reader = this.stream().getDefaultReader();
    reader.readAllBytes(result.resolve, result.reject);
    return result.promise;
  }

  // -- Internal operations ----------------------------------------------

  get data(): BlobData {
    return this.#data;
  }

  static create(
    data: BlobData,
    type: string,
    snapshotState: BlobSnapshotState,
    runtime: RuntimeContext,
  ): BlobImpl {
    const blob = new BlobImpl([], {}, runtime);
    blob.#data = data;
    blob.#snapshotState = snapshotState;
    blob.#type = type;
    return blob;
  }

  getSerializationState(): BlobSerializationState {
    return {
      data: this.#data,
      snapshotState: this.#snapshotState,
      type: this.#type,
    };
  }

  setSerializationState(
    state: BlobSerializationState,
  ): void {
    this.#data = state.data;
    this.#snapshotState = state.snapshotState;
    this.#type = state.type;
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

/** File API §3.1, process blob parts into immutable backing segments. */
export function processBlobParts(
  parts: Iterable<BlobPart>,
  options: BlobPropertyBag,
  runtime: RuntimeContext,
): BlobData {
  const data: BlobData[] = [];
  for (const element of parts) {
    if (typeof element === 'string') {
      const string = options.endings === 'native'
        ? convertLineEndingsToNative(element, runtime)
        : element;
      data.push(BlobData.fromOwnedBytes(utf8Encode(string)));
    } else if (BlobImpl.is(element)) {
      data.push(element.data);
    } else {
      data.push(BlobData.fromOwnedBytes(getBufferSourceCopy(element)));
    }
  }
  return BlobData.concatenate(data);
}

/** File API §3.1, convert line endings to native. */
export function convertLineEndingsToNative(
  value: string,
  runtime: RuntimeContext,
): string {
  return value.replace(/\r\n|\r|\n/g, runtime.nativeLineEnding);
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
// BINDING_INTEGRATION: supply the construction runtime and project promises and fresh buffers.
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
    constructWith: [atArg(2, runtimeContext)],
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
    op('stream', reference('ReadableStream'),
      [],
      { ...xattr('NewObject') },
    ),
    op('text', promise(idlType.USVString),
      [],
      { ...xattr('NewObject') },
    ),
    op('arrayBuffer', promise(idlType.ArrayBuffer),
      [],
      { ...xattr('NewObject'), ...newBufferResult() },
    ),
    op('textStream', reference('ReadableStream'),
      [],
      { ...xattr('NewObject') },
    ),
    op('bytes', promise(idlType.Uint8Array),
      [],
      { ...xattr('NewObject'), ...newBufferResult() },
    ),
  ],
});

const blobReadChunkSize = 64 * 1024;
