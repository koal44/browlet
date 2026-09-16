import { describe, expect, it, vi } from 'vitest';
import { itPassesWith } from '../../test-runtime';

import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../../src/browlet/bindings';
import type { Task } from '../../../src/browlet/scripting/event-loop';
import { networkingTaskSource } from '../../../src/browlet/scripting/tasks';

describe('HTML Promise jobs', () => {
  it.each(['fulfill', 'reject'] as const)('continues when Node delivers Promise settlement through an HTML task (%s)', async (settlement) => {
    const browlet = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browlet.window);
    const observations: string[] = [];
    await browlet.exposeFunction('host', () => ({
      then(resolve: (value: string) => void, reject: (reason: string) => void) {
        observations.push('thenable');
        realm.queueGlobalTask(networkingTaskSource, () => {
          observations.push('task');
          if (settlement === 'fulfill') resolve('fulfilled');
          else reject('rejected');
        });
        observations.push('thenable finished');
      },
    }));
    const result = await browlet.evaluate(() => {
      const host = Reflect.get(globalThis, 'host') as () => Promise<string>;
      return host().then((value) => value, (reason: string) => reason);
    });
    observations.push(result);

    await expect.poll(() => observations).toEqual([
      'thenable', 'thenable finished', 'task',
      settlement === 'fulfill' ? 'fulfilled' : 'rejected',
    ]);
  });

  it.each(['fulfill', 'reject'] as const)('resumes an idle Window after a bridged Node thenable settles (%s)', async (settlement) => {
    const browlet = new Browlet({ route: () => '' });
    const observations: string[] = [];
    await browlet.exposeFunction('host', () => ({
      then(resolve: (value: string) => void, reject: (reason: string) => void) {
        observations.push('thenable');
        if (settlement === 'fulfill') resolve('fulfilled');
        else reject('rejected');
        observations.push('thenable finished');
      },
    }));
    const result = await browlet.evaluate(() => {
      const host = Reflect.get(globalThis, 'host') as () => Promise<string>;
      return host().then((value) => value, (reason: string) => reason);
    });
    expect(result).toBe(settlement === 'fulfill' ? 'fulfilled' : 'rejected');
    expect(observations).toEqual(['thenable', 'thenable finished']);
  });

  itPassesWith('hostHooks')('runs thenables and reactions as separate HTML microtasks with script cleanup', () => {
    const browlet = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browlet.window);
    const loop = realm.agent.eventLoop;
    const observations: { label: string; task: Task | null; }[] = [];
    const prepare = vi.spyOn(loop, 'prepareToRunCallback');
    const cleanup = vi.spyOn(loop, 'cleanUpAfterRunningCallback');
    // Synchronous instrumentation deliberately inspects the active internal task.
    Reflect.set(realm.globalObject, 'observe', (label: string) => {
      observations.push({ label, task: loop.currentlyRunningTask });
    });

    realm.evaluate(`
      Promise.resolve({
        then(resolve) {
          observe('thenable');
          resolve();
        }
      }).then(() => {
        observe('fulfilled');
        throw 17;
      }).catch(value => observe('rejected: ' + value));
      queueMicrotask(() => observe('queued'));
    `, 'promise-lifecycle.js');

    expect(observations.map(({ label }) => label)).toEqual([
      'thenable', 'queued', 'fulfilled', 'rejected: 17',
    ]);
    for (const { task } of observations) {
      expect(task?.source.name).toBe('microtask');
      expect(task?.scriptEvaluationEnvironmentSettingsObjectSet)
        .toEqual(new Set([realm.hostDefined]));
    }
    expect(new Set(observations.map(({ task }) => task)).size).toBe(4);
    expect(prepare).toHaveBeenCalledTimes(4);
    expect(cleanup).toHaveBeenCalledTimes(4);
    expect(loop.currentlyRunningTask).toBeNull();
    expect(realm.callbacks.captureContext()).toBe(realm.hostDefined);
  });

  itPassesWith('hostHooks')('queues handlerless propagation without preparing a script realm', () => {
    const browlet = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browlet.window);
    const loop = realm.agent.eventLoop;
    const tasks: (Task | null)[] = [];
    const enqueue = loop.queueMicrotask.bind(loop);
    vi.spyOn(loop, 'queueMicrotask').mockImplementation((steps, document) => {
      enqueue(() => {
        tasks.push(loop.currentlyRunningTask);
        steps();
      }, document);
    });
    const observed: unknown[] = [];
    Reflect.set(realm.globalObject, 'observe', (value: unknown) => { observed.push(value); });

    realm.evaluate('Promise.resolve(17).then().then(value => observe(value))',
      'handlerless-promise.js');

    expect(observed).toEqual([17]);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.scriptEvaluationEnvironmentSettingsObjectSet).toEqual(new Set());
    expect(tasks[1]?.scriptEvaluationEnvironmentSettingsObjectSet)
      .toEqual(new Set([realm.hostDefined]));
  });

  itPassesWith('explicitQueues')('keeps Window queues independent when Node settles their Promises', () => {
    const observations: number[] = [];
    const entries = [1, 2].map((value) => {
      const browlet = new Browlet({ route: () => '' });
      const realm = getRelevantRealm(browlet.window);
      Reflect.set(realm.globalObject, 'observe', () => { observations.push(value); });
      const settle = realm.evaluate(`
        const pending = Promise.withResolvers();
        pending.promise.then(() => observe());
        pending.resolve;
      `, 'host-settlement.js') as () => void;
      return { realm, settle };
    });
    for (const { settle } of entries) settle();
    expect(observations).toEqual([]);

    entries[0]!.realm.agent.eventLoop.performMicrotaskCheckpoint();
    expect(observations).toEqual([1]);
    entries[1]!.realm.agent.eventLoop.performMicrotaskCheckpoint();
    expect(observations).toEqual([1, 2]);
  });
});
