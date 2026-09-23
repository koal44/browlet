import { describe, expect, it, vi } from 'vitest';

import { BlobImpl } from '../../src/file/blob';
import { BlobData, type BlobByteSource } from '../../src/file/blob-data';
import type { BlobURLEnvironment } from '../../src/browlet/integration/file/blob-url';
import { UserAgent } from '../../src/browlet/user-agent';
import { InternalError } from '../../src/infra/internal-error';
import type { StorageEnvironment, StorageUserAgent } from '../../src/storage/environment';
import { createOpaqueOrigin } from '../../src/url/origin';
import { obtainURLOrigin, parseURL, serializeURL } from '../../src/url/url';
import { createEnvironment } from '../js-engine/execution-fixture';

const firstUUID = '550e8400-e29b-41d4-a716-446655440000';
const secondUUID = '550e8400-e29b-41d4-a716-446655440001';
const blobEnv = createEnvironment();

describe('File API §8.2: Blob URL registration', () => {
  it('registers the original Blob and creating environment without reading its bytes', () => {
    const read = vi.fn<BlobByteSource['read']>(() => Promise.resolve(Uint8Array.of(1)));
    const source: BlobByteSource = { size: 1, snapshotState: undefined, read };
    const blob = BlobImpl.create(BlobData.fromSource(source), 'text/plain', undefined, blobEnv);
    const generateUUID = vi.fn(() => firstUUID);
    const { store, userAgent } = createStore(generateUUID);
    const env = createStorageEnvironment('https://example.test/page', userAgent);

    const url = store.add(blob, env);
    const entry = store.resolve(parseURL(url).url!)!;

    expect(url).toBe(`blob:https://example.test/${firstUUID}`);
    expect(entry.env).toBe(env);
    expect(entry.obtainObject(env)).toBe(blob);
    expect(generateUUID).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
  });

  it('gives repeated registrations independent URLs and entries', () => {
    const generateUUID = vi.fn().mockReturnValueOnce(firstUUID).mockReturnValueOnce(secondUUID);
    const { store, userAgent } = createStore(generateUUID);
    const blob = new BlobImpl(['data'], {}, blobEnv);
    const env = createStorageEnvironment('https://example.test/', userAgent);
    const first = parseURL(store.add(blob, env)).url!;
    const second = parseURL(store.add(blob, env)).url!;

    expect(serializeURL(first)).not.toBe(serializeURL(second));
    expect(store.resolve(first)).not.toBe(store.resolve(second));
    expect(store.resolve(first)!.obtainObject(env)).toBe(blob);
    expect(store.resolve(second)!.obtainObject(env)).toBe(blob);
    store.remove(first);
    expect(store.resolve(first)).toBeNull();
    expect(store.resolve(second)!.obtainObject(env)).toBe(blob);
  });

  it('generates a URL without creating a registration', () => {
    const { store, userAgent } = createStore();
    const url = store.generateURL(createStorageEnvironment('https://example.test/', userAgent));
    expect(store.resolve(parseURL(url).url!)).toBeNull();
  });

  it('serializes the origin without credentials, path, query, or fragment', () => {
    const { store, userAgent } = createStore();
    const env = createStorageEnvironment('https://name:secret@EXAMPLE.test:8443/path?q=1#fragment', userAgent);
    expect(store.generateURL(env)).toBe(`blob:https://example.test:8443/${firstUUID}`);
  });

  it('uses an inherited security origin rather than the creation URL', () => {
    const { store, userAgent } = createStore();
    const env = createStorageEnvironment('about:blank', userAgent);
    env.origin = createStorageEnvironment('https://creator.test/', userAgent).origin;
    expect(store.generateURL(env)).toBe(`blob:https://creator.test/${firstUUID}`);
  });

  it('uses null for an opaque origin while retaining the actual origin identity', () => {
    const { store, userAgent } = createStore();
    const env = createStorageEnvironment('data:,opaque', userAgent);
    const blob = new BlobImpl([], {}, blobEnv);
    const url = store.add(blob, env);
    expect(url).toBe(`blob:null/${firstUUID}`);
    expect(store.resolve(parseURL(url).url!)!.env.origin).toBe(env.origin);
  });
});

