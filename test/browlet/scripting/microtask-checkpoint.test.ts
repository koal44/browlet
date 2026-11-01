import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { createDocumentState } from '../../../src/browlet/browsing/navigation/document-state';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { networkingTaskSource } from '../../../src/browlet/scripting/tasks';
import { createManualUserAgent, mockEventLoopTurns } from '../../support/browlet-agent';
import { getRelevantRealm } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

// HTML §8.1.7.3: exercise the real shared queue and Binding callbacks, including
// work enqueued during the checkpoint. Enter outside Node's own Promise jobs.
describe('microtask checkpoint integration', () => {
  it('drains nested Promise, DOM, and explicit microtasks before the next task', async () => {
    mockEventLoopTurns();
    const browser = new Browlet({ route: () => '' });
    const loop = getRelevantRealm(browser.window).agent.eventLoop;
    const evaluation = browser.evaluate(() => new Promise<string[]>((resolve) => {
      const order: string[] = [];
      const target = document.createElement('div');
      let batch = 0;
      const observer = new MutationObserver((records) => {
        order.push(`observer ${++batch}: ${records.length}`);
        if (batch === 1) {
          target.id = 'third';
          queueMicrotask(() => { order.push('observer microtask'); });
        } else {
          observer.disconnect();
        }
      });
      observer.observe(target, { attributes: true });
      queueMicrotask(() => {
        order.push('microtask');
        target.id = 'second';
        void Promise.resolve().then(() => { order.push('nested promise'); });
        queueMicrotask(() => { order.push('nested microtask'); });
      });
      target.id = 'first';
      void Promise.resolve().then(() => {
        order.push('promise');
        queueMicrotask(() => { order.push('last'); resolve(order); });
      });
      order.push('synchronous');
    }));
    const nextTask = vi.fn();
    loop.queueTask(networkingTaskSource, null, nextTask);

    await runInHostTask(() => {
      expect(loop.runTaskTurn()).toBe(true);
      expect(nextTask).not.toHaveBeenCalled();
      expect(loop.currentlyRunningTask).toBeNull();
    });
    expect(await evaluation).toEqual([
      'synchronous', 'microtask', 'observer 1: 2', 'promise',
      'nested promise', 'nested microtask', 'observer 2: 1',
      'observer microtask', 'last',
    ]);
    expect(loop.runTaskTurn()).toBe(true);
    expect(nextTask).toHaveBeenCalledOnce();
  });

  it('reports a throwing callback and finishes its error listener before continuing the queue', async () => {
    mockEventLoopTurns();
    const browser = new Browlet({ route: () => '' });
    const loop = getRelevantRealm(browser.window).agent.eventLoop;
    const evaluation = browser.evaluate(() => new Promise<string[]>((resolve) => {
      const order: string[] = [];
      const exception = new Error('microtask failed');
      addEventListener('error', (event) => {
        event.preventDefault();
        order.push(`error: ${event.error === exception}`);
        queueMicrotask(() => { order.push('error microtask'); });
        void Promise.resolve().then(() => { order.push('error promise'); });
        order.push('error listener returned');
      }, { once: true });
      queueMicrotask(() => { order.push('throw'); throw exception; });
      queueMicrotask(() => {
        order.push('sibling');
        queueMicrotask(() => { order.push('last'); resolve(order); });
      });
      order.push('synchronous');
    }));

    await runInHostTask(() => {
      expect(loop.runTaskTurn()).toBe(true);
      expect(loop.currentlyRunningTask).toBeNull();
      expect(loop.executionContextStack).toEqual([]);
      expect(loop.backupIncumbentEnvironmentStack).toEqual([]);
    });
    expect(await evaluation).toEqual([
      'synchronous', 'throw', 'error: true', 'error listener returned',
      'sibling', 'error microtask', 'error promise', 'last',
    ]);
  });

  it('drains internal microtask steps for an inactive Document while retaining its ordinary tasks', () => runInHostTask(() => {
    const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
    const document = traversable.activeDocument!;
    const { realm, responsibleEventLoop: loop } = document.env;
    const order: string[] = [];
    const task = vi.fn();
    realm.queueGlobalTask(networkingTaskSource, task);
    realm.queueMicrotask(() => {
      order.push('first');
      expect(loop.currentlyRunningTask?.document).toBe(document);
      realm.queueMicrotask(() => { order.push('nested'); });
    });
    traversable.activeSessionHistoryEntry = {
      ...traversable.activeSessionHistoryEntry, documentState: createDocumentState(null),
    };
    expect(document.isFullyActive()).toBe(false);
    expect(loop.runTaskTurn()).toBe(false);

    // Microtask metadata does not impose task runnability. This tests internal
    // steps; invoking author callbacks still has its separate can-run-script gate.
    loop.performMicrotaskCheckpoint();

    expect(order).toEqual(['first', 'nested']);
    expect(task).not.toHaveBeenCalled();
    expect(loop.getTaskQueue(networkingTaskSource).size).toBe(1);
    expect(loop.currentlyRunningTask).toBeNull();
  }));
});
