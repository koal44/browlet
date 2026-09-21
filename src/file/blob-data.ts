import type { RuntimeContext } from '../js-engine/index';
import { ReadableStreamImpl } from '../streams/index';
import { DOMExceptionNames, createDOMException } from '../web-idl/index';
import { InternalError } from '../infra/internal-error';

/*
 * Immutable backing data for File API Blob objects.
 *
 * In-memory bytes are copied before becoming a source. Composed Blob data and
 * slices share these source objects through bounded segment views; neither
 * operation creates a recursive chain of Blob reads.
 */
export class BlobData {
  #segments: BlobSegment[];
  #size: number;

  private constructor(segments: BlobSegment[]) {
    this.#segments = segments;
    this.#size = 0;
    for (const segment of segments) {
      if (segment.length > Number.MAX_SAFE_INTEGER - this.#size) {
        throw new InternalError('Blob byte length exceeds JavaScript integer precision');
      }
      this.#size += segment.length;
    }
  }

  get size(): number {
    return this.#size;
  }

  static empty(): BlobData {
    return new BlobData([]);
  }

  static fromBytes(bytes: Uint8Array): BlobData {
    return BlobData.fromOwnedBytes(bytes.slice());
  }

  /** Accept bytes whose ownership has already been transferred to Blob data. */
  static fromOwnedBytes(bytes: Uint8Array): BlobData {
    if (bytes.length === 0) return BlobData.empty();
    const source = new MemoryBlobByteSource(bytes);
    return new BlobData([{ source, start: 0, length: source.size }]);
  }

  /** Capture a host source whose size and snapshot are already fixed. */
  static fromSource(source: BlobByteSource): BlobData {
    const size = source.size;
    requireRange(size, 0, size);
    return size === 0
      ? BlobData.empty()
      : new BlobData([{ source, start: 0, length: size }]);
  }

