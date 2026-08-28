import { utf8Decode, utf8Encode } from '../encoding/utf-8';
import { domExceptionName, createDOMException } from '../shared/dom-exception';
import {
  closeReadableStream, enqueueReadableStream, errorReadableStream,
  createReadableStreamWithByteReadingSupport, getReadableStreamReader,
  readAllBytes, type ReadableStreamImpl,
} from '../streams/index';
import { getBufferSourceCopy } from '../web-idl/buffer-source';
import {
  arg, ctor, defineDictionary, defineEnumeration, defineInterface,
  defineTypedef, dictMember, emptyDictionary, emptySequence, idlType, impl, op,
  promise, reference, roAttr, sequence, union, withArgs, xattr,
  type WebIDLType,
} from '../web-idl/declaration/index';
import {
  BlobData, BlobReadFailure, type BlobSnapshotState,
} from './blob-data';
import {
  fileEnvironment, type BlobEnvironment, type FileEnvironment,
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
  #data: BlobData;
  #environment: BlobEnvironment;
  #fileEnvironment: FileEnvironment | null;
  #snapshotState: BlobSnapshotState;
  #type: string;

  constructor(
    environment: BlobEnvironment,
    blobParts: Iterable<BlobPart> = [],
    options: BlobPropertyBag = {},
  ) {
    this.#environment = environment;
    this.#fileEnvironment = isFileEnvironment(environment)
      ? environment
      : null;
    this.#data = processBlobParts(blobParts, options, environment);
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

  stream(environment: FileEnvironment): ReadableStreamImpl {
    return getBlobStream(this, this.#fileEnvironment ?? environment);
  }

  text(environment: FileEnvironment): object {
    return readBlob(
      this,
      this.#fileEnvironment ?? environment,
      idlType.USVString,
      utf8Decode,
    );
  }

  arrayBuffer(environment: FileEnvironment): object {
    environment = this.#fileEnvironment ?? environment;
    return readBlob(
      this,
      environment,
      idlType.ArrayBuffer,
      (bytes) => environment.createArrayBuffer(bytes),
    );
  }

  textStream(environment: FileEnvironment): ReadableStreamImpl {
    environment = this.#fileEnvironment ?? environment;
    const stream = getBlobStream(this, environment);
    const decoder = environment.createTextDecoderStream();
    return stream.pipeThrough({
      readable: decoder.readable,
      writable: decoder.writable,
    });
  }

  bytes(environment: FileEnvironment): object {
    environment = this.#fileEnvironment ?? environment;
    return readBlob(
      this,
      environment,
      idlType.Uint8Array,
      (bytes) => environment.createUint8Array(bytes),
    );
  }

  // -- Friends ----------------------------------------------------------

  static create(
    environment: BlobEnvironment,
    data: BlobData,
    type: string,
    snapshotState: BlobSnapshotState,
  ): BlobImpl {
    const blob = new BlobImpl(environment);
    blob.#data = data;
    blob.#snapshotState = snapshotState;
    blob.#type = type;
    return blob;
  }

  static getData(blob: BlobImpl): BlobData {
    return blob.#data;
  }

  static getEnvironment(blob: BlobImpl): BlobEnvironment {
    return blob.#environment;
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
  environment: BlobEnvironment,
): BlobData {
  const data: BlobData[] = [];
  for (const element of parts) {
    if (typeof element === 'string') {
      const string = options.endings === 'native'
        ? convertLineEndingsToNative(element, environment.nativeLineEnding)
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
    BlobImpl.getEnvironment(blob),
    BlobImpl.getData(blob).slice(relativeStart, span),
    normalizeBlobType(contentType ?? ''),
    BlobImpl.getSnapshotState(blob),
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
  environment: FileEnvironment,
): ReadableStreamImpl {
  let canceled = false;
  const stream = createReadableStreamWithByteReadingSupport(
    environment.streams,
    undefined,
    () => { canceled = true; },
  );

  environment.runInParallel(() => { void readChunks(); });
  return stream;

  async function readChunks(): Promise<void> {
    let offset = 0;
    try {
      while (!canceled && offset < blob.size) {
        const byteLength = Math.min(blob.size - offset, blobReadChunkSize);
        const bytes = await readBlobBytes(blob, offset, byteLength);
        offset += bytes.length;
        environment.queueFileReadingTask(() => {
          if (canceled) return;
          try {
            enqueueReadableStream(
              stream,
              environment.createUint8Array(bytes),
            );
          } catch (error) {
            canceled = true;
            errorReadableStream(
              stream,
              environment.realizeException(error),
            );
          }
        });
      }
      if (!canceled) {
        environment.queueFileReadingTask(() => {
          if (!canceled) closeReadableStream(stream);
        });
      }
    } catch (error) {
      environment.queueFileReadingTask(() => {
        if (canceled) return;
        canceled = true;
        errorReadableStream(
          stream,
          environment.realizeException(realizeReadFailure(error)),
        );
      });
    }
  }
}

function readBlob(
  blob: BlobImpl,
  environment: FileEnvironment,
  resultType: WebIDLType,
  transform: (bytes: Uint8Array) => unknown,
): object {
  const promise = environment.promises.create(resultType);
  try {
    const reader = getReadableStreamReader(getBlobStream(blob, environment));
    readAllBytes(
      reader,
      (bytes) => {
        try {
          environment.promises.resolve(promise, transform(bytes));
        } catch (error) {
          environment.promises.reject(
            promise,
            environment.realizeException(error),
          );
        }
      },
      (reason) => environment.promises.reject(promise, reason),
    );
  } catch (error) {
    environment.promises.reject(
      promise,
      environment.realizeException(error),
    );
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

function isFileEnvironment(
  environment: BlobEnvironment,
): environment is FileEnvironment {
  return 'streams' in environment;
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
  implementation: impl(BlobImpl, { withArgs: [fileEnvironment] }),
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
      ...withArgs(fileEnvironment),
      ...xattr('NewObject'),
    }),
    op('text', promise(idlType.USVString), [], {
      ...withArgs(fileEnvironment),
      ...xattr('NewObject'),
    }),
    op('arrayBuffer', promise(idlType.ArrayBuffer), [], {
      ...withArgs(fileEnvironment),
      ...xattr('NewObject'),
    }),
    op('textStream', reference('ReadableStream'), [], {
      ...withArgs(fileEnvironment),
      ...xattr('NewObject'),
    }),
    op('bytes', promise(idlType.Uint8Array), [], {
      ...withArgs(fileEnvironment),
      ...xattr('NewObject'),
    }),
  ],
});

const blobReadChunkSize = 64 * 1024;
