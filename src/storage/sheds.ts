import type { StorageType } from './endpoints';
import type { StorageEnvironmentBase } from './environment';
import { StorageKey } from './keys';
import { StorageBucket } from './buckets';

/** An initially empty map of shelves, using storage-key equality for lookup. */
// https://storage.spec.whatwg.org/#storage-shed
export class StorageShed extends Map<StorageKey, StorageShelf> {
  constructor() {
    super();
  }

  override get(key: StorageKey): StorageShelf | undefined {
    return super.get(this.#findKey(key));
  }

  override has(key: StorageKey): boolean {
    return super.has(this.#findKey(key));
  }

  override set(key: StorageKey, shelf: StorageShelf): this {
    return super.set(this.#findKey(key), shelf);
  }

  override delete(key: StorageKey): boolean {
    return super.delete(this.#findKey(key));
  }

  /** Obtain the environment's shelf, or null when storage-key acquisition fails. */
  // https://storage.spec.whatwg.org/#obtain-a-storage-shelf
  obtainShelf(env: StorageEnvironmentBase, type: StorageType): StorageShelf | null {
    const key = StorageKey.obtain(env);
    if (key === null) return null;
    let shelf = this.get(key);
    if (shelf === undefined) {
      shelf = StorageShelf.create(type);
      this.set(key, shelf);
    }
    return shelf;
  }

  /**
   * Clear and remove a retired bucket, dropping its shelf when no buckets remain.
   * Callers must retire its consumers first.
   */
  // https://storage.spec.whatwg.org/#management
  removeBucket(key: StorageKey, name: string): boolean {
    const shelf = this.get(key);
    if (shelf === undefined) return false;
    const bucket = shelf.bucketMap.get(name);
    if (bucket === undefined) return false;
    bucket.clear();
    shelf.bucketMap.delete(name);
    if (shelf.bucketMap.size === 0) this.delete(key);
    return true;
  }

  /** Copy default sessionStorage data into fresh destination shelves without sharing maps. */
  // https://storage.spec.whatwg.org/#legacy-clone-a-traversable-storage-shed
  // Takes the traversables' sheds directly; the source shed is this object.
  cloneSessionStorageInto(target: StorageShed): void {
    for (const [key, shelf] of this) {
      const newShelf = StorageShelf.create('session');
      const sourceBottle = shelf.bucketMap.get('default')!.getBottle('sessionStorage')!;
      const targetBottle = newShelf.bucketMap.get('default')!.getBottle('sessionStorage')!;
      targetBottle.map = new Map(sourceBottle.map);
      target.set(key, newShelf);
    }
  }

  #findKey(key: StorageKey): StorageKey {
    for (const storedKey of this.keys()) {
      if (storedKey.equals(key)) return storedKey;
    }
    return key;
  }
}

/** Buckets belonging to one storage key within a shed. */
// https://storage.spec.whatwg.org/#storage-shelf
export class StorageShelf {
  /** Buckets retained for this storage key, starting with the default bucket. */
  bucketMap = new Map<string, StorageBucket>();

  /** Obtain the environment's shelf from its user agent's local storage shed. */
  // https://storage.spec.whatwg.org/#obtain-a-local-storage-shelf
  static obtainLocal(env: StorageEnvironmentBase): StorageShelf | null {
    return env.userAgent.storageShed.obtainShelf(env, 'local');
  }

  /** Create the shelf's default bucket for the requested storage type. */
  // https://storage.spec.whatwg.org/#create-a-storage-shelf
  static create(type: StorageType): StorageShelf {
    const shelf = new StorageShelf();
    shelf.bucketMap.set('default', StorageBucket.create(type));
    return shelf;
  }

  /** Estimate payload bytes across this shelf's current buckets and bottles. */
  // https://storage.spec.whatwg.org/#storage-usage
  // Reconsider maintained totals if callers check usage frequently, especially on every write.
  get usage(): number {
    let usage = 0;
    for (const bucket of this.bucketMap.values()) {
      for (const bottle of bucket.bottleMap.values()) usage += bottle.usage;
    }
    return usage;
  }
}
