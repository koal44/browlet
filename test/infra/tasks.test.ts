import { describe, expect, it } from 'vitest';
import { nativeTimerHost } from '../../src/infra/tasks';
import { createTestScheduling } from '../support/scheduling';
import { internalType } from '../../src/infra/promises';

describe('host task scheduling', () => {
  it('defers work and cancels queued tasks through native timer handles', async () => {
    const host = createTestScheduling(nativeTimerHost);
    const calls: string[] = [];
    const cancelled = host.queueTask('dom-manipulation', () => { calls.push('cancelled'); });
    cancelled.remove();

    const completed = new Promise<void>((resolve) => {
      host.runInParallel(() => { calls.push('background'); });
      host.queueTask('dom-manipulation', () => {
        calls.push('task');
        resolve();
      });
    });

    expect(calls).toEqual([]);
    await completed;
    expect(calls).toEqual(['background', 'task']);
  });

  it('cancels work through the supplied timer host', () => {
    const pending = new Set<() => void>();
    const calls: string[] = [];
    const host = createTestScheduling({
      scheduleTimeout(milliseconds, steps) {
        expect(milliseconds).toBe(0);
        pending.add(steps);
        return { remove: () => { pending.delete(steps); } };
      },
    });

    const cancelled = host.queueTask('dom-manipulation', () => { calls.push('cancelled'); });
    host.runInParallel(() => { calls.push('background'); });
    host.queueTask('dom-manipulation', () => { calls.push('task'); });
    expect(calls).toEqual([]);
    cancelled.remove();

    for (const steps of pending) steps();
    expect(calls).toEqual(['background', 'task']);
  });

  it('reports Promise observer failures through a later host wake-up', async () => {
    const scheduled = Promise.withResolvers<() => void>();
    const host = createTestScheduling({
      scheduleTimeout(milliseconds, steps) {
        expect(milliseconds).toBe(0);
        scheduled.resolve(steps);
        return { remove() {} };
      },
    });
    const failure = new Error('Observer failed');

    host.InternalPromise.resolve(1, internalType<number>()).observe(
      () => { throw failure; },
      (reason) => { throw reason; },
    );

    const report = await scheduled.promise;
    expect(report).toThrow(failure);
  });
});
