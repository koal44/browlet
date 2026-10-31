import { afterEach, describe, expect, it, vi } from 'vitest';


import { StorageShelf, type LocalStorageBucket } from '../../../src/storage/index';
import { Browlet } from '../../../src/browlet/browlet';
import { permissionsTaskSource } from '../../../src/browlet/scripting/tasks';
import { getRelevantRealm } from '../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Permissions §5.2: browser host consent and task ownership', () => {
  it('accepts asynchronous Node host consent and saves it on the requesting Document task queue', async () => {
    const answer = Promise.withResolvers<boolean>();
    const permissionPrompt = vi.fn(() => answer.promise);
    const browser = new Browlet({ route: () => '', permissionPrompt });
    await browser.navigate('https://example.test/');
    const env = getRelevantRealm(browser.window).env;
    const store = env.userAgent.permissionStore;
    const bucket = StorageShelf.obtainLocal(env)!.bucketMap.get('default') as LocalStorageBucket;
    const request = env.permissions.requestPermissionToUse('persistent-storage');
    expect(permissionPrompt).toHaveBeenCalledExactlyOnceWith({
      descriptor: { name: 'persistent-storage' }, origin: 'https://example.test', topLevelOrigin: 'https://example.test',
    });
    expect(store.size).toBe(0);
    answer.resolve(true);
    expect(await request).toBe('granted');
    expect(env.permissions.getCurrentPermissionState('persistent-storage')).toBe('prompt');
    const tasks = [...env.responsibleEventLoop.getTaskQueue(permissionsTaskSource)];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.document).toBe(env.getAssociatedDocument());

    await new Promise<void>((resolve) => { env.queueTask('permissions', resolve); });
    expect(env.permissions.getCurrentPermissionState('persistent-storage')).toBe('granted');
    expect(env.userAgent.storagePersistence.getPermission(env.origin)).toBe('granted');
    // Permission alone does not perform Storage.persist() or change a bucket's mode.
    expect(bucket.mode).toBe('best-effort');
    expect(await env.permissions.requestPermissionToUse('persistent-storage')).toBe('granted');
    expect(permissionPrompt).toHaveBeenCalledOnce();
  });

  it('denies and records a new request when no host prompt is configured', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/');
    const env = getRelevantRealm(browser.window).env;
    expect(await env.permissions.requestPermissionToUse('persistent-storage')).toBe('denied');
    await new Promise<void>((resolve) => { env.queueTask('permissions', resolve); });
    expect(env.userAgent.storagePersistence.getPermission(env.origin)).toBe('denied');
  });

  it.each(['throw', 'reject', 'invalid'] as const)('does not record host callback %s as a user denial', async (kind) => {
    const error = new Error('Host prompt failed');
    const browser = new Browlet({
      route: () => '',
      permissionPrompt: () => {
        if (kind === 'throw') throw error;
        if (kind === 'reject') return Promise.reject(error);
        return 'granted' as unknown as boolean;
      },
    });
    await browser.navigate('https://example.test/');
    const env = getRelevantRealm(browser.window).env;
    const request = env.permissions.requestPermissionToUse('persistent-storage');
    if (kind === 'invalid') await expect(request).rejects.toThrow('must return a boolean');
    else await expect(request).rejects.toBe(error);
    expect(env.userAgent.permissionStore.size).toBe(0);
    expect(env.responsibleEventLoop.getTaskQueue(permissionsTaskSource).size).toBe(0);
  });

  it('discards a queued decision when its requesting Document is destroyed before delivery', async () => {
    const browser = new Browlet({ route: () => '', permissionPrompt: () => true });
    await browser.navigate('https://example.test/');
    const env = getRelevantRealm(browser.window).env;
    const destroyed = new Promise<void>((resolve) => {
      env.queueTask('permissions', () => { env.getAssociatedDocument()!.destroy(); resolve(); });
    });
    expect(await env.permissions.requestPermissionToUse('persistent-storage')).toBe('granted');
    await destroyed;
    expect(env.userAgent.permissionStore.size).toBe(0);
    expect(env.responsibleEventLoop.getTaskQueue(permissionsTaskSource).size).toBe(0);
  });
});
