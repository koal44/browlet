import { InternalError } from '../infra/index';

/** A storage API registered with the shared storage model. */
// https://storage.spec.whatwg.org/#storage-endpoint
export class StorageEndpoint<K = unknown, V = unknown> {
  /** Identifier used to select this endpoint's bottle within a bucket. */
  identifier: StorageIdentifier;
  /** Storage lifetimes supported by this endpoint. */
  types: Set<StorageType>;
  /** Recommended bottle quota in bytes; null leaves it without an endpoint-specific limit. */
  quota: number | null;

  constructor(identifier: StorageIdentifier, types: Set<StorageType>, quota: number | null) {
    this.identifier = identifier;
    this.types = types;
    this.quota = quota;
  }

  /** Empty endpoints use no bytes; populated endpoints must implement their data-format accounting. */
  estimateUsage(map: Map<K, V>): number {
    if (map.size === 0) return 0;
    throw new InternalError(`Storage usage estimation is not implemented for ${this.identifier}`);
  }
}

/** String-keyed Web Storage data, with a recommended quota for each bottle. */
export class WebStorageEndpoint extends StorageEndpoint<string, string> {
  constructor(type: StorageType) {
    super(`${type}Storage`, new Set([type]), 5 * 2 ** 20);
  }

  /** Count two bytes per UTF-16 code unit, excluding map and engine overhead. */
  override estimateUsage(map: Map<string, string>): number {
    let usage = 0;
    for (const [key, value] of map) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        throw new InternalError('Web Storage maps require string keys and values');
      }
      usage += 2 * (key.length + value.length);
    }
    return usage;
  }
}

/** Endpoint metadata in registration order, selected by its unique identifier. */
// https://storage.spec.whatwg.org/#registered-storage-endpoints
// The specification's endpoint set is indexed by identifier here.
export const registeredStorageEndpoints = new Map<StorageIdentifier, StorageEndpoint>([
  new StorageEndpoint('caches', new Set(['local']), null),
  new StorageEndpoint('indexedDB', new Set(['local']), null),
  new WebStorageEndpoint('local'),
  new StorageEndpoint('serviceWorkerRegistrations', new Set(['local']), null),
  new WebStorageEndpoint('session'),
].map((endpoint) => [endpoint.identifier, endpoint]));

/** An ASCII string identifying a storage endpoint. */
// https://storage.spec.whatwg.org/#storage-identifier
export type StorageIdentifier = string;

/** Whether storage belongs to the user agent or a traversable's session. */
// https://storage.spec.whatwg.org/#storage-type
export type StorageType = 'local' | 'session';
