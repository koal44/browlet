import type { Origin, URLRecord } from '../url/index';

/** The Storage-owned view of an HTML settings object or an earlier environment record. */
export interface StorageEnvironment {
  /** Browser owner supplying storage policy and identifier generation. */
  userAgent: StorageUserAgent;
  /** Creation URL supplies the origin before settings exist. */
  creationURL: URLRecord;
  /** Actual security origin once settings exist; it can differ from the creation URL's origin. */
  origin?: Origin;
}

/** Browser facilities shared by storage environments and their Blob URL store. */
export interface StorageUserAgent {
  /** Whether storage APIs may obtain a key. Non-storage checks ignore this preference. */
  storageEnabled: boolean;
  /** Generate a fresh canonical UUID for a registration. */
  generateUUID(): string;
}
