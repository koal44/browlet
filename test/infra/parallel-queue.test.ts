import { describe, expect, it, vi } from 'vitest';

import { ParallelQueue } from '../../src/infra/parallel-queue';

describe('HTML section 2.1.1 parallel queues', () => {
  it('runs enqueued tasks in FIFO order through one scheduled drain', () => {
    const host = new ManualParallelQueueHost();
    const queue = new ParallelQueue(host.schedule);
    const order: number[] = [];

    queue.enqueue({ run: () => order.push(1) });
    queue.enqueue({ run: () => order.push(2) });
    queue.enqueue({ run: () => order.push(3) });

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

    queue.enqueue({
      run: () => {
        order.push(1);
        queue.enqueue({ run: () => order.push(3) });
      },
    });
    queue.enqueue({ run: () => order.push(2) });

    host.runNext();

    expect(order).toEqual([1, 2, 3]);
    expect(host.pending).toBe(0);
  });

  it('runs tasks without binding their task record as the receiver', () => {
    const host = new ManualParallelQueueHost();
    const queue = new ParallelQueue(host.schedule);
    queue.enqueue({ run: function(this: unknown) { expect(this).toBeUndefined(); } });
    host.runNext();
  });

  it('requests another drain after the queue becomes idle', () => {
    const host = new ManualParallelQueueHost();
    const queue = new ParallelQueue(host.schedule);
    const order: number[] = [];

    queue.enqueue({ run: () => order.push(1) });
    host.runNext();
    queue.enqueue({ run: () => order.push(2) });

    expect(host.pending).toBe(1);
    host.runNext();
    expect(order).toEqual([1, 2]);
  });

  it('removes only the selected occurrence and cannot remove work from a later drain', () => {
    const host = new ManualParallelQueueHost();
    const queue = new ParallelQueue(host.schedule);
    const steps = vi.fn();
    const discarded = vi.fn();
    const task = { run: steps, discard: discarded };
    const first = queue.enqueue(task);
    const second = queue.enqueue(task);
    first.remove();
    first.remove();
    expect(discarded).toHaveBeenCalledOnce();
    expect(host.pending).toBe(1);
    host.runNext();
    expect(steps).toHaveBeenCalledOnce();
    queue.enqueue(task);
    first.remove();
    second.remove();
    host.runNext();
    expect(steps).toHaveBeenCalledTimes(2);
  });

  it('removes pending tasks during a drain without disturbing the current task or appended work', () => {
    const host = new ManualParallelQueueHost();
    const queue = new ParallelQueue(host.schedule);
    const order: number[] = [];
    const discarded = vi.fn(() => queue.enqueue({ run: () => order.push(3) }));
    const current = queue.enqueue({
      run: () => {
        current.remove();
        next.remove();
        order.push(1);
      },
      discard: () => { throw new Error('An executing task cannot be discarded'); },
    });
    const next = queue.enqueue({ run: () => order.push(2), discard: discarded });
    host.runNext();
    expect(order).toEqual([1, 3]);
    expect(discarded).toHaveBeenCalledOnce();
    expect(host.pending).toBe(0);
  });

  it('remains usable after an enqueued task violates the nonthrowing contract', () => {
    const host = new ManualParallelQueueHost();
    const queue = new ParallelQueue(host.schedule);
    const error = new Error('parallel task threw');
    const order: number[] = [];

    queue.enqueue({
      run: () => {
        order.push(1);
        throw error;
      },
    });
    queue.enqueue({ run: () => order.push(2) });

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

    expect(() => queue.enqueue({ run: () => order.push(1) })).toThrow(error);
    fail = false;
    queue.enqueue({ run: () => order.push(2) });

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
