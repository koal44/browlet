import { describe, expect, it } from 'vitest';
import { StorageKey } from '../../src/storage/keys';
import type { StorageUserAgent } from '../../src/storage/environment';
import { createOpaqueOrigin, type TupleOrigin } from '../../src/url/origin';
import { obtainURLOrigin, parseURL } from '../../src/url/url';

describe('obtaining storage keys', () => {
  it('obtains a key from a settings object\'s origin', () => {
    const environment = settings('https://example.test/');
    expect(StorageKey.obtain(environment)?.origin).toBe(environment.origin);
  });

  it('obtains a key from an earlier environment\'s creation URL', () => {
    const environment = {
      creationURL: parseURL('https://example.test:8443/created').url!,
      userAgent: createUserAgent(),
    };
    const key = StorageKey.obtain(environment)!;
    expect(key.equals(StorageKey.obtain(settings('https://example.test:8443/other'))!)).toBe(true);
  });

  it('selects the settings origin even when the creation URL has a different origin', () => {
    const environment = { ...settings('https://inherited.test/'), creationURL: parseURL('about:blank').url! };
    expect(StorageKey.obtain(environment)?.origin).toBe(environment.origin);
  });

  it('fails when storage is disabled, and observes later preference changes', () => {
    const environment = settings('https://example.test/');
    environment.userAgent.storageEnabled = false;
    expect(StorageKey.obtain(environment)).toBeNull();
    environment.userAgent.storageEnabled = true;
    expect(StorageKey.obtain(environment)?.origin).toBe(environment.origin);
  });

  it('fails for an opaque settings origin without falling back to the creation URL', () => {
    const environment = {
      origin: createOpaqueOrigin(), creationURL: parseURL('https://example.test/').url!,
      userAgent: createUserAgent(),
    };
    expect(StorageKey.obtain(environment)).toBeNull();
  });

  it.each(['about:blank', 'data:,opaque', 'file:///example.txt'])(
    'fails when an earlier environment\'s creation URL has an opaque origin: %s', (url) => {
      expect(StorageKey.obtain({
        creationURL: parseURL(url).url!, userAgent: createUserAgent(),
      })).toBeNull();
    },
  );
});

describe('storage keys for non-storage purposes', () => {
  it('uses the same key as storage acquisition when storage is available', () => {
    const environment = settings('https://example.test/');
    const key = StorageKey.obtainForNonStoragePurposes(environment);
    expect(key.equals(StorageKey.obtain(environment)!)).toBe(true);
  });

  it('still obtains a key when storage is disabled', () => {
    const environment = settings('https://example.test/');
    environment.userAgent.storageEnabled = false;
    expect(StorageKey.obtainForNonStoragePurposes(environment).origin).toBe(environment.origin);
  });

  it('preserves an opaque settings origin and its identity when storage is disabled', () => {
    const origin = createOpaqueOrigin();
    const environment = {
      origin, creationURL: parseURL('https://example.test/').url!, userAgent: createUserAgent(false),
    };
    const first = StorageKey.obtainForNonStoragePurposes(environment);
    const second = StorageKey.obtainForNonStoragePurposes(environment);
    expect(first.origin).toBe(origin);
    expect(first.equals(second)).toBe(true);
  });

  it('uses the creation URL before settings exist even when storage is disabled', () => {
    const environment = {
      creationURL: parseURL('https://example.test/').url!, userAgent: createUserAgent(false),
    };
    expect(StorageKey.obtainForNonStoragePurposes(environment).equals(
      StorageKey.obtainForNonStoragePurposes(settings('https://example.test/other')),
    )).toBe(true);
  });

  it('permits an opaque creation-URL origin for non-storage checks', () => {
    const environment = {
      creationURL: parseURL('data:,opaque').url!, userAgent: createUserAgent(false),
    };
    expect(StorageKey.obtainForNonStoragePurposes(environment).origin.kind).toBe('opaque');
  });
});

describe('storage-key equality', () => {
  it('compares separately obtained keys by origin rather than object identity', () => {
    const first = StorageKey.obtain(settings('https://example.test/first'))!;
    const second = StorageKey.obtain(settings('https://example.test/second?q=1#fragment'))!;
    expect(first).not.toBe(second);
    expect(first.origin).not.toBe(second.origin);
    expect(first.equals(second)).toBe(true);
    expect(second.equals(first)).toBe(true);
  });

  it.each(['http://example.test/', 'https://other.test/', 'https://example.test:8443/'])(
    'distinguishes a different scheme, host, or port: %s', (url) => {
      const first = StorageKey.obtain(settings('https://example.test/'))!;
      const second = StorageKey.obtain(settings(url))!;
      expect(first.equals(second)).toBe(false);
      expect(second.equals(first)).toBe(false);
    },
  );

  it('does not join different hosts through document.domain relaxation', () => {
    const first: TupleOrigin = {
      kind: 'tuple', scheme: 'https', host: { kind: 'domain', value: 'a.example.test' },
      port: null, domain: { kind: 'domain', value: 'example.test' },
    };
    const second: TupleOrigin = { ...first, host: { kind: 'domain', value: 'b.example.test' } };
    expect(new StorageKey(first).equals(new StorageKey(second))).toBe(false);
    expect(new StorageKey(first).equals(new StorageKey({ ...first, domain: null }))).toBe(true);
  });

  it('compares opaque identities without collapsing their common null serialization', () => {
    const origin = createOpaqueOrigin();
    const key = new StorageKey(origin);
    expect(key.equals(new StorageKey({ ...origin }))).toBe(true);
    expect(key.equals(new StorageKey(createOpaqueOrigin()))).toBe(false);
    expect(key.equals(StorageKey.obtain(settings('https://example.test/'))!)).toBe(false);
  });
});

function settings(url: string) {
  const creationURL = parseURL(url).url!;
  return {
    creationURL, origin: obtainURLOrigin(creationURL), userAgent: createUserAgent(),
  };
}

function createUserAgent(storageEnabled = true): StorageUserAgent {
  return { storageEnabled, generateUUID: () => crypto.randomUUID() };
}
