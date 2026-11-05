import { utf8Encode } from '../encoding/index';
import { areSameOrigin, obtainURLOrigin, serializeOrigin, type Origin } from '../url/index';

import type { StorageEnvironmentBase } from './environment';

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
  static obtain(env: StorageEnvironmentBase): StorageKey | null {
    const key = StorageKey.obtainForNonStoragePurposes(env);
    if (key.origin.kind === 'opaque') return null;
    if (!env.userAgent.storageEnabled) return null;
    return key;
  }

  /** Obtain an access-check key even when storage is disabled or the origin is opaque. */
  // https://storage.spec.whatwg.org/#obtain-a-storage-key-for-non-storage-purposes
  static obtainForNonStoragePurposes(env: StorageEnvironmentBase): StorageKey {
    const origin = env.origin ?? obtainURLOrigin(env.creationURL);
    return new StorageKey(origin);
  }

  /** Encode this key for non-storage algorithms, preserving key equality without exposing opaque identities. */
  // Clipboard §5.2.1 permits a user-agent-specific storage-key byte representation.
  // https://w3c.github.io/clipboard-apis/#h-changeid-generation
  // Extend this alongside equals() if Storage adds partition components.
  toBytes(): Uint8Array<ArrayBuffer> {
    const origin = this.origin;
    return utf8Encode(origin.kind === 'opaque'
      ? 'opaque:' + origin.identity
      : 'tuple:' + serializeOrigin(origin));
  }

  /** Whether both keys identify the same storage partition. */
  // https://storage.spec.whatwg.org/#storage-key-equal
  equals(other: StorageKey): boolean {
    return areSameOrigin(this.origin, other.origin);
  }
}