describe('File API §§8.2–8.3: Blob URL lookup and removal', () => {
  it('does not share registrations between stores', () => {
    const { store: first, userAgent } = createStore();
    const { store: second } = createStore(() => secondUUID);
    const env = createStorageEnvironment('https://example.test/', userAgent);
    const url = parseURL(first.add(new BlobImpl([], {}, blobEnv), env)).url!;
    expect(first.resolve(url)).not.toBeNull();
    expect(second.resolve(url)).toBeNull();
  });

  it('ignores the fragment during lookup without changing the supplied URL', () => {
    const { store, userAgent } = createStore();
    const env = createStorageEnvironment('https://example.test/', userAgent);
    const url = store.add(new BlobImpl([], {}, blobEnv), env);
    const entry = store.resolve(parseURL(url).url!);
    const fragmentURL = parseURL(`${url}#section`).url!;
    expect(store.resolve(fragmentURL)).toBe(entry);
    expect(store.resolve(parseURL(`${url}#`).url!)).toBe(entry);
    expect(serializeURL(fragmentURL)).toBe(`${url}#section`);
  });

  it('retains the query and path spelling during lookup', () => {
    const { store, userAgent } = createStore();
    const url = store.add(new BlobImpl([], {}, blobEnv), createStorageEnvironment('https://example.test/', userAgent));
    expect(store.resolve(parseURL(`${url}?query`).url!)).toBeNull();
    expect(store.resolve(parseURL(url.replace(firstUUID, `%35${firstUUID.slice(1)}`)).url!)).toBeNull();
  });

  it('requires the blob scheme for resolution', () => {
    const { store } = createStore();
    expect(() => store.resolve(parseURL('https://example.test/').url!)).toThrow(InternalError);
  });

  it('removes an exact URL and leaves repeated or unknown removal harmless', () => {
    const { store, userAgent } = createStore();
    const url = parseURL(store.add(new BlobImpl([], {}, blobEnv), createStorageEnvironment('https://example.test/', userAgent))).url!;
    expect(store.resolve(url)).not.toBeNull();
    store.remove(url);
    expect(store.resolve(url)).toBeNull();
    store.remove(url);
    store.remove(parseURL(`blob:https://example.test/${secondUUID}`).url!);
    expect(store.resolve(url)).toBeNull();
  });

  it('removes the returned string directly without normalizing it', () => {
    const { store, userAgent } = createStore();
    const url = store.add(new BlobImpl([], {}, blobEnv), createStorageEnvironment('https://example.test/', userAgent));
    const record = parseURL(url).url!;
    store.remove(` ${url}`);
    expect(store.resolve(record)).not.toBeNull();
    store.remove(url);
    expect(store.resolve(record)).toBeNull();
  });

  it('includes the fragment when removing a registration', () => {
    const { store, userAgent } = createStore();
    const url = store.add(new BlobImpl([], {}, blobEnv), createStorageEnvironment('https://example.test/', userAgent));
    const record = parseURL(url).url!;
    const entry = store.resolve(record);
    store.remove(parseURL(`${url}#section`).url!);
    store.remove(parseURL(`${url}#`).url!);
    store.remove(`${url}#section`);
    store.remove(`${url}#`);
    expect(store.resolve(record)).toBe(entry);
    store.remove(record);
    expect(store.resolve(record)).toBeNull();
  });
});

