import { RangeError, TypeError } from './exceptions';

/**
 * An incremental byte cursor with direct access to each original input chunk.
 * Append does not copy bytes; callers must keep supplied buffers immutable.
 * Consumers may retain subarray views after advancing past their source chunk.
 */
export class ByteCursor {
  /** Current readable chunk; the usual append/drain path needs no queue node. */
  #chunk: Uint8Array = emptyChunk;
  /** Next unread byte in the current chunk. */
  #position = 0;
  /** Chunks supplied while the current one still has unread bytes. */
  #head?: ByteChunk;
  #tail?: ByteChunk;
  /** Producer completion is independent of consuming the remaining input. */
  #finished = false;

  /** Original contiguous input; an empty view means there are no readable bytes. */
  get chunk(): Uint8Array { return this.#chunk; }

  /** Index within chunk, changed only through advance(). */
  get position(): number { return this.#position; }

  /** Append at the tail without disturbing unread bytes or the current position. */
  appendData(chunk: Uint8Array): void {
    if (this.#finished) throw new TypeError('Cannot append data after finishing the byte cursor');
    if (chunk.length === 0) return;
    if (this.#chunk.length === 0) {
      this.#chunk = chunk;
      return;
    }
    const node: ByteChunk = { chunk };
    if (this.#tail) this.#tail.next = node;
    else this.#head = node;
    this.#tail = node;
  }

  /** Look ahead from position across queued chunks without consuming input. */
  peek(offset = 0): number | InputBoundary {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError('Invalid byte lookahead');
    const available = this.#chunk.length - this.#position;
    if (offset < available) return this.#chunk[this.#position + offset]!;
    offset -= available;
    for (let node = this.#head; node; node = node.next) {
      if (offset < node.chunk.length) return node.chunk[offset]!;
      offset -= node.chunk.length;
    }
    return this.#finished ? InputBoundary.End : InputBoundary.Waiting;
  }

  /** Consume within chunk; exhausting it selects the next queued chunk immediately. */
  advance(count = 1): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.#chunk.length - this.#position) {
      throw new RangeError('Advance exceeds the current byte chunk');
    }
    this.#position += count;
    if (this.#position !== this.#chunk.length) return;
    this.#position = 0;
    const next = this.#head;
    if (next) {
      this.#chunk = next.chunk;
      this.#head = next.next;
      if (!this.#head) this.#tail = undefined;
    } else {
      this.#chunk = emptyChunk;
    }
  }

  /** Mark final input. Remaining bytes are readable before End is reached. */
  finish(): void { this.#finished = true; }

  /** Release all unread chunks, preserving whether the producer has finished. */
  clear(): void {
    this.#chunk = emptyChunk;
    this.#position = 0;
    this.#head = this.#tail = undefined;
  }
}

/** Negative values are distinct from every byte (and every UTF-16 code unit). */
export enum InputBoundary {
  Waiting = -1,
  End = -2,
}

type ByteChunk = { chunk: Uint8Array; next?: ByteChunk; };

const emptyChunk = new Uint8Array(0);
