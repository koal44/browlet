import type { StorageEndpoint, StorageIdentifier, StorageType } from './endpoints';
import type { StorageEnvironment } from './environment';
import { StorageShelf } from './sheds';

/** An endpoint's backing data, proxy references, and quota in bytes. */
// https://storage.spec.whatwg.org/#storage-bottle
export class StorageBottle<K = unknown, V = unknown> {
  /** Backing entries in the owning endpoint's format. */
  map = new Map<K, V>();
  /** Views created for this bottle; clearing retains their backing map identity. */
  proxyMapReferenceSet = new Set<StorageProxyMap<K, V>>();
  /** Quota copied at creation, independent of subsequent endpoint metadata changes. */
  quota: number | null;
  /** Endpoint supplying the data-format accounting for this bottle. */
  #endpoint: StorageEndpoint<K, V>;

  constructor(endpoint: StorageEndpoint<K, V>) {
    this.quota = endpoint.quota;
    this.#endpoint = endpoint;
  }

  /** Obtain a fresh proxy for an endpoint registered for this type, or null when storage is denied. */
  // https://storage.spec.whatwg.org/#obtain-a-storage-bottle-map
  static obtainMap(
    type: StorageType, env: StorageEnvironment, identifier: 'localStorage' | 'sessionStorage',
  ): StorageProxyMap<string, string> | null;
  static obtainMap(type: StorageType, env: StorageEnvironment, identifier: StorageIdentifier): StorageProxyMap | null;
  static obtainMap(
    type: StorageType, env: StorageEnvironment, identifier: StorageIdentifier,
  ): StorageProxyMap | null {
    const shed = type === 'local' ? env.userAgent.storageShed : env.getSessionStorageShed();
    const shelf = StorageShelf.obtain(shed, env, type);
    if (shelf === null) return null;
    const bottle = shelf.bucketMap.get('default')!.getBottle(identifier)!;
    const proxyMap = new StorageProxyMap(bottle.map);
    bottle.proxyMapReferenceSet.add(proxyMap);
    return proxyMap;
  }

  /** Obtain a local endpoint's map through the environment's user agent. */
  // https://storage.spec.whatwg.org/#obtain-a-local-storage-bottle-map
  static obtainLocalMap(env: StorageEnvironment, identifier: 'localStorage'): StorageProxyMap<string, string> | null;
  static obtainLocalMap(env: StorageEnvironment, identifier: StorageIdentifier): StorageProxyMap | null;
  static obtainLocalMap(env: StorageEnvironment, identifier: StorageIdentifier): StorageProxyMap | null {
    return StorageBottle.obtainMap('local', env, identifier);
  }

  /** Obtain a session endpoint's map through the Window's current traversable. */
  // https://storage.spec.whatwg.org/#obtain-a-session-storage-bottle-map
  static obtainSessionMap(env: StorageEnvironment, identifier: 'sessionStorage'): StorageProxyMap<string, string> | null;
  static obtainSessionMap(env: StorageEnvironment, identifier: StorageIdentifier): StorageProxyMap | null;
  static obtainSessionMap(env: StorageEnvironment, identifier: StorageIdentifier): StorageProxyMap | null {
    return StorageBottle.obtainMap('session', env, identifier);
  }

  /** Estimate stored payload bytes; populated endpoints must supply their data-format accounting. */
  get usage(): number {
    if (this.map.size === 0) return 0;
    return this.#endpoint.estimateUsage(this.map);
  }
}

/** Internal map view whose operations use its current backing map. */
// https://storage.spec.whatwg.org/#storage-proxy-map
export class StorageProxyMap<K = unknown, V = unknown> {
  /** Current endpoint data; individual views can be redirected independently. */
  backingMap: Map<K, V>;

  constructor(backingMap: Map<K, V>) {
    this.backingMap = backingMap;
  }

  get size(): number {
    return this.backingMap.size;
  }

  get(key: K): V | undefined {
    return this.backingMap.get(key);
  }

  has(key: K): boolean {
    return this.backingMap.has(key);
  }

  set(key: K, value: V): this {
    this.backingMap.set(key, value);
    return this;
  }

  delete(key: K): boolean {
    return this.backingMap.delete(key);
  }

  clear(): void {
    this.backingMap.clear();
  }

  keys(): MapIterator<K> {
    return this.backingMap.keys();
  }

  values(): MapIterator<V> {
    return this.backingMap.values();
  }

  entries(): MapIterator<[K, V]> {
    return this.backingMap.entries();
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.backingMap[Symbol.iterator]();
  }

  forEach(callback: (value: V, key: K, map: StorageProxyMap<K, V>) => void, thisArg?: unknown): void {
    this.backingMap.forEach((value, key) => callback.call(thisArg, value, key, this));
  }
}
