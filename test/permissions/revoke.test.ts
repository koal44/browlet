import { describe, expect, it, vi } from 'vitest';

import { createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../src/url/index';
import {
  PermissionFeature, originPermissionKey, PermissionStore, type PermissionDescriptor,
} from '../../src/permissions/index';

import { createPermissionEnvironment, createPermissionUserAgent } from '../support/permissions';

describe('Permissions §5.4: reacting to withdrawn consent', () => {
  it('runs feature cleanup before removing the matching entry', () => {
    const descriptor = { name: 'test-feature' };
    const key = createOpaqueOrigin();
    const revoke = vi.fn((descriptor: PermissionDescriptor, key: unknown) => {
      expect(store.getEntry(descriptor, key)?.state).toBe('granted');
    });
    const store = new PermissionStore([new PermissionFeature(descriptor.name, originPermissionKey, { revoke })]);
    store.setEntry(descriptor, key, 'granted');

    store.revoke(descriptor, key);

    expect(revoke).toHaveBeenCalledExactlyOnceWith(descriptor, key);
    expect(store.getEntry(descriptor, key)).toBeNull();
  });

  it.each(['prompt', 'denied'] as const)('removes an override so state lookup returns the feature default %s', (defaultState) => {
    const descriptor = { name: 'test-feature' };
    const origin = obtainURLOrigin(parseURL('https://example.test/').url!);
    const store = new PermissionStore([new PermissionFeature(descriptor.name, originPermissionKey, { defaultState })]);
    const env = createPermissionEnvironment(createPermissionUserAgent(store), 'https://example.test/', 'https://example.test/');
    store.setEntry(descriptor, origin, 'granted');
    expect(env.permissions.getPermissionState(descriptor)).toBe('granted');

    // The absent feature-specific hook is not a recursive call to revoke().
    store.revoke(descriptor, origin);

    expect(env.permissions.getPermissionState(descriptor)).toBe(defaultState);
    expect(store.size).toBe(0);
  });

  it('matches descriptor aspects and custom keys without removing other decisions', () => {
    interface TestDescriptor extends PermissionDescriptor { precise: boolean; }
    interface TestKey { site: string; }
    const revoke = vi.fn((_descriptor: TestDescriptor, _key: TestKey) => {});
    const feature = new PermissionFeature<TestDescriptor, TestKey>('test-feature', {
      isKey: (value): value is TestKey => typeof value === 'object' && value !== null && 'site' in value,
      generate: () => ({ site: 'example' }),
      equals: (a, b) => a.site === b.site,
    }, {
      descriptorsEqual: (a, b) => a.precise === b.precise,
      revoke,
    });
    const store = new PermissionStore([feature, new PermissionFeature('other-feature', originPermissionKey)]);
    const descriptor = { name: feature.name, precise: true };
    const key = { site: 'example' };
    const otherAspect = { name: feature.name, precise: false };
    const otherKey = { site: 'other' };
    const otherFeature = { name: 'other-feature' };
    const origin = createOpaqueOrigin();
    store.setEntry(otherAspect, key, 'granted');
    store.setEntry(descriptor, key, 'granted');
    store.setEntry(descriptor, otherKey, 'denied');
    store.setEntry(otherFeature, origin, 'granted');
    const remaining = [...store].filter((entry) => entry.descriptor !== descriptor || entry.key !== key);
    const equivalentDescriptor = { ...descriptor };
    const equivalentKey = { ...key };

    store.revoke(equivalentDescriptor, equivalentKey);

    expect(revoke).toHaveBeenCalledExactlyOnceWith(equivalentDescriptor, equivalentKey);
    expect([...store]).toEqual(remaining);
    expect(store.getEntry(descriptor, key)).toBeNull();
  });

  it('compares origin keys by same-origin, not object identity', () => {
    const descriptor = { name: 'test-feature' };
    const store = new PermissionStore([new PermissionFeature(descriptor.name, originPermissionKey)]);
    const first = obtainURLOrigin(parseURL('https://example.test/first').url!);
    const same = obtainURLOrigin(parseURL('https://example.test:443/second').url!);
    const other = obtainURLOrigin(parseURL('https://other.test/').url!);
    store.setEntry(descriptor, first, 'granted');
    store.setEntry(descriptor, other, 'granted');
    store.revoke(descriptor, same);
    expect(store.getEntry(descriptor, first)).toBeNull();
    expect(store.getEntry(descriptor, other)?.state).toBe('granted');
  });

  it('does not remove a different opaque origin or allocate an entry for a missing decision', () => {
    const descriptor = { name: 'test-feature' };
    const store = new PermissionStore([new PermissionFeature(descriptor.name, originPermissionKey)]);
    const first = createOpaqueOrigin();
    store.setEntry(descriptor, first, 'granted');
    store.revoke(descriptor, createOpaqueOrigin());
    expect(store.getEntry(descriptor, first)?.state).toBe('granted');
    store.revoke(descriptor, { ...first });
    expect(store.size).toBe(0);
  });

  it('runs feature cleanup even without a stored entry and on repeated revocation', () => {
    const descriptor = { name: 'test-feature' };
    const key = createOpaqueOrigin();
    const revoke = vi.fn();
    const store = new PermissionStore([new PermissionFeature(descriptor.name, originPermissionKey, { revoke })]);
    store.revoke(descriptor, key);
    store.revoke(descriptor, key);
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(0);
  });

  it('keeps low-level removal separate from revocation side effects', () => {
    const descriptor = { name: 'test-feature' };
    const key = createOpaqueOrigin();
    const revoke = vi.fn();
    const store = new PermissionStore([new PermissionFeature(descriptor.name, originPermissionKey, { revoke })]);
    store.setEntry(descriptor, key, 'granted');
    store.removeEntry(descriptor, key);
    expect(revoke).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('propagates a feature cleanup failure before changing the permission entry', () => {
    const descriptor = { name: 'test-feature' };
    const key = createOpaqueOrigin();
    const error = new Error('Feature cleanup unavailable');
    const store = new PermissionStore([new PermissionFeature(descriptor.name, originPermissionKey, { revoke() { throw error; } })]);
    store.setEntry(descriptor, key, 'granted');
    expect(() => store.revoke(descriptor, key)).toThrow(error);
    expect(store.getEntry(descriptor, key)?.state).toBe('granted');
  });

  it('rejects unknown features and invalid keys before calling cleanup', () => {
    const descriptor = { name: 'test-feature' };
    const key = createOpaqueOrigin();
    const revoke = vi.fn();
    const store = new PermissionStore([new PermissionFeature(descriptor.name, originPermissionKey, { revoke })]);
    store.setEntry(descriptor, key, 'granted');
    expect(() => store.revoke({ name: 'unknown' }, key)).toThrow('Unknown permission feature');
    expect(() => store.revoke(descriptor, 'not-an-origin')).toThrow('Invalid permission key');
    expect(revoke).not.toHaveBeenCalled();
    expect(store.getEntry(descriptor, key)?.state).toBe('granted');
  });
});
