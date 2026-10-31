import { describe, expect, it, vi } from 'vitest';

import { obtainURLOrigin, parseURL, type Origin } from '../../src/url/index';
import {
  PermissionFeature, originPermissionKey, PermissionStore,
  type PermissionDescriptor, type PermissionEnvironment, type PermissionState,
} from '../../src/permissions/index';

import { createPermissionEnvironment, createPermissionUserAgent } from '../support/permissions';

describe('Permissions §5.1: reading the current permission state', () => {
  it('uses the feature default without creating a decision or asking for permission', () => {
    const env = createEnvironment([
      new PermissionFeature('test-feature', originPermissionKey),
      new PermissionFeature('default-denied', originPermissionKey, { defaultState: 'denied' }),
    ]);
    expect(env.permissions.getCurrentPermissionState('test-feature')).toBe('prompt');
    expect(env.permissions.getPermissionState({ name: 'test-feature' })).toBe('prompt');
    expect(env.permissions.getCurrentPermissionState('default-denied')).toBe('denied');
    expect(env.userAgent.permissionStore.size).toBe(0);
  });

  it('denies non-secure settings before consulting features, policy, or the store', () => {
    const env = createEnvironment([]);
    env.isSecureContext = false;
    env.topLevelOrigin = null;
    const lookup = vi.spyOn(env.userAgent.permissionStore, 'getFeature');
    const policy = vi.spyOn(env, 'isAllowedToUse');
    expect(env.permissions.getCurrentPermissionState('not-installed')).toBe('denied');
    expect(lookup).not.toHaveBeenCalled();
    expect(policy).not.toHaveBeenCalled();
  });

  it.each<PermissionState>(['granted', 'denied', 'prompt'])('returns a stored %s decision before the fallback', (state) => {
    const constrainState = vi.fn((state: PermissionState) => state);
    const env = createEnvironment([new PermissionFeature('test-feature', originPermissionKey, { constrainState })]);
    env.userAgent.permissionStore.setEntry({ name: 'test-feature' }, env.topLevelOrigin, state);
    expect(env.permissions.getCurrentPermissionState('test-feature')).toBe(state);
    expect(constrainState).not.toHaveBeenCalled();
    expect(env.userAgent.permissionStore.size).toBe(1);
  });

  it('checks Document policy before returning a grant or generating its key', () => {
    const feature = new PermissionFeature('test-feature', originPermissionKey, { policyControlled: true });
    const env = createEnvironment([feature]);
    env.userAgent.permissionStore.setEntry({ name: feature.name }, env.topLevelOrigin, 'granted');
    const isAllowedToUse = vi.fn(() => false);
    env.isAllowedToUse = isAllowedToUse;
    const lookup = vi.spyOn(env.userAgent.permissionStore, 'getEntry');
    expect(env.permissions.getCurrentPermissionState(feature.name)).toBe('denied');
    expect(isAllowedToUse).toHaveBeenCalledExactlyOnceWith(feature.name);
    expect(lookup).not.toHaveBeenCalled();

    isAllowedToUse.mockReturnValue(true);
    expect(env.permissions.getCurrentPermissionState(feature.name)).toBe('granted');
    expect(lookup).toHaveBeenCalledExactlyOnceWith({ name: feature.name }, env.topLevelOrigin);
  });

  it('does not add a Document policy check for non-policy features or globals without a Document', () => {
    const env = createEnvironment([
      new PermissionFeature('test-feature', originPermissionKey),
      new PermissionFeature('policy-feature', originPermissionKey, { policyControlled: true }),
    ]);
    const policy = vi.spyOn(env, 'isAllowedToUse');
    expect(env.permissions.getCurrentPermissionState('test-feature')).toBe('prompt');
    expect(policy).not.toHaveBeenCalled();
    expect(env.permissions.getCurrentPermissionState('policy-feature')).toBe('prompt');
    expect(policy).toHaveBeenCalledOnce();
  });

  it('propagates an unavailable policy evaluator instead of treating it as permission', () => {
    const env = createEnvironment([new PermissionFeature('test-feature', originPermissionKey, { policyControlled: true })]);
    const unavailable = new Error('Policy evaluation unavailable');
    env.isAllowedToUse = () => { throw unavailable; };
    expect(() => env.permissions.getCurrentPermissionState('test-feature')).toThrow(unavailable);
    expect(env.userAgent.permissionStore.size).toBe(0);
  });

  it('passes top-level and requesting origins to the feature key generator in order', () => {
    const generate = vi.fn((top: Origin, embedded: Origin) => ({ top, embedded }));
    const feature = new PermissionFeature('test-feature', {
      isKey: (value): value is { top: Origin; embedded: Origin; } =>
        typeof value === 'object' && value !== null && 'top' in value && 'embedded' in value,
      generate,
      equals: (a, b) => a.top === b.top && a.embedded === b.embedded,
    });
    const env = createEnvironment([feature]);
    env.userAgent.permissionStore.setEntry({ name: feature.name }, {
      top: env.topLevelOrigin, embedded: env.origin,
    }, 'granted');
    expect(env.permissions.getCurrentPermissionState(feature.name)).toBe('granted');
    expect(generate).toHaveBeenCalledExactlyOnceWith(env.topLevelOrigin, env.origin);
    env.origin = originFor('https://different.test/');
    expect(env.permissions.getCurrentPermissionState(feature.name)).toBe('prompt');
  });

  it('keys default features by the top-level origin rather than the requesting origin', () => {
    const env = createEnvironment([new PermissionFeature('test-feature', originPermissionKey)]);
    env.userAgent.permissionStore.setEntry({ name: 'test-feature' }, env.origin, 'granted');
    expect(env.permissions.getCurrentPermissionState('test-feature')).toBe('prompt');
    env.userAgent.permissionStore.setEntry({ name: 'test-feature' }, env.topLevelOrigin, 'denied');
    expect(env.permissions.getCurrentPermissionState('test-feature')).toBe('denied');
  });

  it('passes converted aspects and settings to the feature constraints for an absent decision', () => {
    interface TestDescriptor extends PermissionDescriptor { restricted: boolean; }
    const constrainState = vi.fn((state: PermissionState, descriptor: TestDescriptor) =>
      descriptor.restricted ? 'denied' : state);
    const feature = new PermissionFeature<TestDescriptor>('test-feature', originPermissionKey, {
      descriptorType: 'TestPermissionDescriptor',
      descriptorsEqual: (a, b) => a.restricted === b.restricted,
      constrainState,
    });
    const env = createEnvironment([feature]);
    const descriptor: TestDescriptor = { name: feature.name, restricted: true };
    expect(env.permissions.getPermissionState(descriptor)).toBe('denied');
    expect(constrainState).toHaveBeenCalledExactlyOnceWith('prompt', descriptor, env);
    expect(env.permissions.getPermissionState({ name: feature.name, restricted: false })).toBe('prompt');
    expect(env.userAgent.permissionStore.size).toBe(0);
  });

  it('requires an installed feature and initialized top-level origin for secure settings', () => {
    const env = createEnvironment([new PermissionFeature('test-feature', originPermissionKey)]);
    expect(() => env.permissions.getCurrentPermissionState('not-installed')).toThrow('Unknown permission feature');
    env.topLevelOrigin = null;
    expect(() => env.permissions.getCurrentPermissionState('test-feature')).toThrow('requires a top-level origin');
  });
});

function createEnvironment(features: PermissionFeature[]): PermissionEnvironment {
  return createPermissionEnvironment(createPermissionUserAgent(new PermissionStore(features)));
}

function originFor(url: string): Origin {
  return obtainURLOrigin(parseURL(url).url!);
}
