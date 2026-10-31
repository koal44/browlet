import { describe, expect, it, vi } from 'vitest';

import { areSameOrigin, obtainURLOrigin, parseURL, type Origin } from '../../src/url/index';
import {
  PermissionFeature, originPermissionKey, PermissionStore,
  type PermissionEnvironment, type PermissionUserAgent, type PermissionDescriptor,
} from '../../src/permissions/index';

import { createPermissionEnvironment, createPermissionUserAgent } from '../support/permissions';

const descriptor = { name: 'test-feature' };

describe('Permissions Appendix B: set a permission', () => {
  it.each(['granted', 'denied', 'prompt'] as const)('queues %s, applies it once, and waits for every matching global', async (state) => {
    const userAgent = createUserAgent();
    const first = createEnvironment(userAgent);
    const second = createEnvironment(userAgent, 'https://top.test:443/another');
    const wrongKey = createEnvironment(userAgent, 'https://other.test/');
    const wrongAgent = createEnvironment(createUserAgent());
    const write = vi.spyOn(userAgent.permissionStore, 'setEntry');
    const result = userAgent.permissionStore.setPermission(descriptor, state, originFor('https://top.test/'), [first.env, second.env, wrongKey.env, wrongAgent.env], userAgent);
    let complete = false;
    result.observe(() => { complete = true; }, () => {});

    expect(userAgent.permissionStore.size).toBe(0);
    expect(first.tasks).toHaveLength(1);
    expect(second.tasks).toHaveLength(1);
    expect(wrongKey.tasks).toEqual([]);
    expect(wrongAgent.tasks).toEqual([]);
    first.tasks.shift()!();
    await Promise.resolve();
    expect(complete).toBe(false);
    expect(first.env.permissions.getPermissionState(descriptor)).toBe(state);
    second.tasks.shift()!();
    expect(await result).toBeUndefined();
    expect(write).toHaveBeenCalledExactlyOnceWith(descriptor, originFor('https://top.test/'), state);
    expect(complete).toBe(true);
    expect(wrongAgent.env.userAgent.permissionStore.size).toBe(0);
  });

  it('uses feature-defined compound keys and preserves descriptor aspects', async () => {
    interface Descriptor extends PermissionDescriptor { detailed: boolean; }
    interface Key { top: Origin; embedded: Origin; }
    const feature = new PermissionFeature<Descriptor, Key>('test-feature', {
      isKey: (value): value is Key => typeof value === 'object' && value !== null && 'top' in value && 'embedded' in value,
      generate: (top, embedded) => ({ top, embedded }),
      equals: (a, b) => areSameOrigin(a.top, b.top) && areSameOrigin(a.embedded, b.embedded),
    }, {
      descriptorsEqual: (a, b) => a.detailed === b.detailed,
    });
    const userAgent = createUserAgent(new PermissionStore([feature]));
    const matching = createEnvironment(userAgent, 'https://top.test/', 'https://frame.test/');
    const otherFrame = createEnvironment(userAgent, 'https://top.test/', 'https://other.test/');
    const otherTop = createEnvironment(userAgent, 'https://other.test/', 'https://frame.test/');
    const key = { top: originFor('https://top.test/'), embedded: originFor('https://frame.test/') };
    const detailed = { name: feature.name, detailed: true };
    const result = userAgent.permissionStore.setPermission(detailed, 'granted', key, [matching.env, otherFrame.env, otherTop.env], userAgent);
    expect(otherFrame.tasks).toEqual([]);
    expect(otherTop.tasks).toEqual([]);
    matching.tasks.shift()!();
    await result;
    expect(userAgent.permissionStore.getEntry(detailed, key)?.state).toBe('granted');
    expect(userAgent.permissionStore.getEntry({ name: feature.name, detailed: false }, key)).toBeNull();
  });

  it.each(['granted', 'denied', 'prompt'] as const)('retains %s when supplied settings do not match', async (state) => {
    const userAgent = createUserAgent(new PermissionStore([new PermissionFeature('test-feature', originPermissionKey, { defaultState: 'granted' })]));
    const { env, tasks } = createEnvironment(userAgent, 'https://other.test/');
    const other = createEnvironment(createUserAgent());
    const key = originFor('https://top.test/');
    await userAgent.permissionStore.setPermission(descriptor, state, key, [env, other.env], userAgent);
    expect(tasks).toEqual([]);
    expect(other.tasks).toEqual([]);
    expect(other.env.userAgent.permissionStore.size).toBe(0);
    expect(userAgent.permissionStore.getEntry(descriptor, env.topLevelOrigin)).toBeNull();
    expect(userAgent.permissionStore.getEntry(descriptor, key)?.state).toBe(state);
    expect(createEnvironment(userAgent).env.permissions.getPermissionState(descriptor)).toBe(state);
  });

  it.each(['granted', 'denied', 'prompt'] as const)('retains %s with an empty settings list and runs any feature cleanup', async (state) => {
    const revoke = vi.fn();
    const store = new PermissionStore([new PermissionFeature('test-feature', originPermissionKey, { defaultState: 'granted', revoke })]);
    const userAgent = createUserAgent(store);
    const key = originFor('https://top.test/');
    await userAgent.permissionStore.setPermission(descriptor, state, key, [], userAgent);
    expect(store.getEntry(descriptor, key)?.state).toBe(state);
    expect(createEnvironment(userAgent).env.permissions.getPermissionState(descriptor)).toBe(state);
    if (state === 'granted') expect(revoke).not.toHaveBeenCalled();
    else expect(revoke).toHaveBeenCalledExactlyOnceWith(descriptor, key);
  });

  it.each(['denied', 'prompt'] as const)('runs revocation once before retaining an explicit %s decision', async (state) => {
    const revoke = vi.fn();
    const store = new PermissionStore([new PermissionFeature('test-feature', originPermissionKey, { defaultState: 'granted', revoke })]);
    const userAgent = createUserAgent(store);
    const first = createEnvironment(userAgent);
    const second = createEnvironment(userAgent);
    const key = originFor('https://top.test/');
    const result = userAgent.permissionStore.setPermission(descriptor, state, key, [first.env, second.env], userAgent);
    expect(revoke).not.toHaveBeenCalled();
    first.tasks.shift()!();
    second.tasks.shift()!();
    await result;
    expect(revoke).toHaveBeenCalledExactlyOnceWith(descriptor, key);
    expect(store.getEntry(descriptor, key)?.state).toBe(state);
    expect(first.env.permissions.getPermissionState(descriptor)).toBe(state);
  });

  it('rejects invalid selection before queuing or writing anything', async () => {
    const userAgent = createUserAgent();
    const first = createEnvironment(userAgent);
    const unfinished = createEnvironment(userAgent);
    unfinished.env.topLevelOrigin = null;
    const key = originFor('https://top.test/');
    await expect(userAgent.permissionStore.setPermission({ name: 'unknown' }, 'granted', key, [first.env], userAgent)).rejects.toThrow('Unknown permission feature');
    await expect(userAgent.permissionStore.setPermission(descriptor, 'granted', 'not-a-key', [first.env], userAgent)).rejects.toThrow('Invalid permission key');
    await expect(userAgent.permissionStore.setPermission(descriptor, 'granted', key, [first.env, unfinished.env], userAgent)).rejects.toThrow('requires a top-level origin');
    expect(first.tasks).toEqual([]);
    expect(unfinished.tasks).toEqual([]);
    expect(userAgent.permissionStore.size).toBe(0);
  });

  it('rejects feature cleanup failures without retrying them in the other targets', async () => {
    const error = new Error('Feature cleanup failed');
    const revoke = vi.fn(() => { throw error; });
    const store = new PermissionStore([new PermissionFeature('test-feature', originPermissionKey, { revoke })]);
    const userAgent = createUserAgent(store);
    const first = createEnvironment(userAgent);
    const second = createEnvironment(userAgent);
    const key = originFor('https://top.test/');
    store.setEntry(descriptor, key, 'granted');
    const result = userAgent.permissionStore.setPermission(descriptor, 'denied', key, [first.env, second.env], userAgent);
    first.tasks.shift()!();
    second.tasks.shift()!();
    await expect(result).rejects.toBe(error);
    expect(revoke).toHaveBeenCalledOnce();
    expect(store.getEntry(descriptor, key)?.state).toBe('granted');
  });

  it('rejects feature cleanup failures without live settings and preserves the previous decision', async () => {
    const error = new Error('Feature cleanup failed');
    const store = new PermissionStore([new PermissionFeature('test-feature', originPermissionKey, { revoke: () => { throw error; } })]);
    const userAgent = createUserAgent(store);
    const key = originFor('https://top.test/');
    store.setEntry(descriptor, key, 'granted');
    await expect(userAgent.permissionStore.setPermission(descriptor, 'denied', key, [], userAgent)).rejects.toBe(error);
    expect(store.getEntry(descriptor, key)?.state).toBe('granted');
  });
});

function createUserAgent(permissionStore = new PermissionStore([new PermissionFeature('test-feature', originPermissionKey)])): PermissionUserAgent {
  return createPermissionUserAgent(permissionStore);
}

function createEnvironment(userAgent: PermissionUserAgent, top = 'https://top.test/', embedded = 'https://frame.test/'): {
  env: PermissionEnvironment;
  tasks: (() => void)[];
} {
  const tasks: (() => void)[] = [];
  const env = createPermissionEnvironment(userAgent, top, embedded);
  env.queueTask = (source, steps) => {
    expect(source).toBe('permissions');
    tasks.push(steps);
    return { remove() { const i = tasks.indexOf(steps); if (i !== -1) tasks.splice(i, 1); } };
  };
  return { env, tasks };
}

function originFor(url: string): Origin {
  return obtainURLOrigin(parseURL(url).url!);
}
