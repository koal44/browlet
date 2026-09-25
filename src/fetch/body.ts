import { utf8Decode, utf8Encode, TextDecoderStreamImpl } from '../encoding/index';
import { BlobData, BlobImpl } from '../file/index';
import { ParallelQueue } from '../infra/parallel-queue';
import {
  type GlobalObject, type JSEnvironment, getBufferSourceCopy, getBufferTypeName,
} from '../js-engine/index';
import type { PromiseValue } from '../infra/promises';
import { TypeError } from '../infra/exceptions';
import { serializeMIMEType } from '../mime/index';
import { ReadableStreamImpl } from '../streams/index';
import { URLSearchParamsImpl, parseFormUrlEncoded } from '../url/index';
import {
  allocateIn, defineInterfaceMixin, defineTypedef, idlType, nullable, op, promise, reference, roAttr,
  union, xattr,
} from '../web-idl/index';
import { FormDataImpl, type FormDataEntry } from '../xhr/index';
import { encodeMultipartFormData } from './multipart/encode';
import { parseMultipartFormData } from './multipart/parse';
import type { FetchRequest } from './request';
import type { FetchResponse } from './response';
import { queueFetchTask } from './tasks';
import { InternalError } from '../infra/internal-error';

/** Fetch §2.2.4: a stream and the source/length retained for replay. */
export class FetchBody {
  /** Stream supplying the body bytes; cloning replaces it with one branch of a tee. */
  stream: ReadableStreamImpl;
  /** Retained replay source, including encoded multipart data; null for a stream-only body. */
  source: Uint8Array | BlobImpl | BlobData | null = null;
  /** Total body length in bytes, or null when unknown; this is not a count of remaining bytes. */
  length: number | null = null;
  /** Owning environment shared by this body and its clones. */
  #env: JSEnvironment;

  constructor(stream: ReadableStreamImpl, env: JSEnvironment) {
    this.stream = stream;
    this.#env = env;
  }

  /** Fetch §§2.2.4 and 5.2, safely extract an internal byte sequence as a body. */
  static fromBytes(bytes: Uint8Array, env: JSEnvironment): FetchBody {
    const stream = ReadableStreamImpl.createWithByteReadingSupport(undefined, undefined, 0, env);
    // The bytes are already available; only delivery to the owning loop is deferred.
    // https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-for-spec-authors
    queueFetchTask(() => {
      if (bytes.length > 0 && !stream.isErrored) {
        stream.enqueueChunk(env.exec.buffers.copyUint8Array(bytes));
      }
      stream.close();
    }, env.exec.global, env);
    const body = new FetchBody(stream, env);
    body.source = bytes;
    body.length = bytes.length;
    return body;
  }

  /** Create a fresh stream over a retained replay source without repeating body encoding. */
  static fromSource(source: NonNullable<FetchBody['source']>, env: JSEnvironment): FetchBody {
    if (source instanceof BlobImpl || source instanceof BlobData) {
      const data = source instanceof BlobImpl ? source.data : source;
      const body = new FetchBody(data.stream(env), env);
      body.source = source;
      body.length = data.size;
      return body;
    }
    return FetchBody.fromBytes(source, env);
  }

