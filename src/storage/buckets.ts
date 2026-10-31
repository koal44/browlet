import { registeredStorageEndpoints, type StorageIdentifier, type StorageType } from './endpoints';
import { StorageBottle } from './bottles';

/** Endpoint-specific bottles within a storage shelf. */
// https://storage.spec.whatwg.org/#storage-bucket
export class StorageBucket {
  /** Endpoint data keyed by its registered identifier; individual formats remain endpoint-owned. */
  bottleMap = new Map<StorageIdentifier, StorageBottle>();

  /** Create fresh bottles for the endpoints registered for this storage type. */
  // https://storage.spec.whatwg.org/#create-a-storage-bucket
  static create(type: StorageType): StorageBucket {
    const bucket = type === 'local' ? new LocalStorageBucket() : new SessionStorageBucket();
    for (const endpoint of registeredStorageEndpoints.values()) {
      if (endpoint.types.has(type)) {
        bucket.bottleMap.set(endpoint.identifier, new StorageBottle(endpoint));
      }
    }
    return bucket;
  }

  /** Select a bottle, preserving the known Web Storage string format. */
  getBottle(identifier: 'localStorage' | 'sessionStorage'): StorageBottle<string, string> | undefined;
  getBottle(identifier: StorageIdentifier): StorageBottle | undefined;
  getBottle(identifier: StorageIdentifier): StorageBottle | undefined {
    return this.bottleMap.get(identifier);
  }

  /**
   * Empty all endpoint data in place, retaining existing map views and metadata.
   * The caller owns clearing policy and timing.
   */
  // https://storage.spec.whatwg.org/#management
  clear(): void {
    for (const bottle of this.bottleMap.values()) bottle.map.clear();
  }
}

/** Local storage starts with best-effort retention. */
// https://storage.spec.whatwg.org/#bucket
export class LocalStorageBucket extends StorageBucket {
  /** Current retention policy; granting permission alone does not change it. */
  mode: 'best-effort' | 'persistent' = 'best-effort';
}

/** Storage whose lifetime belongs to a traversable's session. */
// https://storage.spec.whatwg.org/#session-storage-bucket
export class SessionStorageBucket extends StorageBucket {}
