import { describe, expect, it, vi } from 'vitest';

import { NodeRealm, nodeRuntime } from '../../../src/js-engine/index';
import { itCompatPasses } from '../../test-runtime';

describe('Node runtime', () => {
  itCompatPasses(
    'reuses a detached global proxy in a replacement Realm',
    () => {
      const microtaskQueue = nodeRuntime.createMicrotaskQueue();
      const first = new NodeRealm(microtaskQueue);
      const firstObject = first.intrinsics.object;
      const globalProxy = first.detachGlobal();
      const second = new NodeRealm(microtaskQueue, {
        reuseGlobalProxyFrom: first,
      });

      expect(second.global).toBe(globalProxy);
      expect(second.evaluate('this', 'replacement.js')).toBe(globalProxy);
      expect(second.intrinsics.object).not.toBe(firstObject);
    },
  );

  it('drains promise jobs from its VM realms in shared FIFO order', async () => {
    await runInHostTask(() => {
      const microtaskQueue = nodeRuntime.createMicrotaskQueue();
      const first = new NodeRealm(microtaskQueue);
      const second = new NodeRealm(microtaskQueue);
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

      microtaskQueue.performMicrotaskCheckpoint();

      expect(order).toEqual(['A1', 'B1', 'A2']);
    });
  });

  itCompatPasses(
    'isolates checkpoints from ambient Node next ticks',
    async () => {
      await runInHostTask(() => {
        const microtaskQueue = nodeRuntime.createMicrotaskQueue();
        const order: string[] = [];

        process.nextTick(() => { order.push('ambient next tick'); });
        microtaskQueue.enqueueMicrotask(() => { order.push('microtask'); });
        microtaskQueue.performMicrotaskCheckpoint();

        expect(order).toEqual(['microtask']);
      });
    },
  );

  itCompatPasses('drains jobs when entered from a host microtask', async () => {
    await Promise.resolve();
    const microtaskQueue = nodeRuntime.createMicrotaskQueue();
    const order: string[] = [];

    microtaskQueue.enqueueMicrotask(() => { order.push('nested microtask'); });
    microtaskQueue.performMicrotaskCheckpoint();

    expect(order).toEqual(['nested microtask']);
  });

  itCompatPasses(
    'drains jobs when a test clock runs a host task synchronously',
    () => {
      vi.useFakeTimers();
      try {
        const microtaskQueue = nodeRuntime.createMicrotaskQueue();
        const order: string[] = [];

        setImmediate(() => {
          microtaskQueue.enqueueMicrotask(() => { order.push('microtask'); });
          microtaskQueue.performMicrotaskCheckpoint();
          expect(order).toEqual(['microtask']);
        });
        vi.runAllTimers();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  itCompatPasses('isolates queues owned by different agents', async () => {
    await runInHostTask(() => {
      const firstQueue = nodeRuntime.createMicrotaskQueue();
      const secondQueue = nodeRuntime.createMicrotaskQueue();
      const first = new NodeRealm(firstQueue);
      const second = new NodeRealm(secondQueue);
      const order: string[] = [];
      Reflect.set(first.global, 'order', order);
      Reflect.set(second.global, 'order', order);

      first.evaluate(
        `Promise.resolve().then(() => order.push('first'))`,
        'first-agent.js',
      );
      second.evaluate(
        `Promise.resolve().then(() => order.push('second'))`,
        'second-agent.js',
      );

      firstQueue.performMicrotaskCheckpoint();
      expect(order).toEqual(['first']);
      secondQueue.performMicrotaskCheckpoint();
      expect(order).toEqual(['first', 'second']);
    });
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
