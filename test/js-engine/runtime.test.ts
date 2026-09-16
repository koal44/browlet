import { describe, expect, it, vi } from 'vitest';

import {
  JSRealm, addon, createMicrotaskQueue, getAssociatedRealm,
} from '../../src/js-engine/index';
import { itPassesWith } from '../test-runtime';

describe('JavaScript runtime', () => {
  itPassesWith('explicitQueues')(
    'reuses a detached global proxy in a replacement Realm',
    () => {
      const microtaskQueue = createMicrotaskQueue();
      const first = new JSRealm(microtaskQueue);
      const firstObject = first.intrinsics.object;
      const retained = first.evaluate('({ nested: Object.create(null) })', 'retained.js') as {
        nested: object;
      };
      const firstReference = addon.getRealm(retained.nested);
      const globalProxy = first.detachGlobal();

      expect(getAssociatedRealm(globalProxy)).toBe(first);
      expect(getAssociatedRealm(retained.nested)).toBe(first);
      expect(getAssociatedRealm(firstObject)).toBe(first);

      const second = new JSRealm(microtaskQueue, {
        reuseGlobalProxyFrom: first,
      });

      expect(second.global).toBe(globalProxy);
      expect(getAssociatedRealm(globalProxy)).toBe(second);
      expect(second.evaluate('this', 'replacement.js')).toBe(globalProxy);
      expect(second.intrinsics.object).not.toBe(firstObject);
      expect(getAssociatedRealm(retained.nested)).toBe(first);
      expect(getAssociatedRealm(firstObject)).toBe(first);
      expect(getAssociatedRealm(second.intrinsics.object)).toBe(second);
      expect(addon.getRealm(retained.nested)).toBe(firstReference);
      expect(addon.getRealm(second.intrinsics.object)).not.toBe(firstReference);
      expect(Reflect.ownKeys(firstReference)).toEqual(['global']);
    },
  );

  it('drains promise jobs from its VM realms in shared FIFO order', async () => {
    await runInHostTask(() => {
      const microtaskQueue = createMicrotaskQueue();
      const first = new JSRealm(microtaskQueue);
      const second = new JSRealm(microtaskQueue);
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

  itPassesWith('explicitQueues')(
    'isolates checkpoints from ambient Node next ticks',
    async () => {
      await runInHostTask(() => {
        const microtaskQueue = createMicrotaskQueue();
        const order: string[] = [];

        process.nextTick(() => { order.push('ambient next tick'); });
        microtaskQueue.enqueueMicrotask(() => { order.push('microtask'); });
        microtaskQueue.performMicrotaskCheckpoint();

        expect(order).toEqual(['microtask']);
      });
    },
  );

  itPassesWith('explicitQueues')('drains jobs when entered from a host microtask', async () => {
    await Promise.resolve();
    const microtaskQueue = createMicrotaskQueue();
    const order: string[] = [];

    microtaskQueue.enqueueMicrotask(() => { order.push('nested microtask'); });
    microtaskQueue.performMicrotaskCheckpoint();

    expect(order).toEqual(['nested microtask']);
  });

  itPassesWith('explicitQueues')(
    'drains jobs when a test clock runs a host task synchronously',
    () => {
      vi.useFakeTimers();
      try {
        const microtaskQueue = createMicrotaskQueue();
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

  itPassesWith('explicitQueues')('isolates queues owned by different agents', async () => {
    await runInHostTask(() => {
      const firstQueue = createMicrotaskQueue();
      const secondQueue = createMicrotaskQueue();
      const first = new JSRealm(firstQueue);
      const second = new JSRealm(secondQueue);
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