  /** Extract a converted BodyInit value, retaining its replay source and inferred Content-Type. */
  // https://fetch.spec.whatwg.org/#concept-bodyinit-extract
  // Internal byte sequences use fromBytes(); a BodyInit BufferSource must be copied.
  static extract(object: BodyInitValue, keepalive = false, env: JSEnvironment): BodyWithType {
    if (object instanceof ReadableStreamImpl) {
      if (keepalive) throw new TypeError('A keepalive request cannot have a streaming body');
      if (object.disturbed || object.locked) throw new TypeError('Body stream is disturbed or locked');
      return { body: new FetchBody(object, env), type: null };
    }
    if (object instanceof BlobImpl) {
      // The new body stream belongs to Fetch's environment, not the Blob creator.
      return { body: FetchBody.fromSource(object, env), type: object.type || null };
    }
    if (object instanceof FormDataImpl) {
      const { boundary, data } = encodeMultipartFormData(object.getEntryList(), 'UTF-8');
      // SPEC_CLASH(multipart-redirect-replay): the draft retains live FormData; browsers retain the encoded upload.
      // Retain the existing data so redirects preserve the boundary and captured entries.
      // File segments stay shared; replay creates a stream without re-encoding or flattening them.
      return { body: FetchBody.fromSource(data, env), type: `multipart/form-data; boundary=${boundary}` };
    }
    if (object instanceof URLSearchParamsImpl) {
      return {
        body: FetchBody.fromBytes(utf8Encode(object.toString()), env),
        type: 'application/x-www-form-urlencoded;charset=UTF-8',
      };
    }
    if (typeof object === 'string') {
      return { body: FetchBody.fromBytes(utf8Encode(object), env), type: 'text/plain;charset=UTF-8' };
    }
    return { body: FetchBody.fromBytes(getBufferSourceCopy(object), env), type: null };
  }

  clone(): FetchBody {
    const [out1, out2] = this.stream.teeWithCloning();
    this.stream = out1;
    const clone = new FetchBody(out2, this.#env);
    clone.source = this.source;
    clone.length = this.length;
    return clone;
  }

  /** Fetch §2.2.4, incrementally read a body. */
  incrementallyRead(
    processBodyChunk: (bytes: Uint8Array) => void,
    processEndOfBody: () => void,
    processBodyError: (error: unknown) => void,
    taskDestination: GlobalObject | ParallelQueue | null = null,
  ): void {
    const env = this.#env;
    const destination = taskDestination ?? new ParallelQueue(env.exec.runInParallel);
    const reader = this.stream.getDefaultReader();
    readLoop();

    // The next read starts inside the task that processes this chunk.
    function readLoop(): void {
      reader.readChunk({
        chunkSteps(chunk) {
          let continueAlgorithm: () => void;
          if (typeof chunk !== 'object' || chunk === null || getBufferTypeName(chunk) !== 'Uint8Array') {
            continueAlgorithm = () => processBodyError(new TypeError('Body stream produced a non-Uint8Array chunk'));
          } else {
            const bytes = getBufferSourceCopy(chunk);
            continueAlgorithm = () => {
              processBodyChunk(bytes);
              readLoop();
            };
          }
          queueFetchTask(continueAlgorithm, destination, env);
        },
        closeSteps: () => queueFetchTask(processEndOfBody, destination, env),
        errorSteps: (error) => queueFetchTask(() => processBodyError(error), destination, env),
      });
    }
  }

  /** Fetch §2.2.4, fully read a body. */
  fullyRead(
    processBody: (bytes: Uint8Array<ArrayBuffer>) => void,
    processBodyError: (error?: unknown) => void,
    taskDestination: GlobalObject | ParallelQueue | null = null,
  ): void {
    const env = this.#env;
    const destination = taskDestination ?? new ParallelQueue(env.exec.runInParallel);
    const successSteps = (bytes: Uint8Array<ArrayBuffer>) =>
      queueFetchTask(() => processBody(bytes), destination, env);
    const errorSteps = (error?: unknown) =>
      queueFetchTask(() => processBodyError(error), destination, env);
    let reader: ReturnType<ReadableStreamImpl['getDefaultReader']>;
    try {
      reader = this.stream.getDefaultReader();
    } catch (error) {
      errorSteps(error);
      return;
    }
    reader.readAllBytes(successSteps, errorSteps);
  }
}

export type BodyWithType = {
  /** Body extracted from the supplied input. */
  body: FetchBody;
  /** Inferred Content-Type value, or null when extraction supplies none. */
  type: string | null;
};

/**
 * Fetch §2.2.4 and RFC 9110 §8.4. The extra decoder map supplies the host's
 * supported codecs, keyed by lowercase coding names; null represents failure.
 */
// Network fetch uses the UserAgent's per-response HTTPContentDecoder instead.
// This complete-buffer algorithm must not be applied independently to wire chunks.
// SPEC_MISMATCH: (codings, bytes) -> bytes or failure
export function handleContentCodings(
  codings: string[],
  bytes: Uint8Array,
  decoders: Map<string, (bytes: Uint8Array) => Uint8Array>,
): Uint8Array | null {
  const selected = codings.map((coding) => decoders.get(coding.toLowerCase()));
  if (selected.some((decode) => decode === undefined)) return bytes;
  try {
    for (let index = selected.length - 1; index >= 0; index--) {
      bytes = selected[index]!(bytes);
    }
    return bytes;
  } catch {
    return null;
  }
}

/*
 * typedef (Blob or BufferSource or FormData or URLSearchParams or USVString) XMLHttpRequestBodyInit;
 *
 * typedef (ReadableStream or XMLHttpRequestBodyInit) BodyInit;
 *
 * interface mixin Body {
 *   readonly attribute ReadableStream? body;
 *   readonly attribute boolean bodyUsed;
 *   [NewObject] Promise<ArrayBuffer> arrayBuffer();
 *   [NewObject] Promise<Blob> blob();
 *   [NewObject] Promise<Uint8Array> bytes();
 *   [NewObject] Promise<FormData> formData();
 *   [NewObject] Promise<any> json();
 *   [NewObject] Promise<USVString> text();
 *   [NewObject] ReadableStream textStream();
 * };
 */
export class BodyMixin {
  /** Includer's live request or response, so body and header replacements remain visible. */
  #record: FetchRequest | FetchResponse;
  /** Environment owning body consumption, result allocation, and promise delivery. */
  #env: JSEnvironment;

