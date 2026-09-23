import type { StorageEnvironment } from './environment';
import { areSameOrigin, obtainURLOrigin, type Origin } from '../url/index';

/** Identifies the storage partition selected for an environment. */
// https://storage.spec.whatwg.org/#storage-keys
export class StorageKey {
  /** Security origin used for key equality, including opaque-origin identity. */
  origin: Origin;

  constructor(origin: Origin) {
    this.origin = origin;
  }

  /** Obtain a storage key, or null for an opaque origin or disabled storage. */
  // https://storage.spec.whatwg.org/#obtain-a-storage-key
  static obtain(env: StorageEnvironment): StorageKey | null {
    const key = StorageKey.obtainForNonStoragePurposes(env);
    if (key.origin.kind === 'opaque') return null;
    if (!env.userAgent.storageEnabled) return null;
    return key;
  }

  /** Obtain an access-check key even when storage is disabled or the origin is opaque. */
  // https://storage.spec.whatwg.org/#obtain-a-storage-key-for-non-storage-purposes
  static obtainForNonStoragePurposes(env: StorageEnvironment): StorageKey {
    const origin = env.origin ?? obtainURLOrigin(env.creationURL);
    return new StorageKey(origin);
  }

  /** Whether both keys identify the same storage partition. */
  // https://storage.spec.whatwg.org/#storage-key-equal
  equals(other: StorageKey): boolean {
    return areSameOrigin(this.origin, other.origin);
  }
}
