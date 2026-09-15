import type { BlobImpl } from '../file/index';
import { ParallelQueue } from '../infra/parallel-queue';
import {
  type GlobalObject, type RuntimeContext, getBufferSourceCopy, getBufferTypeName,
} from '../js-engine/index';
import { TypeError } from '../js-engine/exceptions';
import { ReadableStreamImpl } from '../streams/index';
import type { URLSearchParamsImpl } from '../url/api';
import {
  defineInterfaceMixin, defineTypedef, idlType, nullable, op, promise, reference, roAttr,
  union, xattr,
} from '../web-idl/index';
import type { FormDataImpl } from '../xhr/index';
import type { RequestRecord } from './request';
import type { ResponseRecord } from './response';
import { queueFetchTask } from './tasks';

/** Fetch §2.2.4: a stream and the source/length retained for replay. */
export class BodyRecord {
  stream: ReadableStreamImpl;
  source: Uint8Array | BlobImpl | FormDataImpl | null = null;
  length: number | null = null;
  // Implementation dependency for HTML task delivery, retained across clones.
  readonly #runtime: RuntimeContext;

  constructor(stream: ReadableStreamImpl, runtime: RuntimeContext) {
    this.stream = stream;
    this.#runtime = runtime;
  }

  /** Fetch §§2.2.4 and 5.2, safely extract an internal byte sequence as a body. */
  static fromBytes(bytes: Uint8Array, runtime: RuntimeContext): BodyRecord {
    const scheduling = runtime.networking;
    const stream = ReadableStreamImpl.createWithByteReadingSupport(undefined, undefined, 0, runtime);
    scheduling.runInParallel(() => {
      if (bytes.length > 0 && !stream.isErrored) {
        stream.enqueueChunk(runtime.buffers.copyUint8Array(bytes));
      }
      stream.close();
    });
    const body = new BodyRecord(stream, runtime);
    body.source = bytes;
    body.length = bytes.length;
    return body;
  }

  clone(): BodyRecord {
    const [out1, out2] = this.stream.teeWithCloning();
    this.stream = out1;
    const clone = new BodyRecord(out2, this.#runtime);
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
    const scheduling = this.#runtime.networking;
    const destination = taskDestination ?? new ParallelQueue(scheduling.runInParallel);
    const reader = this.stream.getDefaultReader();
    readLoop();

    // The next read starts inside the task that processes this chunk.
    // SPEC_MISMATCH: incrementally-read loop(reader, taskDestination, processBodyChunk, processEndOfBody, processBodyError)
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
          queueFetchTask(continueAlgorithm, destination, scheduling.queueGlobalTask);
        },
        closeSteps: () => queueFetchTask(processEndOfBody, destination, scheduling.queueGlobalTask),
        errorSteps: (error) => queueFetchTask(() => processBodyError(error), destination, scheduling.queueGlobalTask),
      });
    }
  }

  /** Fetch §2.2.4, fully read a body. */
  fullyRead(
    processBody: (bytes: Uint8Array) => void,
    processBodyError: (error?: unknown) => void,
    taskDestination: GlobalObject | ParallelQueue | null = null,
  ): void {
    const scheduling = this.#runtime.networking;
    const destination = taskDestination ?? new ParallelQueue(scheduling.runInParallel);
    const successSteps = (bytes: Uint8Array) =>
      queueFetchTask(() => processBody(bytes), destination, scheduling.queueGlobalTask);
    const errorSteps = (error?: unknown) =>
      queueFetchTask(() => processBodyError(error), destination, scheduling.queueGlobalTask);
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

export type BodyWithType = { body: BodyRecord; type: string | null; };

/**
 * Fetch §2.2.4 and RFC 9110 §8.4. The extra decoder map supplies the host's
 * supported codecs, keyed by lowercase coding names; null represents failure.
 */
// SPEC_MISMATCH: (codings, bytes) -> bytes or failure
export function handleContentCodings(
  codings: readonly string[],
  bytes: Uint8Array,
  decoders: ReadonlyMap<string, (bytes: Uint8Array) => Uint8Array>,
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
  readonly #record: RequestRecord | ResponseRecord;

  // Read the includer's current body and headers, including replacements.
  constructor(record: RequestRecord | ResponseRecord) {
    this.#record = record;
  }

  get body(): ReadableStreamImpl | null {
    return this.#bodyRecord()?.stream ?? null;
  }

  get bodyUsed(): boolean {
    const body = this.#bodyRecord();
    return body !== null && body.stream.disturbed;
  }

  get unusable(): boolean {
    const body = this.#bodyRecord();
    return body !== null && (body.stream.disturbed || body.stream.locked);
  }

  arrayBuffer(): object {
    throw new Error('Body.arrayBuffer is not implemented');
  }

  blob(): object {
    throw new Error('Body.blob is not implemented');
  }

  bytes(): object {
    throw new Error('Body.bytes is not implemented');
  }

  formData(): object {
    throw new Error('Body.formData is not implemented');
  }

  json(): object {
    throw new Error('Body.json is not implemented');
  }

  text(): object {
    throw new Error('Body.text is not implemented');
  }

  textStream(): ReadableStreamImpl {
    throw new Error('Body.textStream is not implemented');
  }

  #bodyRecord(): BodyRecord | null {
    const body = this.#record.body;
    if (body !== null && !(body instanceof BodyRecord)) {
      throw new Error('Fetch request body bytes must be extracted before API use');
    }
    return body;
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
    op('arrayBuffer', promise(idlType.ArrayBuffer), [], xattr('NewObject')),
    op('blob', promise(reference('Blob')), [], xattr('NewObject')),
    op('bytes', promise(idlType.Uint8Array), [], xattr('NewObject')),
    op('formData', promise(reference('FormData')), [], xattr('NewObject')),
    op('json', promise(idlType.any), [], xattr('NewObject')),
    op('text', promise(idlType.USVString), [], xattr('NewObject')),
    op('textStream', reference('ReadableStream'), [], xattr('NewObject')),
  ],
});
