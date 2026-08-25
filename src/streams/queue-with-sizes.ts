import { isNonNegativeNumber } from './miscellaneous';

export type QueueEntry<Value> = {
  readonly size: number;
  readonly value: Value;
};

export type QueueContainer<Value> = {
  queue: QueueEntry<Value>[];
  queueTotalSize: number;
};

export function dequeueValue<Value>(container: QueueContainer<Value>): Value {
  const pair = container.queue.shift();
  if (!pair) throw new Error('Cannot dequeue an empty stream queue');

  container.queueTotalSize -= pair.size;
  if (container.queueTotalSize < 0) container.queueTotalSize = 0;
  return pair.value;
}

export function enqueueValueWithSize<Value>(
  container: QueueContainer<Value>,
  value: Value,
  size: number,
): void {
  if (!isNonNegativeNumber(size) || size === Infinity) {
    throw new RangeError(
      'Size must be a finite, non-NaN, non-negative number.',
    );
  }

  container.queue.push({ size, value });
  container.queueTotalSize += size;
}

export function peekQueueValue<Value>(
  container: QueueContainer<Value>,
): Value {
  const pair = container.queue[0];
  if (!pair) throw new Error('Cannot peek an empty stream queue');
  return pair.value;
}

export function resetQueue<Value>(container: QueueContainer<Value>): void {
  container.queue = [];
  container.queueTotalSize = 0;
}
