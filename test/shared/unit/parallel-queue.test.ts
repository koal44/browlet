import { describe, expect, it } from 'vitest';

import { ParallelQueue } from '../../../src/shared/parallel-queue';

describe('HTML section 2.1.1 parallel queues', () => {
  it('runs enqueued algorithms in FIFO order through one scheduled drain', () => {
    const host = new ManualParallelQueueHost();
    const queue = new ParallelQueue(host.schedule);
    const order: number[] = [];

    queue.enqueue(() => order.push(1));
    queue.enqueue(() => order.push(2));
    queue.enqueue(() => order.push(3));

    expect(host.pending).toBe(1);
    expect(order).toEqual([]);

    host.runNext();

    expect(order).toEqual([1, 2, 3]);
    expect(host.pending).toBe(0);
  });

  it('runs work enqueued during a drain after work already in the queue', () => {
    const host = new ManualParallelQueueHost();
    const queue = new ParallelQueue(host.schedule);
    const order: number[] = [];

    queue.enqueue(() => {
      order.push(1);
      queue.enqueue(() => order.push(3));
    });
    queue.enqueue(() => order.push(2));

    host.runNext();

    expect(order).toEqual([1, 2, 3]);
    expect(host.pending).toBe(0);
  });

  it('requests another drain after the queue becomes idle', () => {
    const host = new ManualParallelQueueHost();
    const queue = new ParallelQueue(host.schedule);
    const order: number[] = [];

    queue.enqueue(() => order.push(1));
    host.runNext();
    queue.enqueue(() => order.push(2));

    expect(host.pending).toBe(1);
    host.runNext();
    expect(order).toEqual([1, 2]);
  });

  it('remains usable after enqueued steps violate the nonthrowing contract', () => {
    const host = new ManualParallelQueueHost();
    const queue = new ParallelQueue(host.schedule);
    const error = new Error('parallel steps threw');
    const order: number[] = [];

    queue.enqueue(() => {
      order.push(1);
      throw error;
    });
    queue.enqueue(() => order.push(2));

    expect(() => host.runNext()).toThrow(error);
    expect(order).toEqual([1]);
    expect(host.pending).toBe(1);

    host.runNext();
    expect(order).toEqual([1, 2]);
  });

  it('can retry after the host fails to schedule a drain', () => {
    const drains: (() => void)[] = [];
    const error = new Error('scheduler failed');
    let fail = true;
    const queue = new ParallelQueue((drain) => {
      if (fail) throw error;
      drains.push(drain);
    });
    const order: number[] = [];

    expect(() => queue.enqueue(() => order.push(1))).toThrow(error);
    fail = false;
    queue.enqueue(() => order.push(2));

    expect(drains).toHaveLength(1);
    drains.shift()!();
    expect(order).toEqual([1, 2]);
  });
});

class ManualParallelQueueHost {
  #drains: (() => void)[] = [];

  get pending(): number {
    return this.#drains.length;
  }

  schedule = (drain: () => void): void => {
    this.#drains.push(drain);
  };

  runNext(): void {
    const drain = this.#drains.shift();
    if (drain === undefined) throw new Error('No parallel queue drain pending');
    drain();
  }
}
