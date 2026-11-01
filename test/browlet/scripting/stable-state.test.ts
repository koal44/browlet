import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { createDocumentState } from '../../../src/browlet/browsing/navigation/document-state';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/index';
import type { Task } from '../../../src/browlet/scripting/event-loop';
import { networkingTaskSource } from '../../../src/browlet/scripting/tasks';
import { createManualEventLoop, createManualUserAgent } from '../../support/browlet-agent';
import { getRelevantRealm } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('stable-state scheduling', () => {
  it('uses the same coalesced checkpoint path for work already in the engine queue', async () => {
    const turns: (() => void)[] = [];
    const loop = createManualEventLoop({ requestTurn: (steps) => { turns.push(steps); } });
    const order: string[] = [];
    loop.queueTask(networkingTaskSource, null, () => { order.push('task'); });
    loop.microtaskQueue.enqueueMicrotask(() => { order.push('engine reaction'); });
    loop.requestMicrotaskCheckpoint();
    loop.requestMicrotaskCheckpoint();

    expect(turns).toHaveLength(1);
    await runInHostTask(() => {
      turns.shift()!();
      expect(order).toEqual(['engine reaction']);
      expect(turns).toHaveLength(1);
      turns.shift()!();
      expect(order).toEqual(['engine reaction', 'task']);
      expect(turns).toEqual([]);
    });
  });

  it('wakes an idle loop for a microtask arriving outside an HTML task', async () => {
    const turns: (() => void)[] = [];
    const loop = createManualEventLoop({ requestTurn: (steps) => { turns.push(steps); } });
    const section = vi.fn();

    loop.queueMicrotask(section);

    expect(turns).toHaveLength(1);
    expect(section).not.toHaveBeenCalled();
    await runInHostTask(() => { turns.shift()!(); });
    expect(section).toHaveBeenCalledOnce();
    expect(loop.currentlyRunningTask).toBeNull();
    expect(loop.getTaskQueues().size).toBe(0);
    expect(turns).toEqual([]);
  });

  it('coalesces idle wake-ups and drains nested microtasks in FIFO order', async () => {
    const turns: (() => void)[] = [];
    const loop = createManualEventLoop({ requestTurn: (steps) => { turns.push(steps); } });
    const order: string[] = [];

    await runInHostTask(() => {
      loop.queueMicrotask(() => {
        order.push('first');
        loop.queueMicrotask(() => { order.push('nested'); });
      });
      loop.queueMicrotask(() => { order.push('second'); });
      expect(turns).toHaveLength(1);
      turns.shift()!();
      expect(order).toEqual(['first', 'second', 'nested']);
      expect(turns).toEqual([]);
    });
  });

  it('uses the current task checkpoint without requesting an extra turn', async () => {
    const turns: (() => void)[] = [];
    const loop = createManualEventLoop({ requestTurn: (steps) => { turns.push(steps); } });
    const section = vi.fn();

    loop.queueTask(networkingTaskSource, null, () => { loop.queueMicrotask(section); });
    await runInHostTask(() => { turns.shift()!(); });

    expect(section).toHaveBeenCalledOnce();
    expect(turns).toEqual([]);
  });

  it('finishes an idle checkpoint before selecting an ordinary task', async () => {
    const turns: (() => void)[] = [];
    const loop = createManualEventLoop({ requestTurn: (steps) => { turns.push(steps); } });
    const order: string[] = [];

    await runInHostTask(() => {
      loop.queueTask(networkingTaskSource, null, () => { order.push('task'); });
      loop.queueMicrotask(() => { order.push('section'); });
      expect(turns).toHaveLength(1);
      turns.shift()!();
      expect(order).toEqual(['section']);
      expect(turns).toHaveLength(1);
      turns.shift()!();
      expect(order).toEqual(['section', 'task']);
      expect(turns).toEqual([]);
    });
  });

  it('uses the owning loop and retains an inactive Document as microtask metadata', async () => {
    const userAgent = createManualUserAgent();
    const traversable = TopLevelTraversable.create(userAgent, null, '');
    const document = traversable.activeDocument!;
    const { env } = document;
    const loop = env.responsibleEventLoop;
    const other = TopLevelTraversable.create(userAgent, null, '').activeDocument!.env.responsibleEventLoop;
    const task = vi.fn();
    const sectionDocuments: (DocumentImpl | null)[] = [];
    let otherTask: Task | null = null;
    const section = vi.fn(() => {
      sectionDocuments.push(loop.currentlyRunningTask?.document ?? null);
      otherTask = other.currentlyRunningTask;
    });
    expect(other).not.toBe(loop);

    await runInHostTask(() => {
      env.awaitStableState(section);
      traversable.activeSessionHistoryEntry = {
        ...traversable.activeSessionHistoryEntry, documentState: createDocumentState(null),
      };
      expect(document.isFullyActive()).toBe(false);
      loop.queueTask(networkingTaskSource, document, task);
      expect(loop.runTaskTurn()).toBe(false);
      loop.performMicrotaskCheckpoint();
    });

    expect(section).toHaveBeenCalledOnce();
    expect(sectionDocuments).toHaveLength(1);
    expect(sectionDocuments[0]).toBe(document);
    expect(otherTask).toBeNull();
    expect(task).not.toHaveBeenCalled();
    expect(loop.getTaskQueue(networkingTaskSource).size).toBe(1);
    expect(loop.currentlyRunningTask).toBeNull();
  });

  it.each([false, true])('resumes parallel work only when the section returns it: %s', async (continueWork) => {
    const { env } = TopLevelTraversable.create(createManualUserAgent(), null, '').activeDocument!;
    const schedule = vi.spyOn(env, 'runInParallel');
    const continuation = vi.fn();
    const section = vi.fn(() => continueWork ? continuation : undefined);

    await runInHostTask(() => {
      expect(env.awaitStableState(section)).toBeUndefined();
      expect(section).not.toHaveBeenCalled();
      env.responsibleEventLoop.performMicrotaskCheckpoint();
      expect(continuation).not.toHaveBeenCalled();
    });
    await runInHostTask(() => {});

    expect(section).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledTimes(continueWork ? 1 : 0);
    expect(continuation).toHaveBeenCalledTimes(continueWork ? 1 : 0);
  });

  it('delivers a stable state and parallel continuation without an unrelated HTML task', async () => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    const loop = env.responsibleEventLoop;
    const order: string[] = [];
    const parallelTasks: (Task | null)[] = [];
    const finished = Promise.withResolvers<void>();
    let sectionDocument: DocumentImpl | null = null;

    env.runInParallel(() => {
      parallelTasks.push(loop.currentlyRunningTask);
      order.push('parallel');
      env.awaitStableState(() => {
        sectionDocument = loop.currentlyRunningTask?.document ?? null;
        order.push('synchronous');
        env.realm.queueMicrotask(() => { order.push('nested microtask'); });
        return () => {
          parallelTasks.push(loop.currentlyRunningTask);
          order.push('resumed');
          finished.resolve();
        };
      });
    });
    await finished.promise;

    expect(order).toEqual(['parallel', 'synchronous', 'nested microtask', 'resumed']);
    expect(sectionDocument).toBe(env.getAssociatedDocument());
    expect(parallelTasks).toEqual([null, null]);
    expect(loop.currentlyRunningTask).toBeNull();
  });
});
