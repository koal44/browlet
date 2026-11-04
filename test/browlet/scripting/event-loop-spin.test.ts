import { AsyncLocalStorage } from 'node:async_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { JSExecutionContext } from '../../../src/browlet/scripting/execution-context';
import type { Task } from '../../../src/browlet/scripting/event-loop';
import { JSScriptOrModule } from '../../../src/browlet/scripting/script';
import { networkingTaskSource } from '../../../src/browlet/scripting/tasks';
import { createManualEventLoop, createManualUserAgent } from '../../support/browlet-agent';
import { getRelevantRealm } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('continuation-based event-loop spinning', () => {
  it('lets other tasks run, then resumes once on the original source and async context', () => runInHostTask(() => {
    const turns: (() => void)[] = [];
    const loop = createManualEventLoop({ requestTurn: (steps) => { turns.push(steps); } });
    const context = new AsyncLocalStorage<string>();
    const ready: (() => void)[] = [];
    const order: string[] = [];
    const task = loop.queueTask(networkingTaskSource, null, () => {
      context.run('original', () => {
        loop.spinUntil((resume) => {
          expect(loop.currentlyRunningTask).toBeNull();
          ready.push(resume);
        }, () => {
          expect(loop.currentlyRunningTask).toBe(task);
          expect(context.getStore()).toBe('original');
          order.push('resumed');
        });
      });
    });
    loop.queueTask(networkingTaskSource, null, () => { order.push('other task'); });

    while (turns.length > 0) turns.shift()!();
    expect(order).toEqual(['other task']);
    context.run('completion', () => { ready[0]!(); ready[0]!(); });
    expect(order).toEqual(['other task']);
    expect(loop.getTaskQueue(networkingTaskSource).size).toBe(1);
    turns.shift()!();
    ready[0]!();
    expect(order).toEqual(['other task', 'resumed']);
    expect(turns).toEqual([]);
  }));

  it.each([false, true])('restores prepared entries and runs their cleanup once (throw: %s)', (throws) => runInHostTask(() => {
    const { loop, env, document, turns } = createFixture();
    const ready: (() => void)[] = [];
    const checkpointContexts: (JSExecutionContext | null)[] = [];
    const context = new JSExecutionContext({ realm: env.realm, scriptOrModule: new JSScriptOrModule(env.realm, null) });
    const failure = new Error('continuation failed');
    const cleanup = vi.fn();
    const task = loop.queueTask(networkingTaskSource, document, () => {
      loop.prepareToRunScript(env);
      loop.executionContextStack.push(context);
      loop.prepareToRunCallback(env);
      loop.queueMicrotask(() => { checkpointContexts.push(loop.runningExecutionContext); });
      loop.spinUntil((resume) => { ready.push(resume); }, () => {
        try {
          expect(loop.currentlyRunningTask).toBe(task);
          expect(loop.entryExecutionContext).toBe(env.realmExecutionContext);
          expect(loop.runningExecutionContext).toBe(context);
          expect(context.skipWhenDeterminingIncumbent).toBe(1);
          expect(loop.getIncumbentEnvironment()).toBe(env);
          expect(task.scriptEvaluationEnvironments.has(env)).toBe(true);
          if (throws) throw failure;
        } finally {
          loop.cleanUpAfterRunningCallback(env);
          loop.executionContextStack.pop();
          loop.cleanUpAfterRunningScript(env);
          cleanup();
        }
      });
    });

    while (turns.length > 0) turns.shift()!();
    expect(checkpointContexts).toEqual([null]);
    expect(loop.executionContextStack).toEqual([]);
    expect(loop.backupIncumbentEnvironmentStack).toEqual([]);
    expect(cleanup).not.toHaveBeenCalled();
    loop.runScriptEvaluation(env, () => {
      expect(loop.runningExecutionContext).not.toBe(context);
      expect(loop.backupIncumbentEnvironmentStack).toEqual([]);
    });

    ready[0]!();
    const resumeTurn = turns.shift()!;
    if (throws) expect(resumeTurn).toThrow(failure);
    else resumeTurn();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(context.skipWhenDeterminingIncumbent).toBe(0);
    expect(loop.executionContextStack).toEqual([]);
    expect(loop.backupIncumbentEnvironmentStack).toEqual([]);
    expect(loop.currentlyRunningTask).toBeNull();
    loop.runScriptEvaluation(env, () => {});
    expect(loop.executionContextStack).toEqual([]);
  }));

  it('moves a spinning microtask to an ordinary task without recursively draining', () => runInHostTask(() => {
    const turns: (() => void)[] = [];
    const loop = createManualEventLoop({ requestTurn: (steps) => { turns.push(steps); } });
    const ready: (() => void)[] = [];
    const tasks: Task[] = [];
    const order: string[] = [];
    loop.queueMicrotask(() => {
      tasks.push(loop.currentlyRunningTask!);
      order.push('spinning');
      loop.spinUntil((resume) => {
        expect(order).toEqual(['spinning', 'following microtask']);
        ready.push(resume);
      }, () => {
        tasks.push(loop.currentlyRunningTask!);
        order.push('resumed');
        loop.queueMicrotask(() => { order.push('resumed checkpoint'); });
        loop.performMicrotaskCheckpoint();
        order.push('after resumed checkpoint');
      });
    });
    loop.queueMicrotask(() => { order.push('following microtask'); });

    while (turns.length > 0) turns.shift()!();
    expect(order).toEqual(['spinning', 'following microtask']);
    ready[0]!();
    expect(loop.getTaskQueue(tasks[0]!.source).has(tasks[0]!)).toBe(true);
    loop.performMicrotaskCheckpoint();
    expect(tasks).toHaveLength(1);
    turns.shift()!();
    expect(tasks).toHaveLength(2);
    expect(tasks[1]).toBe(tasks[0]);
    expect(order.slice(2)).toEqual(['resumed', 'resumed checkpoint', 'after resumed checkpoint']);
  }));

  it('keeps nested suspensions independent when a checkpoint microtask also spins', () => runInHostTask(() => {
    const { loop, env, document, turns } = createFixture();
    const ready: Map<string, () => void> = new Map();
    const order: string[] = [];
    const start = (name: string) => {
      loop.prepareToRunScript(env);
      const context = new JSExecutionContext({ realm: env.realm, incumbentEnv: env });
      loop.executionContextStack.push(context);
      loop.prepareToRunCallback(env);
      loop.spinUntil((resume) => { ready.set(name, resume); }, () => {
        try {
          expect(loop.runningExecutionContext).toBe(context);
          expect(context.skipWhenDeterminingIncumbent).toBe(1);
          expect(loop.backupIncumbentEnvironmentStack).toHaveLength(1);
          order.push(name);
        } finally {
          loop.cleanUpAfterRunningCallback(env);
          loop.executionContextStack.pop();
          loop.cleanUpAfterRunningScript(env);
        }
      });
    };
    loop.queueTask(networkingTaskSource, document, () => {
      loop.queueMicrotask(() => { start('microtask'); });
      start('task');
    });
    while (turns.length > 0) turns.shift()!();

    // Resume the outer task first: suspended callbacks must not form a single
    // shared LIFO stack which only allows the microtask to finish first.
    ready.get('task')!();
    while (turns.length > 0) turns.shift()!();
    ready.get('microtask')!();
    while (turns.length > 0) turns.shift()!();
    expect(order).toEqual(['task', 'microtask']);
    expect(loop.executionContextStack).toEqual([]);
    expect(loop.backupIncumbentEnvironmentStack).toEqual([]);
  }));

  it('retains the task Document and waits for it to become fully active again', () => runInHostTask(() => {
    const { loop, document, traversable, turns } = createFixture();
    const entry = traversable.activeSessionHistoryEntry;
    const ready: (() => void)[] = [];
    const continuation = vi.fn();
    const task = loop.queueTask(networkingTaskSource, document, () => {
      loop.spinUntil((resume) => { ready.push(resume); }, continuation);
    });
    while (turns.length > 0) turns.shift()!();
    traversable.activeSessionHistoryEntry = document.env.createSessionHistoryEntry(entry.url, new DocumentState());
    ready[0]!();
    expect(task.document).toBe(document);
    expect(loop.runTaskTurn()).toBe(false);
    expect(continuation).not.toHaveBeenCalled();

    traversable.activeSessionHistoryEntry = entry;
    while (turns.length > 0) turns.shift()!();
    expect(continuation).toHaveBeenCalledOnce();
  }));

  it('can spin again after resumption, even when the next goal is already met', () => runInHostTask(() => {
    const turns: (() => void)[] = [];
    const loop = createManualEventLoop({ requestTurn: (steps) => { turns.push(steps); } });
    const order: string[] = [];
    const tasks: (Task | null)[] = [];
    const task = loop.queueTask(networkingTaskSource, null, () => {
      loop.spinUntil((ready) => { ready(); }, () => {
        tasks.push(loop.currentlyRunningTask);
        order.push('first');
        loop.spinUntil((ready) => {
          expect(order).toEqual(['first']);
          ready();
          expect(order).toEqual(['first']);
        }, () => {
          tasks.push(loop.currentlyRunningTask);
          order.push('second');
        });
      });
    });
    while (turns.length > 0) turns.shift()!();
    expect(order).toEqual(['first', 'second']);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toBe(task);
    expect(tasks[1]).toBe(task);
  }));

  it('resumes through the real host after an external completion', async () => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    const loop = env.responsibleEventLoop;
    const finished = Promise.withResolvers<void>();
    const order: string[] = [];
    env.queueTask('network', () => {
      order.push('initial task');
      loop.spinUntil((ready) => {
        env.runInParallel(() => { order.push('goal'); ready(); });
      }, () => { order.push('continuation'); finished.resolve(); });
    });
    await finished.promise;
    expect(order).toEqual(['initial task', 'goal', 'continuation']);
    expect(loop.executionContextStack).toEqual([]);
    expect(loop.currentlyRunningTask).toBeNull();
  });
});

function createFixture() {
  const turns: (() => void)[] = [];
  const userAgent = createManualUserAgent({ requestTurn: (steps) => { turns.push(steps); } });
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const document = traversable.activeDocument!;
  const env = document.env;
  while (turns.length > 0) turns.shift()!();
  return { turns, traversable, document, env, loop: env.responsibleEventLoop };
}
