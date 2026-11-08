import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { UserAgent } from '../../../src/browlet/user-agent';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/top-level-traversable';
import { storageTaskSource } from '../../../src/browlet/scripting/tasks';
import { createManualUserAgent } from '../../support/browlet-agent';
import { getRelevantRealm } from '../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Storage §4.8: queue a storage task', () => {
  it('delivers to the specified global and Document on another agent', () => {
    const userAgent = createManualUserAgent();
    const caller = TopLevelTraversable.create(userAgent, null, '').activeWindow!.env;
    const target = TopLevelTraversable.create(userAgent, null, '').activeWindow!.env;
    const callerLoop = caller.responsibleEventLoop;
    const targetLoop = target.responsibleEventLoop;
    const steps = vi.fn();
    expect(targetLoop).not.toBe(callerLoop);

    caller.queueStorageTask(target.realm.globalObject, steps);

    expect(steps).not.toHaveBeenCalled();
    expect(callerLoop.getTaskQueue(storageTaskSource).size).toBe(0);
    expect([...targetLoop.getTaskQueue(storageTaskSource)].map((task) => task.document))
      .toEqual([target.getAssociatedDocument()]);
    expect(callerLoop.runTaskTurn()).toBe(false);
    expect(steps).not.toHaveBeenCalled();
    expect(targetLoop.runTaskTurn()).toBe(true);
    expect(steps).toHaveBeenCalledOnce();
  });

  it('preserves storage-task order and runs microtasks between tasks', async () => {
    const env = TopLevelTraversable.create(new UserAgent(), null, '').activeWindow!.env;
    const trace: string[] = [];
    env.queueStorageTask(env.realm.globalObject, () => {
      trace.push('first');
      env.realm.queueMicrotask(() => { trace.push('microtask'); });
    });
    const finished = new Promise<void>((resolve) => {
      env.queueTask('storage', {
        run: () => {
          trace.push('second');
          resolve();
        },
      });
    });

    expect(trace).toEqual([]);
    expect(env.responsibleEventLoop.getTaskQueue(storageTaskSource).size).toBe(2);
    // Real host turns also exercise stock Node's ambient microtask backend.
    await finished;
    expect(trace).toEqual(['first', 'microtask', 'second']);
  });

  it('removes pending storage work when its target Document is destroyed', () => {
    const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
    const env = traversable.activeWindow!.env;
    const document = traversable.activeDocument!;
    const steps = vi.fn();
    env.queueStorageTask(env.realm.globalObject, () => { document.destroy(); });
    env.queueStorageTask(env.realm.globalObject, steps);

    env.responsibleEventLoop.runTaskTurn();

    expect(traversable.activeDocument).toBeNull();
    expect(env.responsibleEventLoop.getTaskQueue(storageTaskSource).size).toBe(0);
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(false);
    expect(steps).not.toHaveBeenCalled();
  });

  it('keeps an old Window destination separate from a retargeted WindowProxy', async () => {
    const browser = new Browlet({ route: () => '' });
    const proxy = browser.window;
    const firstRealm = getRelevantRealm(proxy);
    const firstDocument = firstRealm.getAssociatedDocument();
    await browser.navigate('https://example.test/');
    const secondRealm = getRelevantRealm(proxy);
    expect(secondRealm).not.toBe(firstRealm);

    firstRealm.env.queueStorageTask(firstRealm.globalObject, vi.fn());
    firstRealm.env.queueStorageTask(proxy, vi.fn());

    const tasks = new Set([
      ...firstRealm.agent.eventLoop.getTaskQueue(storageTaskSource),
      ...secondRealm.agent.eventLoop.getTaskQueue(storageTaskSource),
    ]);
    expect([...tasks].map((task) => task.document))
      .toEqual([firstDocument, secondRealm.getAssociatedDocument()]);
  });
});
