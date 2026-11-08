import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { itPassesWith } from '../../test-runtime';

import { Browlet } from '../../../src/browlet/browlet';
import { internalType } from '../../../src/infra/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';
import { runInHostTask } from '../../support/tasks';
import type { Task } from '../../../src/browlet/scripting/event-loop';
import { networkingTaskSource } from '../../../src/browlet/scripting/tasks';

afterEach(() => vi.restoreAllMocks());

describe('HTML Promise jobs', () => {
  it.each([false, true])('wakes an idle internal sandbox through its owning loop (settled: %s)', async (alreadySettled) => {
    const browser = new Browlet({ route: () => '', reporting: false });
    const userAgent = getRelevantRealm(browser.window).env.userAgent;
    const env = userAgent.sandbox;
    expect(env.realm.hasEnvironment).toBe(false);
    const source = userAgent.HostPromise.withResolvers(internalType<string>());
    const observed: unknown[] = [];
    if (alreadySettled) source.resolve('done');
    env.InternalPromise.fromInternal(source.promise).observe(
      (value) => { observed.push(value); },
      (error) => { observed.push(error); },
    );
    if (!alreadySettled) source.resolve('done');
    // Read host data without supplying a task or checkpoint to the sandbox.
    await expect.poll(() => observed).toEqual(['done']);
  });

  it.each(['fulfill', 'reject'] as const)('continues when Node delivers Promise settlement through an HTML task (%s)', async (settlement) => {
    const browlet = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browlet.window);
    const observations: string[] = [];
    await browlet.exposeFunction('host', () => ({
      then(resolve: (value: string) => void, reject: (reason: string) => void) {
        observations.push('thenable');
        realm.queueGlobalTask(networkingTaskSource, {
          run: () => {
            observations.push('task');
            if (settlement === 'fulfill') resolve('fulfilled');
            else reject('rejected');
          },
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
      expect(task?.scriptEvaluationEnvironments)
        .toEqual(new Set([realm.env]));
    }
    expect(new Set(observations.map(({ task }) => task)).size).toBe(4);
    expect(prepare).toHaveBeenCalledTimes(4);
    expect(cleanup).toHaveBeenCalledTimes(4);
    expect(loop.currentlyRunningTask).toBeNull();
    expect(realm.callbacks.captureEnvironment()).toBe(realm.env);
  });

  itPassesWith('hostHooks').each(['resolve', 'reject'] as const)('queues handlerless propagation without preparing a script realm (%s)', (settlement) => {
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

    realm.evaluate(`Promise.${settlement}(17).then().then(value => observe(value), reason => observe(reason))`,
      'handlerless-promise.js');

    expect(observed).toEqual([17]);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.scriptEvaluationEnvironments).toEqual(new Set());
    expect(tasks[1]?.scriptEvaluationEnvironments)
      .toEqual(new Set([realm.env]));
  });

  itPassesWith('hostHooks').each(['reaction', 'thenable'] as const)('uses the foreign %s function for entry settings and the registering realm for incumbent settings', async (kind) => {
    await runInHostTask(() => {
      const browser = new Browlet({ route: () => '' });
      const caller = getRelevantRealm(browser.window);
      const callee = getRelevantRealm(createSiblingWindow(browser));
      const loop = caller.agent.eventLoop;
      const observations: { value: number; entry: unknown; incumbent: unknown; task: Task | null; }[] = [];
      const observationErrors: unknown[] = [];
      Reflect.set(callee.globalObject, 'observe', (value: number) => {
        // Missing hooks leave no entry context. Record that failed observation
        // for the assertion without creating an unrelated unhandled rejection.
        try {
          observations.push({
            value, entry: loop.entryExecutionContext.realm,
            incumbent: loop.getIncumbentEnvironment(), task: loop.currentlyRunningTask,
          });
        } catch (error) {
          observationErrors.push(error);
        }
      });
      const callback = callee.evaluate(kind === 'reaction'
        ? '(value => { observe(value); })'
        : '({ then(resolve) { observe(17); resolve(17); } })', 'foreign-callback.js');
      Reflect.set(caller.globalObject, 'foreignCallback', callback);
      caller.evaluate(kind === 'reaction'
        ? 'Promise.resolve(17).then(foreignCallback)'
        : 'Promise.resolve(foreignCallback)', 'register-job.js');

      expect(observationErrors).toEqual([]);
      expect(observations).toHaveLength(1);
      const observed = observations[0]!;
      expect(observed.value).toBe(17);
      expect(observed.entry === callee, 'entry settings come from the invoked function').toBe(true);
      expect(observed.incumbent === caller.env, 'incumbent settings come from registration').toBe(true);
      expect(observed.task?.source.name).toBe('microtask');
      expect(observed.task?.scriptEvaluationEnvironments).toEqual(new Set([callee.env]));
      expect(loop.executionContextStack).toEqual([]);
      expect(loop.backupIncumbentEnvironmentStack).toEqual([]);
      expect(loop.currentlyRunningTask).toBeNull();
    });
  });

  itPassesWith('hostHooks').each(['handler', 'revoked'] as const)('reports an abrupt job to its specified realm after script cleanup (%s)', (kind) => {
    // Unsupported engines report the uncaught job to Node. Isolate that outcome
    // from Vitest while retaining the required Window behavior as the assertion.
    const child = spawnSync(process.execPath, [
      '--require', resolve('test/support/register-typescript.cjs'),
      resolve('test/support/promise-job-error-child.ts'), kind,
    ], { env: process.env, encoding: 'utf8', windowsHide: true, timeout: 20000 });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stdout + child.stderr).toBe(0);
    expect(child.stdout).toContain('PASS: Promise job error reporting');
  }, 25000);

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
