import { obtainURLOrigin, parseURL } from '../../src/url/index';
import { StorageShed, type StorageEnvironment, type StorageUserAgent } from '../../src/storage/index';

/** Storage state and policy for map operations. */
export function createStorageUserAgent(storageEnabled = true): StorageUserAgent {
  return {
    storageShed: new StorageShed(), storageEnabled, storageQuotaBytes: 64 * 2 ** 20,
    generateUUID: () => crypto.randomUUID(),
  };
}

/** A storage owner with explicit session ownership and unavailable task delivery. */
export function createStorageEnvironment(
  url = 'https://example.test/', userAgent = createStorageUserAgent(), sessionShed = new StorageShed(),
): StorageEnvironment {
  const creationURL = parseURL(url).url!;
  const origin = obtainURLOrigin(creationURL);
  return {
    creationURL, origin, userAgent,
    getSessionStorageShed: () => sessionShed,
    queueStorageTask: () => { throw new Error('Storage map operations must not queue a task'); },
  };
}