describe('File API §§8.2 and 8.3.2: Blob URL object acquisition', () => {
  it('allows a different environment with the same storage key', () => {
    const { store, userAgent } = createStore();
    const creator = createStorageEnvironment('https://example.test/first', userAgent);
    const consumer = createStorageEnvironment('https://example.test/second', userAgent);
    const blob = new BlobImpl([], {}, blobEnv);
    const entry = store.resolve(parseURL(store.add(blob, creator)).url!)!;
    expect(entry.isSamePartition(consumer)).toBe(true);
    expect(entry.obtainObject(consumer)).toBe(blob);
  });

  it('uses a reserved environment\'s creation URL to allow or deny acquisition', () => {
    const { store, userAgent } = createStore();
    const creator = createStorageEnvironment('https://example.test/first', userAgent);
    const consumer: StorageEnvironment = {
      userAgent, creationURL: parseURL('https://example.test/second').url!,
    };
    const blob = new BlobImpl([], {}, blobEnv);
    const entry = store.resolve(parseURL(store.add(blob, creator)).url!)!;
    expect(entry.isSamePartition(consumer)).toBe(true);
    expect(entry.obtainObject(consumer)).toBe(blob);

    consumer.creationURL = parseURL('https://other.test/').url!;
    expect(entry.isSamePartition(consumer)).toBe(false);
    expect(entry.obtainObject(consumer)).toBeNull();
  });

  it.each(['http://example.test/', 'https://other.test/', 'https://example.test:8443/'])(
    'denies a different storage key: %s', (url) => {
      const { store, userAgent } = createStore();
      const creator = createStorageEnvironment('https://example.test/', userAgent);
      const consumer = createStorageEnvironment(url, userAgent);
      const entry = store.resolve(parseURL(store.add(new BlobImpl([], {}, blobEnv), creator)).url!)!;
      expect(entry.isSamePartition(consumer)).toBe(false);
      expect(entry.obtainObject(consumer)).toBeNull();
    },
  );

  it('uses non-storage keys even when the user agent has disabled storage', () => {
    const { store, userAgent } = createStore();
    const creator = createStorageEnvironment('https://example.test/', userAgent);
    const consumer = createStorageEnvironment('https://example.test/', userAgent);
    userAgent.storageEnabled = false;
    const blob = new BlobImpl([], {}, blobEnv);
    const entry = store.resolve(parseURL(store.add(blob, creator)).url!)!;
    expect(entry.obtainObject(consumer)).toBe(blob);
    userAgent.storageEnabled = true;
    expect(entry.obtainObject(consumer)).toBe(blob);
  });

  it('compares opaque origins by identity rather than their common null spelling', () => {
    const { store, userAgent } = createStore();
    const creator = createStorageEnvironment('data:,opaque', userAgent);
    const consumer = createStorageEnvironment('about:blank', userAgent);
    consumer.origin = creator.origin;
    const blob = new BlobImpl([], {}, blobEnv);
    const entry = store.resolve(parseURL(store.add(blob, creator)).url!)!;
    expect(entry.obtainObject(creator)).toBe(blob);
    expect(entry.obtainObject(consumer)).toBe(blob);
    consumer.origin = createOpaqueOrigin();
    expect(entry.isSamePartition(consumer)).toBe(false);
    expect(entry.obtainObject(consumer)).toBeNull();
  });

  it.each(['top-level-navigation', 'top-level-self-fetch'] as const)(
    'permits the explicit %s exemption', (purpose) => {
      const { store, userAgent } = createStore();
      const creator = createStorageEnvironment('https://example.test/', userAgent);
      const blob = new BlobImpl([], {}, blobEnv);
      const entry = store.resolve(parseURL(store.add(blob, creator)).url!)!;
      expect(entry.obtainObject(purpose)).toBe(blob);
    },
  );
});

describe('File API §8.3.3: environment cleanup', () => {
  it('removes all registrations for the retiring environment, retaining other same-origin entries', () => {
    let id = 0;
    const { store, userAgent } = createStore(() => `550e8400-e29b-41d4-a716-${String(id++).padStart(12, '0')}`);
    const creator = createStorageEnvironment('https://example.test/', userAgent);
    const other = createStorageEnvironment('https://example.test/', userAgent);
    const blob = new BlobImpl([], {}, blobEnv);
    const first = parseURL(store.add(blob, creator)).url!;
    const second = parseURL(store.add(blob, creator)).url!;
    const retained = parseURL(store.add(blob, other)).url!;

    store.removeForEnvironment(creator);

    expect(store.resolve(first)).toBeNull();
    expect(store.resolve(second)).toBeNull();
    expect(store.resolve(retained)!.env).toBe(other);
    expect(store.resolve(retained)!.obtainObject(other)).toBe(blob);
  });
});

describe('File API §8.4: reads already started when a URL is revoked', () => {
  it('finishes an acquired Blob read after its URL is removed', async () => {
    let finish!: (bytes: Uint8Array) => void;
    const pending = new Promise<Uint8Array>((resolve) => { finish = resolve; });
    const read = vi.fn<BlobByteSource['read']>(() => pending);
    const source: BlobByteSource = { size: 3, snapshotState: undefined, read };
    const blob = BlobImpl.create(BlobData.fromSource(source), '', undefined, blobEnv);
    const { store, userAgent } = createStore();
    const env = createStorageEnvironment('https://example.test/', userAgent);
    const url = parseURL(store.add(blob, env)).url!;
    const acquired = store.resolve(url)!.obtainObject(env)!;
    const bytes = acquired.data.read();
    expect(read).toHaveBeenCalledOnce();

    store.remove(url);
    expect(store.resolve(url)).toBeNull();
    finish(Uint8Array.of(1, 2, 3));
    expect(await bytes).toEqual(Uint8Array.of(1, 2, 3));
    expect(acquired).toBe(blob);
  });
});

function createStore(generateUUID: () => string = () => firstUUID) {
  const userAgent = new UserAgent();
  userAgent.generateUUID = generateUUID;
  return { store: userAgent.blobURLStore, userAgent };
}

function createStorageEnvironment(url: string, userAgent: StorageUserAgent): BlobURLEnvironment {
  const creationURL = parseURL(url).url!;
  return { creationURL, origin: obtainURLOrigin(creationURL), userAgent };
}
