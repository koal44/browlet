import { obtainURLOrigin, parseURL } from '../../src/url/index';
import { PermissionStore } from '../../src/permissions/index';
import { StorageShed, persistentStoragePermission, type StorageEnvironment, type StorageUserAgent } from '../../src/storage/index';
import { NodePromise } from '../../src/browlet/integration/node';

import { createPermissionEnvironment } from './permissions';

/** Storage owner with real permission state and an explicitly unavailable consent prompt. */
export function createStorageUserAgent(storageEnabled = true): StorageUserAgent {
  return {
    storageShed: new StorageShed(), storageEnabled, storageQuotaBytes: 64 * 2 ** 20,
    generateUUID: () => crypto.randomUUID(),
    permissionStore: new PermissionStore([persistentStoragePermission]),
    HostPromise: NodePromise,
    promptForPermission() { throw new Error('This storage fixture has no permission prompt'); },
    choosePermissionOptions() { throw new Error('This storage fixture has no permission chooser'); },
  };
}

/** A bound realm environment for map operations; HTML supplies session ownership and policy inputs. */
export function createStorageEnvironment(
  url = 'https://example.test/', userAgent = createStorageUserAgent(), sessionShed = new StorageShed(),
): StorageEnvironment {
  const creationURL = parseURL(url).url!;
  const origin = obtainURLOrigin(creationURL);
  return Object.assign(createPermissionEnvironment(userAgent), {
    creationURL, origin, userAgent, topLevelOrigin: origin, isSecureContext: false,
    getSessionStorageShed: () => sessionShed,
    queueStorageTask: () => { throw new Error('Storage map operations must not queue a task'); },
  });
}
