import type { GlobalObject } from '../js-engine/index';
import type { Origin, URLRecord } from '../url/index';

import type { StorageShed } from './sheds';

/** The Storage-owned view of a full or reserved HTML environment. */
export interface StorageEnvironmentBase {
  /** Browser owner supplying storage policy and identifier generation. */
  userAgent: StorageUserAgent;
  /** Creation URL supplies the origin before settings exist. */
  creationURL: URLRecord;
  /** Actual security origin once settings exist; it can differ from the creation URL's origin. */
  origin?: Origin;
}

/** The full owning environment, including storage maps and task delivery. */
export interface StorageEnvironment extends StorageEnvironmentBase {
  /** Browser owner supplying storage state and policy. */
  userAgent: StorageUserAgent;
  /** Security origin of the initialized environment. */
  origin: Origin;
  /** Resolve the Window's current traversable shed; requires a Document with a node navigable. */
  getSessionStorageShed(): StorageShed;
  /** Queue storage work on the specified global's event loop, retaining its associated Document. */
  queueStorageTask(global: GlobalObject, steps: () => void): void;
}

/** Browser facilities shared by storage environments and their Blob URL store. */
export interface StorageUserAgent {
  /** Local storage shared by this browser's environments. */
  storageShed: StorageShed;
  /** Whether storage APIs may obtain a key. Non-storage checks ignore this preference. */
  storageEnabled: boolean;
  /** Fixed quota estimate in bytes, applied independently to each local or session shelf. */
  storageQuotaBytes: number;
  /** Generate a fresh canonical UUID for a registration. */
  generateUUID(): string;
}
