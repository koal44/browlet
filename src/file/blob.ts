import { utf8Decode, utf8Encode, TextDecoderStreamImpl } from '../encoding/index';
import type { InternalPromise } from '../infra/promises';
import { lineEndingPattern } from '../infra/patterns';
import { type JSEnvironment, getBufferSourceCopy } from '../js-engine/index';
import type { ReadableStreamImpl } from '../streams/index';
import {
  arg, atArg, ctor, defineDictionary, defineEnumeration, defineInterface, defineTypedef,
  dictMember, emptyDictionary, emptySequence, idlType, impl, op, promise,
  reference, roAttr, sequence, union, xattr,
} from '../web-idl/index';
import { BlobData, type BlobSnapshotState } from './blob-data';

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
  #env: JSEnvironment;
  #snapshotState: BlobSnapshotState;
  #type: string;

  constructor(
    blobParts: Iterable<BlobPart> = [],
    options: BlobPropertyBag = {},
    env: JSEnvironment,
  ) {
    this.#env = env;
    this.#data = this.#processParts(blobParts, options);
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
      this.#env,
    );
  }

  /** File API §3, get stream. */
  stream(): ReadableStreamImpl {
    return this.#data.stream(this.#env);
  }

  // https://w3c.github.io/FileAPI/#text-method-algo
  text(): InternalPromise<string> {
    return this.#read().then(utf8Decode, undefined, idlType.USVString);
  }

  // https://w3c.github.io/FileAPI/#arraybuffer-method-algo
  /** Read into a new ArrayBuffer in the owning realm. */
  arrayBuffer(): InternalPromise<ArrayBuffer> {
    return this.#read().then((bytes) => this.#env.exec.buffers.copyArrayBuffer(bytes), undefined, idlType.ArrayBuffer);
  }

  /** File API §3.3.6, pipe through the decoder's associated transform. */
  textStream(): ReadableStreamImpl {
    const stream = this.stream();
    const decoder = new TextDecoderStreamImpl(
      'utf-8', { fatal: false, ignoreBOM: false }, this.#env,
    );
    return stream.pipeThroughTransform(decoder.getAssociatedTransform());
  }

  // https://w3c.github.io/FileAPI/#bytes-method-algo
  bytes(): InternalPromise<Uint8Array> {
    return this.#read().then((bytes) => this.#env.exec.buffers.copyUint8Array(bytes));
  }

  /** File API §3.3.3–5, promise-based reads using Streams §9.1.2 callbacks. */
  #read(): InternalPromise<Uint8Array> {
    const result = this.#env.exec.Promise.withResolvers(idlType.Uint8Array);
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
    env: JSEnvironment,
  ): BlobImpl {
    const blob = new BlobImpl([], {}, env);
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

  // File API, process blob parts: https://w3c.github.io/FileAPI/#process-blob-parts
  #processParts(parts: Iterable<BlobPart>, options: BlobPropertyBag): BlobData {
    const data: BlobData[] = [];
    for (const element of parts) {
      if (typeof element === 'string') {
        const string = options.endings === 'native'
          ? convertLineEndingsToNative(element, this.#env)
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

/** File API §3.1, convert line endings to native. */
export function convertLineEndingsToNative(
  value: string,
  env: JSEnvironment,
): string {
  return value.replace(lineEndingPattern, env.exec.nativeLineEnding);
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
    constructWith: [atArg(2, (ctx) => ctx.getEnvironment())],
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
      xattr('NewObject'),
    ),
    op('textStream', reference('ReadableStream'),
      [],
      { ...xattr('NewObject') },
    ),
    op('bytes', promise(idlType.Uint8Array),
      [],
      xattr('NewObject'),
    ),
  ],
});