  static concatenate(parts: Iterable<BlobData>): BlobData {
    const segments: BlobSegment[] = [];
    for (const part of parts) segments.push(...part.#segments);
    return new BlobData(segments);
  }

  slice(start: number, length: number): BlobData {
    requireRange(this.#size, start, length);
    if (length === 0) return BlobData.empty();

    const end = start + length;
    const segments: BlobSegment[] = [];
    let position = 0;

    for (const segment of this.#segments) {
      const segmentEnd = position + segment.length;
      const overlapStart = Math.max(start, position);
      const overlapEnd = Math.min(end, segmentEnd);
      if (overlapStart < overlapEnd) {
        segments.push({
          source: segment.source,
          start: segment.start + overlapStart - position,
          length: overlapEnd - overlapStart,
        });
      }
      if (segmentEnd >= end) break;
      position = segmentEnd;
    }
    return new BlobData(segments);
  }

  /** Stream retained Blob data, including multipart data, without an intermediate Blob object. */
  // File API's get stream algorithm, shared with Fetch's multipart body extraction.
  // https://w3c.github.io/FileAPI/#dfn-get-stream
  stream(runtime: RuntimeContext): ReadableStreamImpl {
    const scheduling = runtime.fileReading;
    let canceled = false;
    const stream = ReadableStreamImpl.createWithByteReadingSupport(
      undefined, () => { canceled = true; }, 0, runtime,
    );

    // Backend awaits resume on Node's microtask queue. File-reading tasks deliver
    // bytes, completion, and failure to the stream's owning HTML event loop.
    // eslint-disable-next-line no-restricted-syntax -- Node schedules backing reads; queueTask controls delivery to the stream.
    const readChunks = async (): Promise<void> => {
      let offset = 0;
      try {
        while (!canceled && offset < this.size) {
          const byteLength = Math.min(this.size - offset, blobReadChunkSize);
          // eslint-disable-next-line no-restricted-syntax -- Resume on Node's queue before queuing the file-reading task below.
          const bytes = await this.read(offset, byteLength);
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
    };
    runtime.runInParallel(() => { void readChunks(); });
    return stream;
  }

  // eslint-disable-next-line no-restricted-syntax -- Backing I/O uses Node's queue; Blob.stream() queues delivery to the owning runtime.
  async read(start = 0, length = this.#size - start): Promise<Uint8Array> {
    requireRange(this.#size, start, length);
    const bytes = new Uint8Array(length);
    if (length === 0) return bytes;

    const end = start + length;
    let position = 0;
    let writeOffset = 0;

    for (const segment of this.#segments) {
      const segmentEnd = position + segment.length;
      const overlapStart = Math.max(start, position);
      const overlapEnd = Math.min(end, segmentEnd);
      if (overlapStart < overlapEnd) {
        const sourceStart = segment.start + overlapStart - position;
        const sourceLength = overlapEnd - overlapStart;
        // eslint-disable-next-line no-restricted-syntax -- Byte assembly stays on Node's queue without updating platform state.
        const chunk = await segment.source.read(sourceStart, sourceLength);
        if (chunk.length !== sourceLength) {
          throw new InternalError(
            'A Blob byte source must return the complete requested range',
          );
        }
        bytes.set(chunk, writeOffset);
        writeOffset += chunk.length;
      }
      if (segmentEnd >= end) break;
      position = segmentEnd;
    }
    return bytes;
  }

  captureSnapshotState(): BlobSnapshotState {
    const states = new Set<unknown>();
    for (const segment of this.#segments) {
      if (segment.source.snapshotState !== undefined) {
        states.add(segment.source.snapshotState);
      }
    }
    if (states.size === 0) return;
    if (states.size === 1) return states.values().next().value;
    return Object.freeze([...states]);
  }

  /** Retain only byte sources which can safely outlive the current agent. */
  cloneForStorage(): BlobData {
    const segments: BlobSegment[] = [];
    for (const segment of this.#segments) {
      const source = segment.source.cloneForStorage?.(
        segment.start,
        segment.length,
      );
      if (!source || source.size !== segment.length) {
        throw new InternalError(
          'The Blob byte source cannot be serialized for storage',
        );
      }
      segments.push({ source, start: 0, length: source.size });
    }
    return new BlobData(segments);
  }
}

/** Host-neutral source for a stable, exactly sized Blob byte sequence. */
export type BlobByteSource = {
  get size(): number;
  get snapshotState(): BlobSnapshotState;
  cloneForStorage?(start: number, length: number): BlobByteSource;
  read(start: number, length: number): Promise<Uint8Array>;
};

export type BlobSnapshotState = unknown;

export type BlobReadFailureReason =
  | 'NotFound'
  | 'UnsafeFile'
  | 'TooManyReads'
  | 'SnapshotState'
  | 'FileLock';

/** A semantic File API failure; Browlet maps it to a realm DOMException. */
// eslint-disable-next-line no-restricted-globals -- A backing read failure is translated to a File API DOMException, not an implementation failure.
export class BlobReadFailure extends Error {
  constructor(
    public reason: BlobReadFailureReason,
    message = `Blob read failed: ${reason}`,
  ) {
    super(message);
    this.name = 'BlobReadFailure';
  }
}

type BlobSegment = {
  source: BlobByteSource;
  start: number;
  length: number;
};

class MemoryBlobByteSource implements BlobByteSource {
  #bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  get size(): number {
    return this.#bytes.length;
  }

  get snapshotState(): undefined {
    return;
  }

  cloneForStorage(start: number, length: number): BlobByteSource {
    requireRange(this.size, start, length);
    return new MemoryBlobByteSource(this.#bytes.slice(start, start + length));
  }

  read(start: number, length: number): Promise<Uint8Array> {
    requireRange(this.size, start, length);
    // BlobData.read copies this immutable backing range into its result.
    // eslint-disable-next-line no-restricted-globals -- Memory reads share the native Promise contract of asynchronous backing sources.
    return Promise.resolve(this.#bytes.subarray(start, start + length));
  }
}

function requireRange(size: number, start: number, length: number): void {
  if (
    !Number.isSafeInteger(size) || size < 0 ||
    !Number.isSafeInteger(start) || start < 0 ||
    !Number.isSafeInteger(length) || length < 0 ||
    start > size - length
  ) {
    throw new InternalError('Blob byte range is outside the source');
  }
}

function realizeReadFailure(error: unknown): unknown {
  if (!(error instanceof BlobReadFailure)) return error;

  const failure = error;
  const name = failure.reason === 'NotFound'
    ? DOMExceptionNames.notFound
    : failure.reason === 'UnsafeFile' || failure.reason === 'TooManyReads'
      ? DOMExceptionNames.security
      : DOMExceptionNames.notReadable;
  return createDOMException(name, failure.message);
}

const blobReadChunkSize = 64 * 1024;
