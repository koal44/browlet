import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { BrowletEnvironment } from '../../../src/browlet/environment';
import type { PermissionStatusImpl } from '../../../src/browlet/integration/permissions/index';
import { permissionsTaskSource } from '../../../src/browlet/scripting/index';
import { PermissionFeature, originPermissionKey, PermissionStore, type PermissionState } from '../../../src/permissions/index';
import { obtainURLOrigin, parseURL } from '../../../src/url/index';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';
import { observeBrowletPromise } from '../test-runtime';

afterEach(() => { vi.restoreAllMocks(); });

describe('Permissions §6.3: PermissionStatus', () => {
  it('delivers trusted onchange events through author code after host decisions change', async () => {
    const browser = await createBrowser();
    const env = getRelevantRealm(browser.window).env;
    await browser.exposeFunction('setPermission', (state: PermissionState) => {
      env.userAgent.storagePersistence.setPermission(env.origin, state);
    });
    expect(await browser.evaluate(async () => {
      const host = window as unknown as { setPermission(state: PermissionState): Promise<void>; };
      const status = await navigator.permissions.query({ name: 'persistent-storage' });
      const initialHandler = status.onchange;
      const events: { state: PermissionState; target: boolean; trusted: boolean; bubbles: boolean; cancelable: boolean; }[] = [];
      let finish!: () => void;
      const handler = function(this: PermissionStatus, event: Event) {
        events.push({
          state: status.state, target: this === status && event.target === status && event.currentTarget === status,
          trusted: event.isTrusted, bubbles: event.bubbles, cancelable: event.cancelable,
        });
        finish();
      };
      status.onchange = handler;
      for (const state of ['granted', 'denied', 'prompt'] as const) {
        const changed = new Promise<void>((resolve) => { finish = resolve; });
        await host.setPermission(state);
        await changed;
      }
      const sameHandler = status.onchange === handler;
      status.onchange = null;
      return { initialHandler, sameHandler, cleared: status.onchange, name: status.name, events };
    })).toEqual({
      initialHandler: null, sameHandler: true, cleared: null, name: 'persistent-storage',
      events: ['granted', 'denied', 'prompt'].map((state) => ({
        state, target: true, trusted: true, bubbles: false, cancelable: false,
      })),
    });
  });

  it('uses ordinary event-handler replacement, removal, and listener ordering', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(async () => {
      const status = await navigator.permissions.query({ name: 'persistent-storage' });
      const trace: string[] = [];
      status.addEventListener('change', () => { trace.push('before'); });
      status.onchange = () => { trace.push('old'); };
      status.addEventListener('change', () => { trace.push('after'); });
      status.onchange = () => { trace.push('new'); };
      status.dispatchEvent(new Event('change'));
      Reflect.set(status, 'onchange', 42);
      const cleared = Reflect.get(status, 'onchange') === null;
      status.dispatchEvent(new Event('change'));
      return { trace, cleared };
    })).toEqual({ trace: ['before', 'new', 'after', 'before', 'after'], cleared: true });
  });

  it('refreshes every result, including those without listeners, before queuing change delivery', async () => {
    const browser = await createBrowser();
    const [unobserved, observed] = await Promise.all([
      browser.window.navigator.permissions.query({ name: 'persistent-storage' }),
      browser.window.navigator.permissions.query({ name: 'persistent-storage' }),
    ]);
    const updates = captureUpdates(getRelevantRealm(browser.window).env);
    const { env } = updates;
    const changed = vi.fn();
    observed.onchange = changed;
    env.userAgent.storagePersistence.setPermission(env.origin, 'granted');
    expect([unobserved.state, observed.state]).toEqual(['prompt', 'prompt']);
    expect(changed).not.toHaveBeenCalled();

    updates.runBackground();
    expect([unobserved.state, observed.state]).toEqual(['granted', 'granted']);
    expect(changed).not.toHaveBeenCalled();
    expect([...env.responsibleEventLoop.getTaskQueue(permissionsTaskSource)].map((task) => task.document))
      .toEqual([env.getAssociatedDocument(), env.getAssociatedDocument()]);
    await updates.runTasks();
    expect(changed).toHaveBeenCalledTimes(1);

    env.userAgent.permissionStore.revoke({ name: 'persistent-storage' }, env.origin);
    updates.runBackground();
    await updates.runTasks();
    expect([unobserved.state, observed.state]).toEqual(['prompt', 'prompt']);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('does not notify for redundant decisions, unrelated keys, or ineffective grants', async () => {
    const browser = await createBrowser();
    const status = await browser.window.navigator.permissions.query({ name: 'persistent-storage' });
    const changed = vi.fn();
    status.onchange = changed;
    const updates = captureUpdates(getRelevantRealm(browser.window).env);
    const { env } = updates;
    const otherOrigin = obtainURLOrigin(parseURL('https://other.test/').url!);
    env.userAgent.storagePersistence.setPermission(otherOrigin, 'granted');
    env.userAgent.permissionStore.setEntry({ name: 'persistent-storage' }, env.origin, 'prompt');
    updates.runBackground();
    await updates.runTasks();
    expect(status.state).toBe('prompt');
    expect(changed).not.toHaveBeenCalled();

    env.userAgent.storagePersistence.setPermission(env.origin, 'granted');
    updates.runBackground();
    await updates.runTasks();
    env.userAgent.storagePersistence.setPermission(env.origin, 'granted');
    updates.runBackground();
    await updates.runTasks();
    expect(status.state).toBe('granted');
    expect(changed).toHaveBeenCalledTimes(1);

    const insecure = await createBrowser('http://example.test/');
    const denied = await insecure.window.navigator.permissions.query({ name: 'persistent-storage' });
    const insecureUpdates = captureUpdates(getRelevantRealm(insecure.window).env);
    const deniedChange = vi.fn();
    denied.onchange = deniedChange;
    insecureUpdates.env.userAgent.storagePersistence.setPermission(insecureUpdates.env.origin, 'granted');
    insecureUpdates.runBackground();
    await insecureUpdates.runTasks();
    expect(denied.state).toBe('denied');
    expect(deniedChange).not.toHaveBeenCalled();
  });

  it('suppresses inactive-document updates and reconciles on reactivation', async () => {
    const browser = await createBrowser();
    const status = await browser.window.navigator.permissions.query({ name: 'persistent-storage' });
    const changed = vi.fn();
    status.onchange = changed;
    const updates = captureUpdates(getRelevantRealm(browser.window).env);
    const { env } = updates;
    const document = env.getAssociatedDocument()!;
    const active = vi.spyOn(document, 'isFullyActive').mockReturnValue(false);
    env.userAgent.storagePersistence.setPermission(env.origin, 'granted');
    updates.runBackground();
    expect(status.state).toBe('prompt');
    expect(env.responsibleEventLoop.getTaskQueue(permissionsTaskSource).size).toBe(0);

    active.mockReturnValue(true);
    document.notifyFullyActiveStateChanged();
    updates.runBackground();
    expect(status.state).toBe('granted');
    expect(changed).not.toHaveBeenCalled();
    await updates.runTasks();
    expect(changed).toHaveBeenCalledTimes(1);
    document.notifyFullyActiveStateChanged();
    updates.runBackground();
    await updates.runTasks();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('drops queued change delivery when the Document is destroyed', async () => {
    const browser = await createBrowser();
    const status = await browser.window.navigator.permissions.query({ name: 'persistent-storage' });
    const changed = vi.fn();
    status.onchange = changed;
    const updates = captureUpdates(getRelevantRealm(browser.window).env);
    const { env } = updates;
    const document = env.getAssociatedDocument()!;
    env.queueTask('permissions', () => { document.destroy(); });
    env.userAgent.storagePersistence.setPermission(env.origin, 'granted');
    updates.runBackground();
    expect(env.responsibleEventLoop.getTaskQueue(permissionsTaskSource).size).toBe(2);
    await updates.runTasks();
    expect(changed).not.toHaveBeenCalled();
    expect(env.responsibleEventLoop.getTaskQueue(permissionsTaskSource).size).toBe(0);
    env.userAgent.storagePersistence.setPermission(env.origin, 'denied');
    updates.runBackground();
    expect(env.responsibleEventLoop.getTaskQueue(permissionsTaskSource).size).toBe(0);
    expect(status.state).toBe('granted');
  });

  it('uses the status owner after a borrowed query, independently of the query receiver', async () => {
    const first = await createBrowser();
    const second = await createBrowser();
    const status = await observeBrowletPromise(second.window,
      second.window.Permissions.prototype.query.call(first.window.navigator.permissions, { name: 'persistent-storage' }));
    const firstUpdates = captureUpdates(getRelevantRealm(first.window).env);
    const secondUpdates = captureUpdates(getRelevantRealm(second.window).env);
    const changed = vi.fn();
    status.onchange = changed;
    firstUpdates.env.userAgent.storagePersistence.setPermission(firstUpdates.env.origin, 'denied');
    firstUpdates.runBackground();
    await firstUpdates.runTasks();
    expect(status.state).toBe('prompt');
    expect(changed).not.toHaveBeenCalled();
    secondUpdates.env.userAgent.storagePersistence.setPermission(secondUpdates.env.origin, 'granted');
    secondUpdates.runBackground();
    expect(firstUpdates.env.responsibleEventLoop.getTaskQueue(permissionsTaskSource).size).toBe(0);
    expect(secondUpdates.env.responsibleEventLoop.getTaskQueue(permissionsTaskSource).size).toBe(1);
    await secondUpdates.runTasks();
    expect(status.state).toBe('granted');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls[0]![0]).toBeInstanceOf(second.window.Event);
  });

  it('reuses a feature query override when non-store permission inputs change', async () => {
    const browser = await createBrowser();
    const env = getRelevantRealm(browser.window).env;
    let state: PermissionState = 'prompt';
    env.userAgent.permissionStore = new PermissionStore([new PermissionFeature('persistent-storage', originPermissionKey, {
      query: (_descriptor, status) => { status.state = state; },
    })]);
    const status = await browser.window.navigator.permissions.query({ name: 'persistent-storage' });
    const changed = vi.fn();
    status.onchange = changed;
    const updates = captureUpdates(env);
    state = 'denied';
    env.userAgent.notifyPermissionStateChanged('unrelated');
    updates.runBackground();
    expect(status.state).toBe('prompt');
    env.userAgent.notifyPermissionStateChanged('persistent-storage');
    updates.runBackground();
    await updates.runTasks();
    expect(status.state).toBe('denied');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(env.userAgent.permissionStore.size).toBe(0);
  });

  it('retains exactly the results with change listeners, including handler, once, and abort removal', async () => {
    const browser = await createBrowser();
    const status = await browser.window.navigator.permissions.query({ name: 'persistent-storage' });
    const implementation = unwrap<PermissionStatusImpl>(status);
    const env = getRelevantRealm(status).env;
    const retained = env.getWindowOrWorkerGlobalScopeMixin().permissionStatuses;
    const listener = () => {};
    expect([...env.userAgent.permissionStatuses.values()]).toContain(implementation);
    expect(retained.has(implementation)).toBe(false);
    status.addEventListener('unrelated', listener);
    status.addEventListener('change', null);
    expect(retained.has(implementation)).toBe(false);
    status.onchange = listener;
    expect(retained.has(implementation)).toBe(true);
    status.addEventListener('change', listener);
    status.onchange = null;
    expect(retained.has(implementation)).toBe(true);
    status.removeEventListener('change', listener);
    expect(retained.has(implementation)).toBe(false);

    status.addEventListener('change', listener, { once: true });
    expect(retained.has(implementation)).toBe(true);
    status.dispatchEvent(new browser.window.Event('change'));
    expect(retained.has(implementation)).toBe(false);
    const controller = new browser.window.AbortController();
    status.addEventListener('change', listener, { signal: controller.signal });
    expect(retained.has(implementation)).toBe(true);
    controller.abort();
    expect(retained.has(implementation)).toBe(false);
    status.addEventListener('change', listener, { signal: controller.signal });
    expect(retained.has(implementation)).toBe(false);

    status.addEventListener('change', listener, { capture: true });
    status.removeEventListener('change', listener);
    expect(retained.has(implementation)).toBe(true);
    implementation.removeAllEventListeners();
    expect(retained.has(implementation)).toBe(false);
  });
});

/** Control only background work; delivery still uses the real permissions task queue. */
function captureUpdates(env: BrowletEnvironment) {
  const background: (() => void)[] = [];
  vi.spyOn(env, 'runInParallel').mockImplementation((steps) => { background.push(steps); });
  return {
    env,
    runBackground() { while (background.length) background.shift()!(); },
    async runTasks() {
      // Awaiting query can resume inside its checkpoint; leave that turn before advancing the loop.
      await new Promise<void>((resolve) => { setImmediate(resolve); });
      while (env.responsibleEventLoop.runTaskTurn()) { /* Drain runnable tasks. */ }
    },
  };
}

async function createBrowser(url = 'https://example.test/') {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate(url);
  return browser;
}