  // Read the includer's current body and headers, including replacements.
  constructor(record: FetchRequest | FetchResponse, env: JSEnvironment) {
    this.#record = record;
    this.#env = env;
  }

  // https://fetch.spec.whatwg.org/#dom-body-body
  get body(): ReadableStreamImpl | null {
    return this.getBody()?.stream ?? null;
  }

  // https://fetch.spec.whatwg.org/#dom-body-bodyused
  get bodyUsed(): boolean {
    const body = this.getBody();
    return body !== null && body.stream.disturbed;
  }

  // https://fetch.spec.whatwg.org/#body-unusable
  get unusable(): boolean {
    const body = this.getBody();
    return body !== null && (body.stream.disturbed || body.stream.locked);
  }

  // https://fetch.spec.whatwg.org/#dom-body-arraybuffer
  // The binding allocates the ArrayBuffer from these bytes in the receiver realm.
  arrayBuffer(): PromiseValue<Uint8Array> {
    return this.#consume((bytes) => bytes);
  }

  // https://fetch.spec.whatwg.org/#dom-body-blob
  blob(): PromiseValue<BlobImpl> {
    return this.#consume((bytes) => {
      const type = this.#record.headerList.extractMIMEType();
      const data = BlobData.fromOwnedBytes(bytes);
      return BlobImpl.create(data, type === null ? '' : serializeMIMEType(type), undefined, this.#env);
    });
  }

  // https://fetch.spec.whatwg.org/#dom-body-bytes
  bytes(): PromiseValue<Uint8Array> {
    return this.#consume((bytes) => bytes);
  }

  // https://fetch.spec.whatwg.org/#dom-body-formdata
  formData(): PromiseValue<FormDataImpl> {
    return this.#consume((bytes) => {
      const type = this.#record.headerList.extractMIMEType();
      if (type?.type === 'multipart' && type.subtype === 'form-data') {
        return FormDataImpl.fromEntries(
          parseMultipartFormData(bytes, type, this.#env), this.#env,
        );
      }
      if (type?.type === 'application' && type.subtype === 'x-www-form-urlencoded') {
        // URL's parser UTF-8-decodes both strings, so they are already scalar values.
        const entries = parseFormUrlEncoded(bytes) as FormDataEntry[];
        return FormDataImpl.fromEntries(entries, this.#env);
      }
      throw new TypeError('Body Content-Type is not multipart/form-data or application/x-www-form-urlencoded');
    });
  }

