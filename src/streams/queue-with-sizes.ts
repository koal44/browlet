import { RangeError } from '../js-engine/exceptions';

/** Streams §8.1, a queue that tracks the total size of its values. */
export class QueueWithSizes<Value> {
  #entries: QueueEntry<Value>[] = [];
  #totalSize = 0;

  get length(): number {
    return this.#entries.length;
  }

  get totalSize(): number {
    return this.#totalSize;
  }

  /** DequeueValue. */
  dequeue(): Value {
    const pair = this.#entries.shift();
    if (!pair) throw new Error('Cannot dequeue an empty stream queue');

    this.#totalSize -= pair.size;
    if (this.#totalSize < 0) this.#totalSize = 0;
    return pair.value;
  }

  /** EnqueueValueWithSize. */
  enqueue(value: Value, size: number): void {
    if (!isNonNegativeNumber(size) || size === Infinity) {
      throw new RangeError('Size must be a finite, non-NaN, non-negative number.');
    }
    this.#entries.push({ size, value });
    this.#totalSize += size;
  }

  /** PeekQueueValue. */
  peek(): Value {
    const pair = this.#entries[0];
    if (!pair) throw new Error('Cannot peek an empty stream queue');
    return pair.value;
  }

  /** ResetQueue. */
  reset(): void {
    this.#entries = [];
    this.#totalSize = 0;
  }
}

type QueueEntry<Value> = {
  readonly size: number;
  readonly value: Value;
};

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value) && value >= 0;
}
