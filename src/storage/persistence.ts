import { areSameOrigin, type Origin } from '../url/index';
import {
  PermissionFeature, originPermissionKey, type PermissionDescriptor, type PermissionKeyDefinition, type PermissionState,
} from '../permissions/index';

import type { StorageUserAgent } from './environment';
import { StorageKey } from './keys';
import type { LocalStorageBucket } from './buckets';

/** Recorded consent for the persistent-storage feature; not the public Permissions API. */
export type StoragePermissionState = PermissionState;

/** Storage requires the same decision for all settings with the requesting origin. */
// Shared state/key rules; UserAgent binds the revocation hook to its own StoragePersistence when installing them.
// https://storage.spec.whatwg.org/#persistence
// SPEC_CLASH(storage-permission-origin-key): Storage defaults the key algorithms but requires origin-wide state.
// Permissions' default uses the top-level origin. Keep Storage's requesting-origin
// scope so different embedders cannot split decisions, or share one across unrelated frames.
// Browsers separately restrict cross-origin persistence requests; see ROADMAP.md.
// Firefox also denies cross-origin queries. Our read path retains Storage's origin-wide state rule.
// Like Chromium, deny new cross-origin requests without overwriting the saved origin decision.
// Existing decisions still short-circuit in Permissions §5.2; this does not gate Storage.persist() itself.
export class PersistentStoragePermission extends PermissionFeature<PermissionDescriptor, Origin> {
  /** Shared requesting-origin key rules for every browser's feature instance. */
  static #key: PermissionKeyDefinition<Origin> = {
    ...originPermissionKey,
    generate: (_origin, embeddedOrigin) => embeddedOrigin,
  };

  constructor(onRevoke?: (origin: Origin) => void) {
    super('persistent-storage', PersistentStoragePermission.#key, {
      canRequest: (_descriptor, env) => env.topLevelOrigin !== null && areSameOrigin(env.origin, env.topLevelOrigin),
      revoke: (_descriptor, origin) => { onRevoke?.(origin); },
    });
  }
}

/** Shared feature rules for hosts that do not install a revocation effect. */
export const persistentStoragePermission = new PersistentStoragePermission();

/** Browser-owned persistence decisions, shared by all settings with the same origin. */
// https://storage.spec.whatwg.org/#persistence
export class StoragePersistence {
  /** Owns the shared permission store and local storage whose retention follows its decisions. */
  #userAgent: StorageUserAgent;

  constructor(userAgent: StorageUserAgent) {
    this.#userAgent = userAgent;
  }

  /** Read recorded host consent without a live environment; effective-state checks belong to Permissions. */
  // https://w3c.github.io/permissions/#default-permission-state
  getPermission(origin: Origin): StoragePermissionState {
    const entry = this.#userAgent.permissionStore.getEntry({ name: persistentStoragePermission.name }, origin);
    return entry?.state ?? persistentStoragePermission.defaultState;
  }

  /** Record a host decision and apply revocation; granting alone does not persist a bucket. */
  setPermission(origin: Origin, state: StoragePermissionState): void {
    const store = this.#userAgent.permissionStore;
    const descriptor = { name: persistentStoragePermission.name };
    if (state === 'prompt') store.removeEntry(descriptor, origin);
    else store.setEntry(descriptor, origin, state);
    if (state !== 'granted') this.revokeProtection(origin);
  }

  /** Protect an already-obtained default local bucket only when permission is granted. */
  // https://storage.spec.whatwg.org/#persistence
  persist(origin: Origin): boolean {
    if (this.getPermission(origin) !== 'granted') return false;
    if (origin.kind === 'opaque' || !this.#userAgent.storageEnabled) return false;
    const bucket = this.#getDefaultBucket(origin);
    if (bucket === undefined) return false;
    bucket.mode = 'persistent';
    return true;
  }

  /** Apply known withdrawal of consent to retained storage; the caller updates the permission store. */
  // https://storage.spec.whatwg.org/#permission-revocation
  // SPEC_CLASH(storage-permission-revocation-order): Permissions §5.4 runs cleanup before removing the old grant.
  // Storage's granted-state guard would skip cleanup. Honor the known withdrawal here;
  // the host setter calls only after a non-granted decision, and generic revocation removes the grant next.
  revokeProtection(origin: Origin): void {
    // SPEC_GAP(storage-revocation-shelf-failure): Revocation does not handle failed shelf acquisition.
    // The spec obtains a shelf through current settings. An absent bucket is
    // already best-effort when created; a stored one must also be revoked when
    // storage access is disabled, rather than failing to obtain its shelf.
    const bucket = this.#getDefaultBucket(origin);
    if (bucket !== undefined) bucket.mode = 'best-effort';
  }

  /** Resolve retained storage without allocating a shelf or checking author access. */
  #getDefaultBucket(origin: Origin): LocalStorageBucket | undefined {
    const shelf = this.#userAgent.storageShed.get(new StorageKey(origin));
    return shelf?.bucketMap.get('default') as LocalStorageBucket | undefined;
  }
}
