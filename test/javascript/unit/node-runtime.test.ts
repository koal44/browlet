import { describe, expect, it, vi } from 'vitest';

import { NodeRealm, nodeRuntime } from '../../../src/javascript/index';

describe('Node JavaScript runtime', () => {
  it('drains promise jobs from its VM realms in shared FIFO order', async () => {
    await runInHostTask(() => {
      const first = new NodeRealm();
      const second = new NodeRealm();
      const order: string[] = [];
      const record = (value: string): void => { order.push(value); };
      Reflect.set(first.global, 'record', record);
      Reflect.set(second.global, 'record', record);

      first.evaluate(`
        Promise.resolve().then(() => {
          record('A1');
          Promise.resolve().then(() => record('A2'));
        });
      `, 'first-realm.js');
      second.evaluate(
        `Promise.resolve().then(() => record('B1'));`,
        'second-realm.js',
      );

      nodeRuntime.performMicrotaskCheckpoint();

      expect(order).toEqual(['A1', 'B1', 'A2']);
    });
  });

  it.fails('isolates checkpoints from ambient Node next ticks', async () => {
    await runInHostTask(() => {
      const order: string[] = [];

      process.nextTick(() => { order.push('ambient next tick'); });
      queueMicrotask(() => { order.push('microtask'); });
      nodeRuntime.performMicrotaskCheckpoint();

      expect(order).toEqual(['microtask']);
    });
  });

  it.fails('drains jobs when entered from a host microtask', async () => {
    await Promise.resolve();
    const order: string[] = [];

    queueMicrotask(() => { order.push('nested microtask'); });
    nodeRuntime.performMicrotaskCheckpoint();

    expect(order).toEqual(['nested microtask']);
  });

  it.fails('drains jobs when a test clock runs a host task synchronously', () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];

      setImmediate(() => {
        queueMicrotask(() => { order.push('microtask'); });
        nodeRuntime.performMicrotaskCheckpoint();
        expect(order).toEqual(['microtask']);
      });
      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
    }
  });
});

function runInHostTask(steps: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        steps();
        resolve();
      } catch (error) {
        reject(error instanceof Error
          ? error
          : new Error('Host task failed', { cause: error }));
      }
    });
  });
}
