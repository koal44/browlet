import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { type EventLoop, type EventLoopInit } from '../../../src/browlet/scripting/event-loop';
import { JSExecutionContext } from '../../../src/browlet/scripting/execution-context';
import { ClassicScript } from '../../../src/browlet/scripting/script';
import { ScriptFetchOptions } from '../../../src/browlet/scripting/script-fetch-options';
import { networkingTaskSource } from '../../../src/browlet/scripting/tasks';
import { Duration } from '../../../src/timing/index';
import { createManualEventLoop, createManualUserAgent } from '../../support/browlet-agent';
import { runInHostTask } from '../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('pausing an event loop', () => {
  it('retains the task and stack, without delivering tasks or a checkpoint during the wait', () => runInHostTask(() => {
    const { loop, env, turns } = createFixture();
    const order: string[] = [];
    loop.runScriptEvaluation(env, () => {
      const task = loop.currentlyRunningTask;
      const stack = loop.executionContextStack;
      const entries = [...stack];
      loop.queueTask(networkingTaskSource, null, () => { order.push('task'); });
      loop.queueMicrotask(() => { order.push('microtask'); });

      loop.pauseUntil(() => {
        order.push('wait');
        // Even a host that reenters an already-requested turn cannot deliver it.
        turns.shift()!();
        expect(turns).toEqual([]);
        expect(loop.runTaskTurn()).toBe(false);
        loop.performMicrotaskCheckpoint();
        expect(loop.currentlyRunningTask).toBe(task);
        expect(loop.executionContextStack).toBe(stack);
        expect(stack).toEqual(entries);
        expect(order).toEqual(['wait']);
        loop.queueTask(networkingTaskSource, null, () => { order.push('queued while paused'); });
        expect(turns).toEqual([]);
      }, env);

      order.push('resumed');
      expect(order).toEqual(['wait', 'resumed']);
      expect(loop.currentlyRunningTask).toBe(task);
      expect(loop.executionContextStack).toBe(stack);
      expect(turns).toHaveLength(1);
    });

    expect(order).toEqual(['wait', 'resumed', 'microtask']);
    while (turns.length > 0) turns.shift()!();
    expect(order).toEqual(['wait', 'resumed', 'microtask', 'task', 'queued while paused']);
    expect(loop.executionContextStack).toEqual([]);
    expect(loop.currentlyRunningTask).toBeNull();
  }));

  it('defers an already-requested checkpoint and idle period until the task returns', () => runInHostTask(() => {
    const { loop, env, turns } = createFixture();
    const order: string[] = [];
    const idleStart = loop.lastIdlePeriodStartTime;
    loop.queueMicrotask(() => { order.push('microtask'); });
    loop.runScriptEvaluation(env, () => {
      loop.pauseUntil(() => {
        turns.shift()!();
        expect(order).toEqual([]);
        expect(loop.lastIdlePeriodStartTime).toBe(idleStart);
        expect(turns).toEqual([]);
      }, env);
      order.push('resumed');
    });
    expect(order).toEqual(['resumed', 'microtask']);
    while (turns.length > 0) turns.shift()!();
    expect(loop.lastIdlePeriodStartTime).not.toBe(idleStart);
  }));

  it('blocks until an independently running host operation meets the goal', async () => {
    const state = new Int32Array(new SharedArrayBuffer(2 * Int32Array.BYTES_PER_ELEMENT));
    const worker = new Worker(`
      const { workerData } = require('node:worker_threads');
      const state = new Int32Array(workerData);
      Atomics.wait(state, 0, 0);
      Atomics.store(state, 1, 1);
      Atomics.notify(state, 1);
    `, { eval: true, workerData: state.buffer });
    try {
      await runInHostTask(() => {
        const { loop, env } = createFixture();
        loop.runScriptEvaluation(env, () => {
          expect(Atomics.load(state, 1)).toBe(0);
          loop.pauseUntil(() => {
            Atomics.store(state, 0, 1);
            Atomics.notify(state, 0);
            // This timeout only bounds a failed test. Production pause adds no
            // timer, polling, nested Node loop, or asynchronous continuation.
            expect(Atomics.wait(state, 1, 0, 10_000)).not.toBe('timed-out');
          }, env);
          expect(Atomics.load(state, 1)).toBe(1);
        });
      });
    } finally {
      await worker.terminate();
    }
  });

  it('measures with the supplied current environment and passes the running script to accounting', () => runInHostTask(() => {
    const recordPauseDuration = vi.fn();
    const { loop, env } = createFixture({
      taskTiming: {
        recordTaskStartTime() {}, recordTaskEndTime() {}, recordPauseDuration,
      },
    });
    const script = new ClassicScript('', env, env.apiBaseURL, new ScriptFetchOptions());
    const timing = vi.spyOn(env, 'currentHighResolutionTime')
      .mockReturnValueOnce(new Duration(100.125))
      .mockReturnValueOnce(new Duration(107.625));
    loop.runScriptEvaluation(env, () => {
      const context = new JSExecutionContext({ realm: env.realm, scriptOrModule: script.record });
      loop.executionContextStack.push(context);
      try {
        loop.pauseUntil(() => {
          expect(timing).toHaveBeenCalledOnce();
          expect(recordPauseDuration).not.toHaveBeenCalled();
        }, env);
        expect(recordPauseDuration).toHaveBeenCalledExactlyOnceWith(new Duration(7.5), script);
        expect(loop.runningExecutionContext).toBe(context);
      } finally {
        loop.executionContextStack.pop();
      }
    });
    expect(timing).toHaveBeenCalledTimes(2);
  }));

  it('restores delivery when the host wait throws', () => runInHostTask(() => {
    const { loop, env, turns } = createFixture();
    const failure = new Error('host wait failed');
    const order: string[] = [];
    expect(() => loop.runScriptEvaluation(env, () => {
      loop.pauseUntil(() => {
        loop.queueTask(networkingTaskSource, null, () => { order.push('task'); });
        loop.queueMicrotask(() => { order.push('microtask'); });
        throw failure;
      }, env);
    })).toThrow(failure);
    expect(order).toEqual(['microtask']);
    expect(loop.executionContextStack).toEqual([]);
    expect(loop.currentlyRunningTask).toBeNull();
    while (turns.length > 0) turns.shift()!();
    expect(order).toEqual(['microtask', 'task']);
  }));

  it('suppresses dispatch only on the paused loop', () => runInHostTask(() => {
    const { loop, env } = createFixture();
    const otherLoop = createManualEventLoop();
    const steps = vi.fn();
    otherLoop.queueTask(networkingTaskSource, null, steps);
    loop.runScriptEvaluation(env, () => {
      loop.pauseUntil(() => {
        expect(otherLoop.runTaskTurn()).toBe(true);
        expect(steps).toHaveBeenCalledOnce();
      }, env);
    });
  }));

  it('requires a running task and its current environment, and excludes asynchronous waits', () => {
    const { loop, env } = createFixture();
    const wait = vi.fn<() => undefined>();
    expect(() => loop.pauseUntil(wait, env)).toThrow('requires a running, unpaused task');
    expect(() => createManualEventLoop().pauseUntil(wait, env)).toThrow('belongs to another event loop');
    expect(wait).not.toHaveBeenCalled();
    expectTypeOf<() => Promise<void>>().not.toExtend<Parameters<EventLoop['pauseUntil']>[0]>();
  });
});

function createFixture(init: Partial<EventLoopInit> = {}) {
  const turns: (() => void)[] = [];
  const userAgent = createManualUserAgent({ ...init, requestTurn: (steps) => { turns.push(steps); } });
  const document = TopLevelTraversable.create(userAgent, null, '').activeDocument!;
  while (turns.length > 0) turns.shift()!();
  const env = document.env;
  return { turns, env, loop: env.responsibleEventLoop };
}
