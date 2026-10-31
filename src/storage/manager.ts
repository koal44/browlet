import { TypeError, type InternalPromise } from '../infra/index';
import {
  atArg, defineDictionary, defineInterface, dictMember, idlType, impl,
  implementationType, op, promise, reference, xattr,
} from '../web-idl/core/index';

import type { StorageEnvironment } from './environment';
import { StorageShelf } from './sheds';
import type { LocalStorageBucket } from './buckets';

/** The storage-management object associated with one environment settings object. */
// https://storage.spec.whatwg.org/#api
export class StorageManagerImpl {
  /** Owns Promise allocation, storage access, and task delivery for this object. */
  env: StorageEnvironment;

  constructor(env: StorageEnvironment) {
    this.env = env;
  }

  /** Read local bucket protection in parallel and deliver the result on the storage task source. */
  // https://storage.spec.whatwg.org/#dom-storagemanager-persisted
  persisted(): InternalPromise<boolean> {
    const result = this.env.InternalPromise.withResolvers(idlType.boolean);
    const global = this.env.realm.globalObject;
    const shelf = StorageShelf.obtainLocal(this.env);
    if (shelf === null) {
      result.reject(new TypeError('Local storage is unavailable'));
    } else {
      this.env.runInParallel(() => {
        let persisted = false;
        try {
          const bucket = shelf.bucketMap.get('default') as LocalStorageBucket | undefined;
          persisted = bucket?.mode === 'persistent';
        } catch {
          // The specification reports false for an internal storage error.
        }
        this.env.queueStorageTask(global, () => { result.resolve(persisted); });
      });
    }
    return result.promise;
  }

  /** Request consent to protect the default local bucket, then report its mode on the storage task source. */
  // https://storage.spec.whatwg.org/#dom-storagemanager-persist
  persist(): InternalPromise<boolean> {
    const result = this.env.InternalPromise.withResolvers(idlType.boolean);
    const global = this.env.realm.globalObject;
    const shelf = StorageShelf.obtainLocal(this.env);
    if (shelf === null) {
      result.reject(new TypeError('Local storage is unavailable'));
    } else {
      this.env.runInParallel(() => {
        // SPEC_CLASH(storage-persist-cross-origin): WebKit rejects cross-origin persist() even with saved consent.
        // Follow Storage's permission-request result, including Permissions' existing-decision short circuit.
        this.env.permissions.requestPermissionToUse('persistent-storage').observe((permission) => {
          let persisted = false;
          try {
            const bucket = shelf.bucketMap.get('default') as LocalStorageBucket | undefined;
            persisted = bucket?.mode === 'persistent';
            if (!persisted && permission === 'granted' && bucket !== undefined) {
              // Use the returned decision; Permissions saves a fresh grant in a separate task.
              bucket.mode = 'persistent';
              persisted = true;
            }
          } catch {
            // The specification reports false for an internal storage error.
          }
          this.env.queueStorageTask(global, () => { result.resolve(persisted); });
        }, (error) => {
          this.env.queueStorageTask(global, () => { result.reject(error); });
        });
      });
    }
    return result.promise;
  }

  /** Measure local shelf usage and quota in background work, then deliver a fresh estimate on the storage task source. */
  // https://storage.spec.whatwg.org/#dom-storagemanager-estimate
  estimate(): InternalPromise<StorageEstimate> {
    const result = this.env.InternalPromise.withResolvers(storageEstimateType);
    const global = this.env.realm.globalObject;
    const shelf = StorageShelf.obtainLocal(this.env);
    if (shelf === null) {
      result.reject(new TypeError('Local storage is unavailable'));
    } else {
      this.env.runInParallel(() => {
        let estimate: StorageEstimate;
        try {
          estimate = { usage: shelf.usage, quota: this.env.userAgent.storageQuotaBytes };
        } catch {
          this.env.queueStorageTask(global, () => { result.reject(new TypeError('Unable to estimate local storage')); });
          return;
        }
        this.env.queueStorageTask(global, () => { result.resolve(estimate); });
      });
    }
    return result.promise;
  }
}

/** Estimated storage usage and quota in bytes; estimate() supplies both optional dictionary members. */
export interface StorageEstimate {
  usage?: number;
  quota?: number;
}

const storageEstimateType = implementationType<StorageEstimate>(reference('StorageEstimate'));

/*
 * [SecureContext, Exposed=(Window,Worker)]
 * interface StorageManager {
 *   Promise<boolean> persisted();
 *   [Exposed=Window] Promise<boolean> persist();
 *   Promise<StorageEstimate> estimate();
 * };
 */
export const storageManagerIDL = defineInterface<StorageEnvironment>({
  name: 'StorageManager',
  exposed: ['Window', 'Worker'],
  ...xattr('SecureContext'),
  implementation: impl(StorageManagerImpl, { constructWith: [atArg(0, (env) => env)] }),
  members: [
    op('persisted', promise(idlType.boolean)),
    op('persist', promise(idlType.boolean), [], xattr(['Exposed', 'Window'])),
    op('estimate', promise(storageEstimateType)),
  ],
});

// dictionary StorageEstimate { unsigned long long usage; unsigned long long quota; };
export const storageEstimateIDL = defineDictionary({
  name: 'StorageEstimate',
  members: [dictMember('usage', idlType.unsignedLongLong), dictMember('quota', idlType.unsignedLongLong)],
});
