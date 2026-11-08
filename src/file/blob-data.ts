import { InternalError } from '../infra/internal-error';
import { TypeError } from '../infra/exceptions';
import { markAsUncloneable } from '../js-engine/index';
import { DOMExceptionImpl, DOMExceptionNames } from '../web-idl/core/index';
import { ReadableStreamImpl, type StreamsEnvironment } from '../streams/index';

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

  static empty(): BlobData {
    return new BlobData([]);
  }

  /** Allocate and copy the supplied bytes into independent Blob storage. */
  static fromBytes(bytes: Uint8Array): BlobData {
    // Host Buffers are Uint8Arrays too, but their slice() retains shared memory.
    return BlobData.fromOwnedBytes(new Uint8Array(bytes));
  }

  /** Retain the supplied storage without copying; the caller must stop mutating or transferring it. */
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

  /** Rebuild byte-source behavior in the receiving isolate from File API's internal record. */
  static deserialize(record: SerializedBlobData): BlobData {
    return new BlobData(record.map((segment): BlobSegment => segment.kind === 'bytes'
      ? { source: new MemoryBlobByteSource(segment.bytes), start: 0, length: segment.bytes.length }
      : { source: segment.source, start: segment.start, length: segment.length }));
  }

  static concatenate(parts: Iterable<BlobData>): BlobData {
    const segments: BlobSegment[] = [];
    for (const part of parts) segments.push(...part.#segments);
    return new BlobData(segments);
  }

  get size(): number {
    return this.#size;
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
  stream(env: StreamsEnvironment): ReadableStreamImpl {
    let canceled = false;
    const stream = ReadableStreamImpl.createWithByteReadingSupport(
      undefined, () => { canceled = true; }, 0, env,
    );
    // SPEC_GAP(body-production-discard): File API omits stream completion when its global is destroyed.
    // SPEC_CLASH(body-production-destruction): Firefox completes retained Blob streams;
    // Chromium/WebKit stop production differently. Fail once and ignore late backing results.
    const discard = (): void => {
      if (canceled) return;
      canceled = true;
      stream.error(new TypeError('Blob data production was discarded'));
    };
    const removeDestructionSteps = env.addDestructionSteps(discard);
    stream.onCompletion(removeDestructionSteps, removeDestructionSteps);

    // Backend awaits resume on Node's microtask queue. File-reading tasks deliver
    // bytes, completion, and failure to the stream's owning HTML event loop.
    // TODO(File backing I/O): Interrupting an in-flight read also needs its host source's cancellation.
    // Destruction settles the stream now; the eventual backing result is ignored.
    // eslint-disable-next-line no-restricted-syntax -- Node schedules backing reads; queueTask controls delivery to the stream.
    const readChunks = async (): Promise<void> => {
      let offset = 0;
      try {
        while (!canceled && offset < this.size) {
          const byteLength = Math.min(this.size - offset, blobReadChunkSize);
          // eslint-disable-next-line no-restricted-syntax -- Resume on Node's queue before queuing the file-reading task below.
          const bytes = await this.read(offset, byteLength);
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Cancellation or discard can run during the backing read.
          if (canceled) return;
          offset += bytes.length;
          env.queueTask('file', {
            run: () => {
              if (canceled) return;
              try {
                // Byte-stream enqueue transfers this read's storage into the stream runtime.
                stream.enqueueChunk(bytes);
              } catch (error) {
                canceled = true;
                stream.error(error);
              }
            },
            discard,
          });
        }
        if (!canceled) {
          env.queueTask('file', {
            run: () => {
              if (canceled) return;
              // Production is finished even when the consumer has not drained buffered bytes.
              removeDestructionSteps();
              stream.close();
            },
            discard,
          });
        }
      } catch (error) {
        if (canceled) return;
        env.queueTask('file', {
          run: () => {
            if (canceled) return;
            canceled = true;
            stream.error(error instanceof BlobReadFailure ? error.toDOMException() : error);
          },
          discard,
        });
      }
    };
    env.runInParallel(() => { void readChunks(); });
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

  /** Copy all retained segments without scheduling tasks or Promise reactions. */
  readSync(): Uint8Array {
    const bytes = new Uint8Array(this.#size);
    let offset = 0;
    for (const { source, start, length } of this.#segments) {
      // TODO(File API): Host-selected files must supply synchronous backing I/O.
      // Waiting on read() here would block the very queue needed to complete it.
      if (source.readSync === undefined) {
        throw new InternalError('The Blob byte source does not support synchronous reads');
      }
      const chunk = source.readSync(start, length);
      if (chunk.length !== length) {
        throw new InternalError('A Blob byte source must return the complete requested range');
      }
      bytes.set(chunk, offset);
      offset += length;
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

  /** Serialize memory segments as bytes, keeping host-backed sources explicitly local. */
  serialize(): SerializedBlobData {
    return this.#segments.map(({ source, start, length }): SerializedBlobSegment => {
      if (source instanceof MemoryBlobByteSource) {
        return { kind: 'bytes', bytes: source.serialize(start, length) };
      }
      const segment: SerializedBlobSegment = { kind: 'source', source, start, length };
      // TODO(File API): Host-selected files need portable backing descriptors before
      // crossing isolates. Preserve local lazy reads, but reject native transport
      // instead of silently replacing a source's private state with an empty object.
      markAsUncloneable(segment);
      return segment;
    });
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
  /** Read the same immutable range synchronously, when the backing host supports it. */
  readSync?(start: number, length: number): Uint8Array;
};

/**
 * Source-defined snapshot of underlying storage, preserved without interpretation.
 * Memory sources use undefined. The unknown type does not guarantee cloneability:
 * cross-isolate sources must supply a cloneable snapshot as well as portable backing.
 */
export type BlobSnapshotState = unknown;

/** Memory bytes travel through native cloning; same-isolate host sources retain their lazy reads. */
export type SerializedBlobData = SerializedBlobSegment[];

/** One immutable byte range, either portable bytes or a local host source. */
type SerializedBlobSegment =
  { kind: 'bytes'; bytes: Uint8Array; } |
  {
    kind: 'source';
    /** Same-isolate source identity, preserving deferred I/O and snapshot failures. */
    source: BlobByteSource;
    start: number;
    length: number;
  };

export type BlobReadFailureReason =
  | 'NotFound'
  | 'UnsafeFile'
  | 'TooManyReads'
  | 'SnapshotState'
  | 'FileLock';

/** A backing-source failure which File API readers map to a DOMException. */
// eslint-disable-next-line no-restricted-globals -- A backing read failure is translated to a File API DOMException, not an implementation failure.
export class BlobReadFailure extends Error {
  constructor(
    public reason: BlobReadFailureReason,
    message = `Blob read failed: ${reason}`,
  ) {
    super(message);
    this.name = 'BlobReadFailure';
  }

  /** Map the source's failure category to File API's public exception. */
  toDOMException(): DOMExceptionImpl {
    const name = this.reason === 'NotFound'
      ? DOMExceptionNames.notFound
      : this.reason === 'UnsafeFile' || this.reason === 'TooManyReads'
        ? DOMExceptionNames.security
        : DOMExceptionNames.notReadable;
    return new DOMExceptionImpl(this.message, name);
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

  /** Retain an internal immutable view; native transport copies its bytes for another isolate. */
  serialize(start: number, length: number): Uint8Array {
    return this.#bytes.subarray(start, start + length);
  }

  cloneForStorage(start: number, length: number): BlobByteSource {
    requireRange(this.size, start, length);
    return new MemoryBlobByteSource(this.#bytes.slice(start, start + length));
  }

  read(start: number, length: number): Promise<Uint8Array> {
    // eslint-disable-next-line no-restricted-globals -- Memory reads share the native Promise contract of asynchronous backing sources.
    return Promise.resolve(this.readSync(start, length));
  }

  /** Return an immutable view which BlobData copies before exposing the result. */
  readSync(start: number, length: number): Uint8Array {
    requireRange(this.size, start, length);
    return this.#bytes.subarray(start, start + length);
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

const blobReadChunkSize = 64 * 1024;
