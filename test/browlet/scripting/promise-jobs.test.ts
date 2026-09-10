import { describe, expect, vi } from 'vitest';
import { itPassesWith } from '../../test-runtime';

import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../../src/browlet/bindings';
import type { Task } from '../../../src/browlet/scripting/event-loop';

describe('HTML Promise jobs', () => {
  itPassesWith('hostHooks')('runs thenables and reactions as separate HTML microtasks with script cleanup', () => {
    const browlet = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browlet.window);
    const loop = realm.agent.eventLoop;
    const observations: { label: string; task: Task | null; }[] = [];
    const prepare = vi.spyOn(loop, 'prepareToRunCallback');
    const cleanup = vi.spyOn(loop, 'cleanUpAfterRunningCallback');
    browlet.expose('observe', (label: string) => {
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
    browlet.expose('observe', (value: unknown) => { observed.push(value); });

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
      browlet.expose('observe', () => { observations.push(value); });
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
