import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import type { Task } from '../../../src/browlet/scripting/event-loop';
import { permissionsTaskSource } from '../../../src/browlet/scripting/tasks';
import { PermissionFeature, originPermissionKey, PermissionStore } from '../../../src/permissions/index';
import { createManualUserAgent } from '../../support/browlet-agent';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';
import { observeBrowletPromise, performTestMicrotaskCheckpoint } from '../test-runtime';
import type { PermissionStatusImpl } from '../../../src/browlet/integration/permissions/index';

afterEach(() => { vi.restoreAllMocks(); });

describe('Permissions §6.2: query()', () => {
  it('returns fresh, read-only PermissionStatus results with EventTarget behavior', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(async () => {
      const promise = navigator.permissions.query({ name: 'persistent-storage' });
      const status = await promise;
      const second = await navigator.permissions.query({ name: 'persistent-storage' });
      let events = 0;
      status.addEventListener('test', () => { events++; });
      status.dispatchEvent(new Event('test'));
      let illegalConstructor = false;
      let illegalReceiver = false;
      try { Reflect.construct(PermissionStatus, []); } catch (error) { illegalConstructor = error instanceof TypeError; }
      try {
        Object.getOwnPropertyDescriptor(PermissionStatus.prototype, 'state')!.get!.call({});
      } catch (error) { illegalReceiver = error instanceof TypeError; }
      return {
        promise: promise instanceof Promise,
        status: status instanceof PermissionStatus,
        eventTarget: status instanceof EventTarget,
        tag: Object.prototype.toString.call(status),
        name: status.name,
        state: status.state,
        distinct: status !== second,
        changedName: Reflect.set(status, 'name', 'changed'),
        changedState: Reflect.set(status, 'state', 'granted'),
        events, illegalConstructor, illegalReceiver,
      };
    })).toEqual({
      promise: true, status: true, eventTarget: true, tag: '[object PermissionStatus]',
      name: 'persistent-storage', state: 'prompt', distinct: true,
      changedName: false, changedState: false, events: 1, illegalConstructor: true, illegalReceiver: true,
    });
  });

  it.each(['prompt', 'granted', 'denied'] as const)('reads %s without prompting or changing the store', async (state) => {
    const browser = await createBrowser();
    const env = getRelevantRealm(browser.window).env;
    env.userAgent.storagePersistence.setPermission(env.origin, state);
    const prompt = vi.spyOn(env.userAgent, 'promptForPermission');
    const write = vi.spyOn(env.userAgent.permissionStore, 'setEntry');
    expect(await browser.evaluate(async () => (await navigator.permissions.query({ name: 'persistent-storage' })).state)).toBe(state);
    expect(prompt).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('applies the secure-context check even to a stored grant', async () => {
    const browser = await createBrowser('http://example.test/');
    const env = getRelevantRealm(browser.window).env;
    env.userAgent.storagePersistence.setPermission(env.origin, 'granted');
    expect(await browser.evaluate(async () => {
      const status = await navigator.permissions.query({ name: 'persistent-storage' });
      return { state: status.state, name: status.name, branded: status instanceof PermissionStatus };
    })).toEqual({ state: 'denied', name: 'persistent-storage', branded: true });
    expect(env.userAgent.permissionStore.getEntry({ name: 'persistent-storage' }, env.origin)?.state).toBe('granted');
  });

  it('rejects invalid inputs and receivers with realm TypeErrors rather than synchronous throws', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(async () => {
      const inputs = [undefined, null, 1, 'persistent-storage', {}, { name: Symbol('name') },
        { name: 'geolocation' }, { name: 'Persistent-storage' }];
      const results: boolean[] = [];
      for (const value of inputs) {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise the operation with explicit receivers and invalid inputs.
        const promise = Reflect.apply(Permissions.prototype.query, navigator.permissions, [value]) as Promise<unknown>;
        try { await promise; results.push(false); } catch (error) {
          results.push(promise instanceof Promise && error instanceof TypeError);
        }
      }
      for (const [receiver, args] of [[{}, [{ name: 'persistent-storage' }]], [navigator.permissions, []]] as const) {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Invalid receiver and missing-argument coverage.
        const promise = Reflect.apply(Permissions.prototype.query, receiver, args) as Promise<unknown>;
        try { await promise; results.push(false); } catch (error) {
          results.push(promise instanceof Promise && error instanceof TypeError);
        }
      }
      return results;
    })).toEqual(Array<boolean>(10).fill(true));
  });

  it('converts the original descriptor twice and preserves getter exceptions from either conversion', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(async () => {
      let reads = 0;
      let conversions = 0;
      const status = await navigator.permissions.query({
        get name() {
          reads++;
          return { toString() { conversions++; return 'persistent-storage'; } } as unknown as PermissionName;
        },
      });
      const failures: { reads: number; same: boolean; }[] = [];
      for (const failAt of [1, 2]) {
        let attempts = 0;
        const sentinel = new Error('descriptor getter');
        const promise = navigator.permissions.query({
          get name() {
            if (++attempts === failAt) throw sentinel;
            return 'persistent-storage' as const;
          },
        });
        try { await promise; } catch (error) { failures.push({ reads: attempts, same: error === sentinel }); }
      }
      let unknownReads = 0;
      try {
        await navigator.permissions.query({ get name() { unknownReads++; return 'unsupported' as PermissionName; } });
      } catch { /* Unsupported names stop before the second conversion. */ }
      return { reads, conversions, name: status.name, failures, unknownReads };
    })).toEqual({
      reads: 2, conversions: 2, name: 'persistent-storage',
      failures: [{ reads: 1, same: true }, { reads: 2, same: true }], unknownReads: 1,
    });
  });

  it('rejects an inactive current Document before reading descriptor members', async () => {
    const browser = await createBrowser();
    const env = getRelevantRealm(browser.window).env;
    vi.spyOn(env.getAssociatedDocument()!, 'isFullyActive').mockReturnValue(false);
    const delivery = vi.spyOn(env, 'queueTask');
    // The inactive Document cannot run a new author script; call its actual platform API externally.
    let reads = 0;
    const promise = browser.window.navigator.permissions.query({ get name() { reads++; return 'persistent-storage'; } });
    expect(promise).toBeInstanceOf(env.realm.NativePromise);
    const observed = observeBrowletPromise(browser.window, promise);
    performTestMicrotaskCheckpoint(browser.window);
    await expect(observed).rejects.toBeInstanceOf(browser.window.DOMException);
    await expect(observed).rejects.toMatchObject({ name: 'InvalidStateError' });
    expect(reads).toBe(0);
    expect(delivery).not.toHaveBeenCalled();
  });

  it('allocates and populates the status inside the permissions task that resolves the Promise', async () => {
    const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
    const document = traversable.activeDocument!;
    const window = traversable.activeBrowsingContext!.windowProxy.platform;
    const env = document.env;
    const loop = env.responsibleEventLoop;
    const background: (() => void)[] = [];
    vi.spyOn(env, 'runInParallel').mockImplementation((steps) => { background.push(steps); });
    const allocationTasks: (Task | null)[] = [];
    const queryTasks: (Task | null)[] = [];
    const createStatus = env.createPermissionStatus;
    const allocation = vi.spyOn(env, 'createPermissionStatus').mockImplementation((descriptor) => {
      allocationTasks.push(loop.currentlyRunningTask);
      return createStatus(descriptor);
    });
    const query = vi.fn<PermissionFeature['query']>((_descriptor, status) => {
      queryTasks.push(loop.currentlyRunningTask);
      status.state = 'granted';
    });
    env.userAgent.permissionStore = new PermissionStore([new PermissionFeature('persistent-storage', originPermissionKey, { query })]);
    const promise = window.navigator.permissions.query({ name: 'persistent-storage' });
    const observed = observeBrowletPromise(window, promise);
    // Completing any background work must not allocate or populate a Platform object.
    for (const steps of background) steps();
    expect(allocation).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    const tasks = [...loop.getTaskQueue(permissionsTaskSource)];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.document).toBe(document);

    await runInHostTask(() => { expect(loop.runTaskTurn()).toBe(true); });
    const status = await observed;
    expect(allocationTasks).toEqual(tasks);
    expect(queryTasks).toEqual(tasks);
    expect(status).toBeInstanceOf(window.PermissionStatus);
    expect(status.state).toBe('granted');
  });

  it.each(['reactivation', 'destruction'] as const)('defers query allocation while inactive, then handles Document %s', async (outcome) => {
    const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
    const document = traversable.activeDocument!;
    const window = traversable.activeBrowsingContext!.windowProxy.platform;
    const env = document.env;
    const loop = env.responsibleEventLoop;
    const activeEntry = traversable.activeSessionHistoryEntry;
    const background: (() => void)[] = [];
    vi.spyOn(env, 'runInParallel').mockImplementation((steps) => { background.push(steps); });
    const allocation = vi.spyOn(env, 'createPermissionStatus');
    const query = vi.spyOn(env.permissions, 'runPermissionQuery');
    const settled = vi.fn();
    // Document destruction runs on its owning loop, ahead of the pending query.
    if (outcome === 'destruction') env.queueTask('permissions', () => { document.destroy(); });
    const promise = window.navigator.permissions.query({ name: 'persistent-storage' });
    const observed = observeBrowletPromise(window, promise).then(settled, settled);
    traversable.activeSessionHistoryEntry = env.createSessionHistoryEntry(activeEntry.url, new DocumentState());
    expect(document.isFullyActive()).toBe(false);
    for (const steps of background) steps();
    await runInHostTask(() => { expect(loop.runTaskTurn()).toBe(false); });
    expect(allocation).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();

    traversable.activeSessionHistoryEntry = activeEntry;
    await runInHostTask(() => { expect(loop.runTaskTurn()).toBe(true); });
    if (outcome === 'destruction') {
      expect(loop.getTaskQueue(permissionsTaskSource).size).toBe(0);
      await runInHostTask(() => { expect(loop.runTaskTurn()).toBe(false); });
      expect(allocation).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
      expect(settled).not.toHaveBeenCalled();
    } else {
      await observed;
      expect(allocation).toHaveBeenCalledOnce();
      expect(query).toHaveBeenCalledOnce();
      expect(settled).toHaveBeenCalledExactlyOnceWith(expect.any(window.PermissionStatus));
    }
  });

  it('uses the method settings and result realm, but queues delivery on the receiver global', async () => {
    const first = await createBrowser('https://first.test/');
    const second = await createBrowser('https://second.test/');
    const firstEnv = getRelevantRealm(first.window).env;
    const secondEnv = getRelevantRealm(second.window).env;
    firstEnv.userAgent.storagePersistence.setPermission(firstEnv.origin, 'granted');
    secondEnv.userAgent.storagePersistence.setPermission(secondEnv.origin, 'denied');
    const delivery = vi.spyOn(firstEnv, 'queueTask');
    const otherDelivery = vi.spyOn(secondEnv, 'queueTask');
    const promise = second.window.Permissions.prototype.query.call(first.window.navigator.permissions, { name: 'persistent-storage' });
    expect(promise).toBeInstanceOf(secondEnv.realm.NativePromise);
    const status = await observeBrowletPromise(second.window, promise);
    expect(status.state).toBe('denied');
    expect(status).toBeInstanceOf(second.window.PermissionStatus);
    expect(getRelevantRealm(status)).toBe(secondEnv.realm);
    expect(delivery).toHaveBeenCalledWith('permissions', expect.any(Function));
    expect(otherDelivery).not.toHaveBeenCalled();

    vi.spyOn(secondEnv.getAssociatedDocument()!, 'isFullyActive').mockReturnValue(false);
    const rejected = second.window.Permissions.prototype.query.call(first.window.navigator.permissions, { name: 'persistent-storage' });
    const observed = observeBrowletPromise(second.window, rejected);
    performTestMicrotaskCheckpoint(second.window);
    await expect(observed).rejects.toMatchObject({ name: 'InvalidStateError' });
  });

  it('delivers a feature query failure through the permissions task queue', async () => {
    const browser = await createBrowser();
    const env = getRelevantRealm(browser.window).env;
    env.userAgent.permissionStore = new PermissionStore([new PermissionFeature('persistent-storage', originPermissionKey, {
      query: () => { throw new Error('Feature query failed'); },
    })]);
    const delivery = vi.spyOn(env, 'queueTask');
    await expect(browser.evaluate(() => navigator.permissions.query({ name: 'persistent-storage' })))
      .rejects.toThrow('Feature query failed');
    expect(delivery).toHaveBeenCalledWith('permissions', expect.any(Function));
  });

  it('runs a feature query override with the converted descriptor and retained result', async () => {
    const browser = await createBrowser();
    const env = getRelevantRealm(browser.window).env;
    const query = vi.fn<NonNullable<PermissionFeature['query']>>((_descriptor, status, queryEnv) => {
      expect(queryEnv).toBe(env);
      status.state = 'granted';
    });
    env.userAgent.permissionStore = new PermissionStore([new PermissionFeature('persistent-storage', originPermissionKey, { query })]);
    const status = await browser.window.navigator.permissions.query({ name: 'persistent-storage' });
    const implementation = unwrap<PermissionStatusImpl>(status);
    expect(query).toHaveBeenCalledWith({ name: 'persistent-storage' }, implementation, env);
    expect(implementation.query).toBe(query.mock.calls[0]![0]);
    expect(status.state).toBe('granted');
    expect(env.userAgent.permissionStore.size).toBe(0);
  });
});

async function createBrowser(url = 'https://example.test/') {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate(url);
  return browser;
}
