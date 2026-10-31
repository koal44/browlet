import { describe, expect, it } from 'vitest';

import { createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../src/url/index';
import { PermissionFeature, originPermissionKey, PermissionStore } from '../../src/permissions/index';
import { persistentStoragePermission } from '../../src/storage/index';

describe('Permissions §§3.3–4: powerful feature definitions', () => {
  it('uses the default descriptor, result, state, and top-level origin key', () => {
    const feature = new PermissionFeature('test-feature', originPermissionKey);
    const topLevel = obtainURLOrigin(parseURL('https://top.test/').url!);
    const embedded = obtainURLOrigin(parseURL('https://frame.test/').url!);
    expect(feature.descriptorType).toBe('PermissionDescriptor');
    expect(feature.resultType).toBe('PermissionStatus');
    expect(feature.defaultState).toBe('prompt');
    expect(feature.key.generate(topLevel, embedded)).toBe(topLevel);
    expect(feature.key.isKey(topLevel)).toBe(true);
    expect(feature.key.equals(topLevel, obtainURLOrigin(parseURL('https://top.test:443/elsewhere').url!))).toBe(true);
    expect(feature.key.equals(topLevel, embedded)).toBe(false);
    expect(feature.descriptorsEqual({ name: 'test-feature' }, { name: 'test-feature' })).toBe(true);
    expect(feature.descriptorsEqual({ name: 'test-feature' }, { name: 'other-feature' })).toBe(false);
  });

  it('recognizes opaque origin keys and preserves their identity', () => {
    const feature = new PermissionFeature('test-feature', originPermissionKey);
    const origin = createOpaqueOrigin();
    expect(feature.key.isKey(origin)).toBe(true);
    expect(feature.key.generate(origin, createOpaqueOrigin())).toBe(origin);
    expect(feature.key.equals(origin, { ...origin })).toBe(true);
    expect(feature.key.equals(origin, createOpaqueOrigin())).toBe(false);
    for (const value of [null, undefined, 'null', 1, {}, { kind: 'not-origin' }]) {
      expect(feature.key.isKey(value)).toBe(false);
    }
  });

  it('retains explicit feature defaults without inventing a permission store entry', () => {
    const feature = new PermissionFeature('test-feature', originPermissionKey, {
      descriptorType: 'TestPermissionDescriptor',
      resultType: 'TestPermissionStatus',
      defaultState: 'denied',
    });
    const store = new PermissionStore([feature]);
    expect(store.getFeature('test-feature')).toBe(feature);
    expect(feature.descriptorType).toBe('TestPermissionDescriptor');
    expect(feature.resultType).toBe('TestPermissionStatus');
    expect(feature.defaultState).toBe('denied');
    expect(store.getEntry({ name: 'test-feature' }, createOpaqueOrigin())).toBeNull();
    expect(store.size).toBe(0);
  });

  it('rejects ambiguous definitions and does not infer support for unknown names', () => {
    const feature = new PermissionFeature('test-feature', originPermissionKey);
    const definitions = [feature];
    const store = new PermissionStore(definitions);
    definitions.push(new PermissionFeature('another-feature', originPermissionKey));
    expect(store.getFeature('another-feature')).toBeUndefined();
    expect(store.getFeature('Test-Feature')).toBeUndefined();
    expect(() => new PermissionStore([feature, new PermissionFeature('test-feature', originPermissionKey)]))
      .toThrow('Duplicate permission feature');
    const descriptor = { name: 'unknown' };
    const key = createOpaqueOrigin();
    expect(() => store.getEntry(descriptor, key)).toThrow('Unknown permission feature');
    expect(() => store.setEntry(descriptor, key, 'granted')).toThrow('Unknown permission feature');
    expect(() => store.removeEntry(descriptor, key)).toThrow('Unknown permission feature');
    expect(store.size).toBe(0);
  });

  it('requires ASCII-lowercase names at definition time rather than normalizing author queries', () => {
    expect(() => new PermissionFeature('Test-Feature', originPermissionKey)).toThrow('ASCII lowercase');
    expect(() => new PermissionFeature('tést-feature', originPermissionKey)).toThrow('ASCII lowercase');
  });

  it('keeps persistent-storage decisions with the requesting origin across different embedders', () => {
    const firstTop = obtainURLOrigin(parseURL('https://first.test/').url!);
    const secondTop = obtainURLOrigin(parseURL('https://second.test/').url!);
    const embedded = obtainURLOrigin(parseURL('https://frame.test/').url!);
    const feature = persistentStoragePermission;
    const firstKey = feature.key.generate(firstTop, embedded);
    const secondKey = feature.key.generate(secondTop, embedded);
    expect(firstKey).toBe(embedded);
    expect(feature.key.equals(firstKey, secondKey)).toBe(true);
    expect(feature.key.equals(firstKey, feature.key.generate(firstTop, secondTop))).toBe(false);
  });
});
