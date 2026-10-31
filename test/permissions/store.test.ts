import { describe, expect, it, vi } from 'vitest';

import { areSameOrigin, createOpaqueOrigin, obtainURLOrigin, parseURL, type Origin } from '../../src/url/index';
import {
  PermissionStore, defaultPermissionState, PermissionFeature, originPermissionKey,
  type PermissionDescriptor, type PermissionState,
} from '../../src/permissions/index';

const features = [
  new PermissionFeature('persistent-storage', originPermissionKey),
  new PermissionFeature('geolocation', originPermissionKey, { descriptorsEqual: () => true }),
  new PermissionFeature('missing', originPermissionKey),
];

describe('Permissions §§3.1–3.2: states and permission store', () => {
  it('notifies the owner after writes/removals and ignores absent removals', () => {
    const key = originFor('https://example.test/');
    const descriptor = { name: 'persistent-storage' };
    const changes: (PermissionState | null)[] = [];
    const store = new PermissionStore(features, (name) => {
      expect(name).toBe(descriptor.name);
      changes.push(store.getEntry(descriptor, key)?.state ?? null);
    });
    store.setEntry(descriptor, key, 'granted');
    store.setEntry(descriptor, key, 'denied');
    store.removeEntry(descriptor, key);
    store.removeEntry(descriptor, key);
    expect(changes).toEqual(['granted', 'denied', null]);
  });

  it('starts empty and leaves the missing-entry state decision to the caller', () => {
    const store = new PermissionStore(features);
    expect(defaultPermissionState).toBe('prompt');
    expect(store.size).toBe(0);
    expect([...store]).toEqual([]);
    expect(store.getEntry({ name: 'persistent-storage' }, originFor('https://example.test/'))).toBeNull();
    expect(store.size).toBe(0);
  });

  it.each<PermissionState>(['granted', 'denied', 'prompt'])('retains an explicit %s entry', (state) => {
    const store = new PermissionStore(features);
    const descriptor = { name: 'persistent-storage' };
    const key = originFor('https://example.test/');
    store.setEntry(descriptor, key, state);
    expect(store.getEntry({ ...descriptor }, key)).toEqual({ descriptor, key, state });
    expect(store.size).toBe(1);
  });

  it('replaces an equal descriptor/key pair without duplicating it or moving its position', () => {
    const store = new PermissionStore(features);
    const descriptor = { name: 'persistent-storage' };
    const firstKey = originFor('https://example.test/first');
    const otherKey = originFor('https://other.test/');
    store.setEntry(descriptor, firstKey, 'granted');
    store.setEntry(descriptor, otherKey, 'prompt');
    const originalEntry = store.getEntry(descriptor, firstKey)!;
    const replacementDescriptor = { ...descriptor };
    const replacementKey = originFor('https://example.test:443/second');

    store.setEntry(replacementDescriptor, replacementKey, 'denied');

    const replacement = store.getEntry(descriptor, firstKey)!;
    expect(replacement).not.toBe(originalEntry);
    expect(replacement.descriptor).toBe(replacementDescriptor);
    expect(replacement.key).toBe(replacementKey);
    expect(originalEntry.state).toBe('granted');
    expect([...store]).toEqual([
      { descriptor, key: replacementKey, state: 'denied' },
      { descriptor, key: otherKey, state: 'prompt' },
    ]);
    expect(store.size).toBe(2);
  });

  it('isolates feature names and unequal security origins', () => {
    const store = new PermissionStore(features);
    const key = originFor('https://example.test/');
    const descriptor = { name: 'persistent-storage' };
    store.setEntry(descriptor, key, 'granted');
    for (const url of ['http://example.test/', 'https://example.test:444/', 'https://other.test/']) {
      expect(store.getEntry(descriptor, originFor(url))).toBeNull();
    }
    // The store itself enforces names even if a feature comparator has no aspects to compare.
    expect(store.getEntry({ name: 'geolocation' }, key)).toBeNull();
    store.setEntry({ name: 'geolocation' }, key, 'denied');
    expect(store.getEntry(descriptor, key)?.state).toBe('granted');
    expect(store.size).toBe(2);
  });

  it('compares opaque origin identities without collapsing them to their null serialization', () => {
    const store = new PermissionStore(features);
    const descriptor = { name: 'persistent-storage' };
    const key = createOpaqueOrigin();
    store.setEntry(descriptor, key, 'granted');
    expect(store.getEntry(descriptor, { ...key })?.state).toBe('granted');
    expect(store.getEntry(descriptor, createOpaqueOrigin())).toBeNull();
  });

  it('removes only the matching entry and appends a later reinsertion', () => {
    const store = new PermissionStore(features);
    const first = { name: 'persistent-storage' };
    const second = { name: 'geolocation' };
    const key = originFor('https://example.test/');
    store.setEntry(first, key, 'granted');
    store.setEntry(second, key, 'denied');
    store.removeEntry({ name: 'missing' }, key);
    store.removeEntry(first, originFor('https://other.test/'));
    expect(store.size).toBe(2);
    store.removeEntry({ ...first }, originFor('https://example.test:443/'));
    store.removeEntry(first, key);
    expect(store.getEntry(first, key)).toBeNull();
    expect(store.getEntry(second, key)?.state).toBe('denied');
    expect(store.size).toBe(1);
    store.setEntry(first, key, 'prompt');
    expect([...store].map(({ descriptor }) => descriptor.name)).toEqual(['geolocation', 'persistent-storage']);
  });

  it('uses feature-supplied descriptor comparison for aspects without inferring permission grants', () => {
    interface MidiDescriptor extends PermissionDescriptor { sysex: boolean; }
    const feature = new PermissionFeature<MidiDescriptor>('midi', originPermissionKey, {
      descriptorType: 'MidiPermissionDescriptor',
      descriptorsEqual: (first, second) => first.sysex === second.sysex,
    });
    const store = new PermissionStore([feature]);
    const key = originFor('https://example.test/');
    store.setEntry({ name: 'midi', sysex: true }, key, 'granted');
    expect(store.getEntry({ name: 'midi', sysex: false }, key)).toBeNull();
    store.setEntry({ name: 'midi', sysex: false }, key, 'denied');
    store.setEntry({ sysex: true, name: 'midi' }, key, 'prompt');
    expect(store.size).toBe(2);
    expect(store.getEntry({ name: 'midi', sysex: true }, key)?.state).toBe('prompt');
    expect(store.getEntry({ name: 'midi', sysex: false }, key)?.state).toBe('denied');
  });

  it('checks both key types before invoking the feature comparison', () => {
    const descriptor = { name: 'test-feature' };
    const keysEqual = vi.fn((first: string, second: string) => first === second);
    const feature = new PermissionFeature('test-feature', {
      isKey: (value): value is string => typeof value === 'string',
      generate: () => 'one',
      equals: keysEqual,
    });
    const store = new PermissionStore([feature]);
    store.setEntry(descriptor, 'one', 'granted');
    expect(store.getEntry(descriptor, 1)).toBeNull();
    expect(keysEqual).not.toHaveBeenCalled();
    expect(store.getEntry(descriptor, 'one')?.state).toBe('granted');
    expect(keysEqual).toHaveBeenCalledExactlyOnceWith('one', 'one');

    // Stored keys are checked too. A malformed internal entry cannot reach comparison.
    const malformedStore = new PermissionStore([feature]);
    malformedStore.setEntry(descriptor, 1, 'granted');
    keysEqual.mockClear();
    expect(malformedStore.getEntry(descriptor, 'one')).toBeNull();
    expect(keysEqual).not.toHaveBeenCalled();
  });

  it('supports a compound key through feature rules without using object identity or stringification', () => {
    type Key = { topLevel: Origin; embedded: Origin; };
    const feature = new PermissionFeature<PermissionDescriptor, Key>('test-feature', {
      isKey: (value): value is Key => typeof value === 'object' && value !== null &&
        'topLevel' in value && 'embedded' in value &&
        originPermissionKey.isKey(value.topLevel) && originPermissionKey.isKey(value.embedded),
      generate: (topLevel, embedded) => ({ topLevel, embedded }),
      equals: (first, second) => areSameOrigin(first.topLevel, second.topLevel) &&
        areSameOrigin(first.embedded, second.embedded),
    });
    const store = new PermissionStore([feature]);
    const descriptor = { name: 'test-feature' };
    const key = feature.key.generate(originFor('https://top.test/'), originFor('https://frame.test/'));
    store.setEntry(descriptor, key, 'granted');
    const equalKey = { topLevel: originFor('https://top.test/other'), embedded: originFor('https://frame.test/') };
    expect(store.getEntry({ ...descriptor }, equalKey)?.state).toBe('granted');
    expect(store.getEntry(descriptor, { ...key, embedded: originFor('https://other.test/') })).toBeNull();
    expect(store.getEntry(descriptor, { ...key, topLevel: originFor('https://other.test/') })).toBeNull();
    store.removeEntry(descriptor, equalKey);
    expect(store.size).toBe(0);
  });

  it('does not share entries between independent stores', () => {
    const first = new PermissionStore(features);
    const second = new PermissionStore(features);
    const descriptor = { name: 'persistent-storage' };
    const key = originFor('https://example.test/');
    first.setEntry(descriptor, key, 'granted');
    expect(second.getEntry(descriptor, key)).toBeNull();
    second.setEntry(descriptor, key, 'denied');
    expect(first.getEntry(descriptor, key)?.state).toBe('granted');
  });
});

function originFor(url: string): Origin {
  return obtainURLOrigin(parseURL(url).url!);
}
