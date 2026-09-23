import { InternalError } from '../../../infra/internal-error';
import { StorageKey, type StorageEnvironment } from '../../../storage/index';
import { serializeOrigin, serializeURL, type Origin, type URLRecord } from '../../../url/index';
import type { BlobImpl } from '../../../file/index';
import type { UserAgent } from '../../user-agent';

/** User-agent-owned registrations that retain their objects and creating environments. */
// https://w3c.github.io/FileAPI/#BlobURLStore
export class BlobURLStore {
  #entries = new Map<string, BlobURLEntry>();
  #userAgent: UserAgent;

  constructor(userAgent: UserAgent) {
    this.#userAgent = userAgent;
  }

  /** Generate a URL in the creating environment's origin without registering it. */
  // https://w3c.github.io/FileAPI/#unicodeBlobURL
  generateURL(env: BlobURLEnvironment): string {
    // The opaque-origin spelling is implementation-defined; browsers use "null".
    return `blob:${serializeOrigin(env.origin)}/${this.#userAgent.generateUUID()}`;
  }

  /** Register an object without copying its data; repeated registration creates distinct URLs. */
  // https://w3c.github.io/FileAPI/#add-an-entry
  add(object: BlobImpl, env: BlobURLEnvironment): string {
    const url = this.generateURL(env);
    this.#entries.set(url, new BlobURLEntry(object, env));
    return url;
  }

  /**
   * Remove the exact registration, accepting its serialized key or a parsed URL.
   * Strings are used as-is; author revocation must parse and check partition access first.
   */
  // https://w3c.github.io/FileAPI/#removeTheEntry
  remove(url: string | URLRecord): void {
    this.#entries.delete(typeof url === 'string' ? url : serializeURL(url));
  }

  /** Revoke an author-supplied URL when its registration belongs to the caller's storage partition. */
  // https://w3c.github.io/FileAPI/#dfn-revokeObjectURL
  revoke(url: string, env: StorageEnvironment): void {
    const record = this.#userAgent.parseURL(url).url;
    if (record === null || record.scheme !== 'blob') return;
    const entry = record.blobURLEntry;
    if (!(entry instanceof BlobURLEntry) || !entry.isSamePartition(env)) return;
    this.remove(record);
  }

  /** Remove every registration created by this environment when its document is unloaded. */
  // https://w3c.github.io/FileAPI/#lifeTime
  removeForEnvironment(env: BlobURLEnvironment): void {
    for (const [url, entry] of this.#entries) {
      if (entry.env === env) this.#entries.delete(url);
    }
  }

  /** Look up a Blob URL without its fragment; obtaining the object is a separate access check. */
  // https://w3c.github.io/FileAPI/#blob-url-resolve
  resolve(url: URLRecord): BlobURLEntry | null {
    if (url.scheme !== 'blob') throw new InternalError('Blob URL resolution requires the blob scheme');
    return this.#entries.get(serializeURL(url, true)) ?? null;
  }
}

/** Retains a registered object and its creator for origin, partition access, and lifetime cleanup. */
// https://w3c.github.io/FileAPI/#blob-url-entry
// PROVISIONAL: entries retain BlobImpl; extend the object type when MediaSource is implemented.
export class BlobURLEntry {
  /** Actual creator supplies the origin and storage key; its identity selects unloading cleanup. */
  env: BlobURLEnvironment;
  #object: BlobImpl;

  constructor(object: BlobImpl, env: BlobURLEnvironment) {
    this.#object = object;
    this.env = env;
  }

  /**
   * Obtain the retained object after the storage-partition check, or null on denial.
   * A caller-established top-level exemption bypasses that check.
   */
  // https://w3c.github.io/FileAPI/#blob-url-obtain-object
  obtainObject(env: StorageEnvironment | 'top-level-navigation' | 'top-level-self-fetch'): BlobImpl | null {
    if (env === 'top-level-navigation' || env === 'top-level-self-fetch') return this.#object;
    return this.isSamePartition(env) ? this.#object : null;
  }

  /** Whether another environment may fetch or revoke this entry; disabled storage does not deny access. */
  // https://w3c.github.io/FileAPI/#check-for-same-partition-blob-url-usage
  isSamePartition(env: StorageEnvironment): boolean {
    const blobStorageKey = StorageKey.obtainForNonStoragePurposes(this.env);
    const envStorageKey = StorageKey.obtainForNonStoragePurposes(env);
    return blobStorageKey.equals(envStorageKey);
  }
}

/** The actual creating settings object; Blob URL registration requires its security origin. */
export interface BlobURLEnvironment extends StorageEnvironment {
  /** Security origin of the creator, including inherited and opaque origins. */
  origin: Origin;
}
