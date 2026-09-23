import { InternalError } from '../../../infra/internal-error';
import { StorageKey, type StorageEnvironment, type StorageUserAgent } from '../../../storage/index';
import { parseURL, serializeOrigin, serializeURL, type Origin, type URLRecord } from '../../../url/index';
import type { BlobImpl } from '../../../file/index';

/** User-agent-owned registrations that retain their objects and creating environments. */
// https://w3c.github.io/FileAPI/#BlobURLStore
export class BlobURLStore {
  #entries = new Map<string, BlobURLEntry>();
  #userAgent: StorageUserAgent;

  constructor(userAgent: StorageUserAgent) {
    this.#userAgent = userAgent;
  }

  /** Generate a URL in the creating environment's origin without registering it. */
  // https://w3c.github.io/FileAPI/#unicodeBlobURL
  // SPEC_MISMATCH: generate a new blob URL() -> string
  generateURL(environment: BlobURLEnvironment): string {
    // The opaque-origin spelling is implementation-defined; browsers use "null".
    return `blob:${serializeOrigin(environment.origin)}/${this.#userAgent.generateUUID()}`;
  }

  /** Register an object without copying its data; repeated registration creates distinct URLs. */
  // https://w3c.github.io/FileAPI/#add-an-entry
  add(object: BlobImpl, environment: BlobURLEnvironment): string {
    const url = this.generateURL(environment);
    this.#entries.set(url, new BlobURLEntry(object, environment));
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
  revoke(url: string, environment: StorageEnvironment): void {
    const record = parseURL(url, null, 'UTF-8', this).url;
    if (record === null || record.scheme !== 'blob') return;
    const entry = record.blobURLEntry;
    if (!(entry instanceof BlobURLEntry) || !entry.isSamePartition(environment)) return;
    this.remove(record);
  }

  /** Remove every registration created by this environment when its document is unloaded. */
  // https://w3c.github.io/FileAPI/#lifeTime
  removeForEnvironment(environment: BlobURLEnvironment): void {
    for (const [url, entry] of this.#entries) {
      if (entry.environment === environment) this.#entries.delete(url);
    }
  }

  /** Look up a Blob URL without its fragment; obtaining the object is a separate access check. */
  // https://w3c.github.io/FileAPI/#blob-url-resolve
  resolve(url: URLRecord): BlobURLEntry | null {
    if (url.scheme !== 'blob') throw new InternalError('Blob URL resolution requires the blob scheme');
    return this.#entries.get(serializeURL(url, true)) ?? null;
  }
}

/** Retains a registered object and the environment whose storage key controls access. */
// https://w3c.github.io/FileAPI/#blob-url-entry
// PROVISIONAL: entries retain BlobImpl; extend the object type when MediaSource is implemented.
export class BlobURLEntry {
  /** Actual creating settings object, also used by URL's origin algorithm. */
  environment: BlobURLEnvironment;
  #object: BlobImpl;

  constructor(object: BlobImpl, environment: BlobURLEnvironment) {
    this.#object = object;
    this.environment = environment;
  }

  /**
   * Obtain the retained object after the storage-partition check, or null on denial.
   * A caller-established top-level exemption bypasses that check.
   */
  // https://w3c.github.io/FileAPI/#blob-url-obtain-object
  // SPEC_MISMATCH: obtain a blob object(blobUrlEntry, environment) -> object or failure
  obtainObject(environment: StorageEnvironment | 'top-level-navigation' | 'top-level-self-fetch'): BlobImpl | null {
    if (typeof environment !== 'string' && !this.isSamePartition(environment)) return null;
    return this.#object;
  }

  /** Whether another environment may fetch or revoke this entry; disabled storage does not deny access. */
  // https://w3c.github.io/FileAPI/#check-for-same-partition-blob-url-usage
  // SPEC_MISMATCH: check for same-partition blob URL usage(blobUrlEntry, environment) -> boolean
  isSamePartition(environment: StorageEnvironment): boolean {
    const blobStorageKey = StorageKey.obtainForNonStoragePurposes(this.environment);
    const environmentStorageKey = StorageKey.obtainForNonStoragePurposes(environment);
    return blobStorageKey.equals(environmentStorageKey);
  }
}

/** The actual creating settings object; Blob URL registration requires its security origin. */
export interface BlobURLEnvironment extends StorageEnvironment {
  /** Security origin of the creator, including inherited and opaque origins. */
  origin: Origin;
}