  // https://fetch.spec.whatwg.org/#dom-body-json
  // https://infra.spec.whatwg.org/#parse-json-bytes-to-a-javascript-value
  json(): PromiseValue<unknown> {
    return this.#consume((bytes) => this.#env.exec.parseJSON(utf8Decode(bytes)));
  }

  // https://fetch.spec.whatwg.org/#dom-body-text
  text(): PromiseValue<string> {
    return this.#consume(utf8Decode);
  }

  // https://fetch.spec.whatwg.org/#dom-body-textstream
  textStream(): ReadableStreamImpl {
    if (this.unusable) throw new TypeError('Body is disturbed or locked');
    const body = this.getBody();
    if (body === null) {
      const stream = ReadableStreamImpl.createDefault(undefined, undefined, 1, () => 1, this.#env);
      stream.close();
      return stream;
    }
    const decoder = new TextDecoderStreamImpl(
      'utf-8', { fatal: false, ignoreBOM: false }, this.#env,
    );
    return body.stream.pipeThroughTransform(decoder.getAssociatedTransform());
  }

  // -- Internal ---------------------------------------------------------

  /** The extracted body shared by the API and its underlying request or response. */
  getBody(): FetchBody | null {
    const body = this.#record.body;
    if (body !== null && !(body instanceof FetchBody)) {
      throw new InternalError('Fetch request body bytes must be extracted before API use');
    }
    return body;
  }

  // https://fetch.spec.whatwg.org/#concept-body-consume-body
  #consume<Result>(convert: (bytes: Uint8Array<ArrayBuffer>) => Result): PromiseValue<Result> {
    const { promises } = this.#env.exec;
    if (this.unusable) return promises.reject(new TypeError('Body is disturbed or locked'));
    const result = promises.withResolvers<Result>();
    const success = (bytes: Uint8Array<ArrayBuffer>) => {
      try {
        result.resolve(convert(bytes));
      } catch (error) {
        result.reject(error);
      }
    };
    const body = this.getBody();
    if (body === null) success(new Uint8Array());
    else body.fullyRead(success, result.reject, this.#env.exec.global);
    return result.promise;
  }
}

/** Post-conversion BufferSource objects are retained by Web IDL. */
export type XMLHttpRequestBodyInitValue = BlobImpl | FormDataImpl | URLSearchParamsImpl |
  ArrayBuffer | ArrayBufferView | string;

export type BodyInitValue = ReadableStreamImpl | XMLHttpRequestBodyInitValue;

// -- Web IDL ------------------------------------------------------------

export const xmlHttpRequestBodyInitIDL = defineTypedef({
  name: 'XMLHttpRequestBodyInit',
  type: union(reference('Blob'), reference('BufferSource'), reference('FormData'),
    reference('URLSearchParams'), idlType.USVString),
});

export const bodyInitIDL = defineTypedef({
  name: 'BodyInit',
  type: union(reference('ReadableStream'), reference('XMLHttpRequestBodyInit')),
});

export const bodyIDL = defineInterfaceMixin({
  name: 'Body',
  members: [
    roAttr('body', nullable(reference('ReadableStream'))),
    roAttr('bodyUsed', idlType.boolean),
    op('arrayBuffer', promise(idlType.ArrayBuffer), [], { ...xattr('NewObject'), ...allocateIn('receiver') }),
    op('blob', promise(reference('Blob')), [], xattr('NewObject')),
    op('bytes', promise(idlType.Uint8Array), [], { ...xattr('NewObject'), ...allocateIn('receiver') }),
    op('formData', promise(reference('FormData')), [], xattr('NewObject')),
    op('json', promise(idlType.any), [], xattr('NewObject')),
    op('text', promise(idlType.USVString), [], xattr('NewObject')),
    op('textStream', reference('ReadableStream'), [], xattr('NewObject')),
  ],
});
