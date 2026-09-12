import type { PromiseValue } from '../js-engine/promises';
import type { RuntimeContext } from '../js-engine/runtime-context';

/** Encoding Standard §3 — A persistent end marker, distinct from an empty open queue. */
export const endOfQueue = Symbol('end-of-queue');

/** Strings represent scalar values and must already be well-formed. */
export type QueueChunk = string | Uint8Array;

/**
 * Encoding Standard §3 — An I/O queue, retained as chunks rather than individual nodes.
 * Supplied chunks become queue storage; callers must not mutate them while queued.
 * Nonblocking reads return undefined while waiting; waitFor supplies the runtime suspension.
 */
export class IOQueue<T extends QueueChunk> {
  #head?: ChunkNode<T>;
  #tail?: ChunkNode<T>;
  #ended = false;
  #waiters?: QueueWaiter[];

  /** Convert a complete sequence to an immediate I/O queue. */
  static from(input: string): IOQueue<string>;
  static from(input: Uint8Array): IOQueue<Uint8Array>;
  static from(input: QueueChunk): IOQueue<QueueChunk> {
    const queue = new IOQueue<QueueChunk>();
    queue.push(input);
    queue.push(endOfQueue);
    return queue;
  }

  /** Push items before any existing end marker. Empty chunks do not wake readers. */
  push(input: T | typeof endOfQueue): void {
    if (input === endOfQueue) {
      this.#ended = true;
    } else {
      if (input.length === 0) return;
      const node: ChunkNode<T> = { data: input, offset: 0 };
      if (this.#tail) this.#tail.next = node;
      else this.#head = node;
      this.#tail = node;
    }
    this.#wakeReaders();
  }

  /** Restore items in their original order, ahead of unread input. */
  restore(input: T): void {
    if (input.length === 0) return;
    this.#head = { data: input, offset: 0, next: this.#head };
    this.#tail ??= this.#head;
    this.#wakeReaders();
  }

  /** Read a currently available item without blocking the JavaScript event loop. */
  readAvailable(): number | typeof endOfQueue | undefined;
  readAvailable(count: number): number[] | undefined;
  readAvailable(count?: number): number | number[] | typeof endOfQueue | undefined {
    if (count !== undefined) {
      const items = this.peek(count);
      if (items === undefined) return;
      for (let i = 0; i < items.length; i++) this.readAvailable();
      return items;
    }
    const node = this.#head;
    if (!node) return this.#ended ? endOfQueue : undefined;
    let value: number;
    if (typeof node.data === 'string') {
      value = node.data.codePointAt(node.offset)!;
      node.offset += value > 0xffff ? 2 : 1;
    } else {
      value = node.data[node.offset++]!;
    }
    if (node.offset === node.data.length) this.#advance();
    return value;
  }

  /** Bulk counterpart of readAvailable; a codec can restore any unconsumed suffix. */
  readChunk(): T | typeof endOfQueue | undefined {
    const node = this.#head;
    if (!node) return this.#ended ? endOfQueue : undefined;
    const data = node.offset === 0 ? node.data : sliceChunk(node.data, node.offset);
    this.#advance();
    return data;
  }

  /** undefined means fewer than count items are available and input is still open. */
  peek(count: number): number[] | undefined {
    const values: number[] = [];
    for (let node = this.#head; node && values.length < count; node = node.next) {
      for (let offset = node.offset; offset < node.data.length && values.length < count;) {
        if (typeof node.data === 'string') {
          const value = node.data.codePointAt(offset)!;
          values.push(value);
          offset += value > 0xffff ? 2 : 1;
        } else {
          values.push(node.data[offset++]!);
        }
      }
    }
    return values.length === count || this.#ended ? values : undefined;
  }

  /** Wait only at a chunk boundary, using the caller's execution owner. */
  waitFor(count: number, runtime: RuntimeContext): PromiseValue<void> {
    if (this.#canRead(count)) return runtime.promises.try(() => undefined);
    const result = runtime.promises.withResolvers<void>();
    (this.#waiters ??= []).push({ count, resolve: () => { result.resolve(); } });
    return result.promise;
  }

  /** Consume currently available scalar values as a string. */
  takeString(this: IOQueue<string>): string {
    if (this.#head === this.#tail) {
      const chunk = this.readChunk();
      return typeof chunk === 'string' ? chunk : '';
    }
    const parts: string[] = [];
    for (let chunk = this.readChunk(); chunk !== undefined && chunk !== endOfQueue; chunk = this.readChunk()) {
      parts.push(chunk);
    }
    return parts.join('');
  }

  /** Consume currently available items as a list, excluding end-of-queue. */
  takeList(): number[] {
    const items: number[] = [];
    for (let item = this.readAvailable(); item !== undefined && item !== endOfQueue; item = this.readAvailable()) {
      items.push(item);
    }
    return items;
  }

  /** Consume bytes into one result allocation, optionally in the supplied runtime. */
  takeBytes(this: IOQueue<Uint8Array>, runtime?: RuntimeContext): Uint8Array<ArrayBuffer> {
    const head = this.#head;
    this.#head = this.#tail = undefined;
    let length = 0;
    for (let node = head; node; node = node.next) {
      length += node.data.length - node.offset;
    }
    const bytes = runtime
      ? runtime.buffers.createView('Uint8Array', runtime.buffers.allocateArrayBuffer(length))
      : new Uint8Array(length);
    let offset = 0;
    for (let node = head; node; node = node.next) {
      const chunk = node.offset === 0 ? node.data : node.data.subarray(node.offset);
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }

  /** Count available items without materializing them; EOF also completes a read. */
  #canRead(count: number): boolean {
    if (this.#ended) return true;
    for (let node = this.#head; node && count > 0; node = node.next) {
      if (typeof node.data === 'string') {
        for (let offset = node.offset; offset < node.data.length && count > 0; count--) {
          offset += node.data.codePointAt(offset)! > 0xffff ? 2 : 1;
        }
      } else {
        count -= node.data.length - node.offset;
      }
    }
    return count <= 0;
  }

  #advance(): void {
    this.#head = this.#head!.next;
    if (!this.#head) this.#tail = undefined;
  }

  #wakeReaders(): void {
    const waiters = this.#waiters;
    if (!waiters) return;
    let remaining = 0;
    for (const waiter of waiters) {
      if (this.#canRead(waiter.count)) waiter.resolve();
      else waiters[remaining++] = waiter;
    }
    waiters.length = remaining;
    if (remaining === 0) this.#waiters = undefined;
  }
}

type ChunkNode<T extends QueueChunk> = {
  data: T;
  offset: number;
  next?: ChunkNode<T>;
};

type QueueWaiter = { count: number; resolve: () => void; };

/** Synchronous codec status; waiting leaves suspension to the caller. See README.md. */
export type QueueResult<Error = number | null> = 'finished' | 'waiting' | { error: Error; };

/** An encoder retains its own state between queue-processing calls. */
export type Encoder = {
  encode(input: IOQueue<string>, output: IOQueue<Uint8Array>, mode: 'fatal' | 'html'): QueueResult<number>;
};

/** A decoder retains incomplete sequences and restores unread bytes on errors. */
export type Decoder = {
  decode(input: IOQueue<Uint8Array>, output: IOQueue<string>, mode: 'replacement' | 'fatal'): QueueResult<null>;
};

/**
 * Runtime suspension around Encoding §4.1's queue processing.
 * Steps capture the codec, output, and error mode, and drain available input before waiting.
 */
export function processQueue<T extends QueueChunk, Error>(
  input: IOQueue<T>,
  steps: () => QueueResult<Error>,
  runtime: RuntimeContext,
): PromiseValue<Exclude<QueueResult<Error>, 'waiting'>> {
  const run = (): Exclude<QueueResult<Error>, 'waiting'> | PromiseValue<Exclude<QueueResult<Error>, 'waiting'>> => {
    const result = steps();
    return result === 'waiting' ? input.waitFor(1, runtime).then(run) : result;
  };
  return runtime.promises.try(run);
}

function sliceChunk<T extends QueueChunk>(chunk: T, start: number): T {
  return (typeof chunk === 'string' ? chunk.slice(start) : chunk.subarray(start)) as T;
}
