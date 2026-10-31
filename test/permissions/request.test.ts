import { describe, expect, it, vi } from 'vitest';

import { InternalPromise, internalType } from '../../src/infra/index';
import { obtainURLOrigin, parseURL, type Origin } from '../../src/url/index';
import {
  PermissionFeature, originPermissionKey, PermissionStore, type PermissionDescriptor, type PermissionEnvironment,
} from '../../src/permissions/index';
import { persistentStoragePermission } from '../../src/storage/index';

import { createPermissionEnvironment, createPermissionUserAgent } from '../support/permissions';

describe('Permissions §5.2: requesting permission', () => {
  it.each(['granted', 'denied'] as const)('returns an existing %s state without asking or saving again', async (state) => {
    const canRequest = vi.fn(() => false);
    const { env, tasks } = createEnvironment([new PermissionFeature('test-feature', originPermissionKey, { canRequest })]);
    const store = env.userAgent.permissionStore;
    store.setEntry({ name: 'test-feature' }, env.topLevelOrigin, state);
    const set = vi.spyOn(store, 'setEntry');
    const prompt = vi.spyOn(env.userAgent, 'promptForPermission');

    expect(await env.permissions.requestPermissionToUse('test-feature')).toBe(state);
    expect(prompt).not.toHaveBeenCalled();
    expect(canRequest).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(tasks).toEqual([]);
  });

  it.each([true, false])('waits for consent (%s), then queues saving separately from returning the answer', async (allowed) => {
    const { env, tasks } = createEnvironment();
    const answer = InternalPromise.withResolvers(internalType<boolean>());
    const prompt = vi.spyOn(env.userAgent, 'promptForPermission').mockReturnValue(answer.promise);
    const descriptor = { name: 'test-feature' };
    const result = env.permissions.requestPermission(descriptor);
    expect(prompt).toHaveBeenCalledExactlyOnceWith(descriptor, env);
    expect(env.userAgent.permissionStore.size).toBe(0);
    expect(tasks).toEqual([]);

    answer.resolve(allowed);
    const decision = allowed ? 'granted' : 'denied';
    expect(await result).toBe(decision);
    expect(env.permissions.getPermissionState(descriptor)).toBe('prompt');
    expect(tasks).toHaveLength(1);
    tasks.shift()!();
    expect(env.permissions.getPermissionState(descriptor)).toBe(decision);
  });

  it.each(['insecure', 'policy'] as const)('does not ask or save when %s settings deny access', async (restriction) => {
    const { env, tasks } = createEnvironment([new PermissionFeature('test-feature', originPermissionKey, { policyControlled: true })]);
    env.isSecureContext = restriction !== 'insecure';
    env.isAllowedToUse = () => false;
    const prompt = vi.spyOn(env.userAgent, 'promptForPermission');
    expect(await env.permissions.requestPermissionToUse('test-feature')).toBe('denied');
    expect(prompt).not.toHaveBeenCalled();
    expect(tasks).toEqual([]);
    expect(env.userAgent.permissionStore.size).toBe(0);
  });

  it('retains descriptor aspects and uses the feature key for the queued update', async () => {
    interface TestDescriptor extends PermissionDescriptor { precise: boolean; }
    const generate = vi.fn((top: Origin, embedded: Origin) => ({ top, embedded }));
    const feature = new PermissionFeature<TestDescriptor, { top: Origin; embedded: Origin; }>('test-feature', {
      isKey: (value): value is { top: Origin; embedded: Origin; } =>
        typeof value === 'object' && value !== null && 'top' in value && 'embedded' in value,
      generate,
      equals: (a, b) => a.top === b.top && a.embedded === b.embedded,
    }, {
      descriptorsEqual: (a, b) => a.precise === b.precise,
    });
    const { env, tasks } = createEnvironment([feature]);
    const descriptor: TestDescriptor = { name: feature.name, precise: true };
    const prompt = vi.spyOn(env.userAgent, 'promptForPermission');
    expect(await env.permissions.requestPermission(descriptor)).toBe('granted');
    expect(prompt).toHaveBeenCalledExactlyOnceWith(descriptor, env);
    expect(generate).toHaveBeenNthCalledWith(1, env.topLevelOrigin, env.origin);
    expect(generate).toHaveBeenNthCalledWith(2, env.topLevelOrigin, env.origin);
    tasks.shift()!();
    const entry = [...env.userAgent.permissionStore][0]!;
    expect(entry.descriptor).toBe(descriptor);
    expect(entry.key).toEqual({ top: env.topLevelOrigin, embedded: env.origin });
    expect(env.permissions.getPermissionState({ name: feature.name, precise: false })).toBe('prompt');
  });

  it('declines new cross-origin storage requests without recording a denial for that origin', async () => {
    const { env, tasks } = createEnvironment([persistentStoragePermission]);
    const descriptor = { name: persistentStoragePermission.name };
    const prompt = vi.spyOn(env.userAgent, 'promptForPermission');
    expect(await env.permissions.requestPermission(descriptor)).toBe('denied');
    expect(prompt).not.toHaveBeenCalled();
    expect(env.userAgent.permissionStore.size).toBe(0);
    expect(tasks).toEqual([]);
    expect(env.permissions.getPermissionState(descriptor)).toBe('prompt');

    // Denying an embedded request must not prevent the same origin asking at top level.
    env.topLevelOrigin = originFor('https://requesting.test/another-path');
    expect(await env.permissions.requestPermission(descriptor)).toBe('granted');
    tasks.shift()!();
    expect(env.userAgent.permissionStore.getEntry(descriptor, env.origin)?.state).toBe('granted');

    // Match Chromium's new-consent gate, not Firefox's cross-origin query override.
    env.topLevelOrigin = originFor('https://top.test/');
    expect(await env.permissions.requestPermission(descriptor)).toBe('granted');
    expect(prompt).toHaveBeenCalledOnce();
    expect(tasks).toEqual([]);
  });

  it('keeps an explicitly stored prompt state when host policy rejects a new request', async () => {
    const { env, tasks } = createEnvironment([new PermissionFeature('test-feature', originPermissionKey, { canRequest: () => false })]);
    const descriptor = { name: 'test-feature' };
    env.userAgent.permissionStore.setEntry(descriptor, env.topLevelOrigin, 'prompt');
    const prompt = vi.spyOn(env.userAgent, 'promptForPermission');
    expect(await env.permissions.requestPermission(descriptor)).toBe('denied');
    expect(env.permissions.getPermissionState(descriptor)).toBe('prompt');
    expect(prompt).not.toHaveBeenCalled();
    expect(tasks).toEqual([]);
  });

  it.each(['throw', 'reject'] as const)('propagates a host %s without saving a user decision', async (kind) => {
    const { env, tasks } = createEnvironment();
    const error = new Error('Consent UI unavailable');
    vi.spyOn(env.userAgent, 'promptForPermission').mockImplementation(() => {
      if (kind === 'throw') throw error;
      return InternalPromise.reject(error, internalType<boolean>());
    });
    await expect(env.permissions.requestPermissionToUse('test-feature')).rejects.toBe(error);
    expect(env.userAgent.permissionStore.size).toBe(0);
    expect(tasks).toEqual([]);
  });

  it('propagates missing feature or settings initialization before asking', async () => {
    const { env, tasks } = createEnvironment();
    const prompt = vi.spyOn(env.userAgent, 'promptForPermission');
    await expect(env.permissions.requestPermissionToUse('not-installed')).rejects.toThrow('Unknown permission feature');
    env.topLevelOrigin = null;
    await expect(env.permissions.requestPermissionToUse('test-feature')).rejects.toThrow('requires a top-level origin');
    expect(prompt).not.toHaveBeenCalled();
    expect(tasks).toEqual([]);
  });
});

function createEnvironment(features: PermissionFeature[] = [new PermissionFeature('test-feature', originPermissionKey)]): {
  env: PermissionEnvironment;
  tasks: (() => void)[];
} {
  const tasks: (() => void)[] = [];
  const env = createPermissionEnvironment(createPermissionUserAgent(new PermissionStore(features)));
  env.queueTask = (source, steps) => {
    expect(source).toBe('permissions');
    tasks.push(steps);
    return { remove() { const index = tasks.indexOf(steps); if (index !== -1) tasks.splice(index, 1); } };
  };
  return { env, tasks };
}

function originFor(url: string): Origin {
  return obtainURLOrigin(parseURL(url).url!);
}
