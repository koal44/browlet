import type { URLRecord } from '../../url/index';

/** Module name mappings, scoped overrides, and integrity metadata for one global. */
// https://html.spec.whatwg.org/multipage/webappapis.html#import-map
export interface ImportMap {
  imports: ModuleSpecifierMap;
  /** Scope normalization stores serialized URL prefixes, in descending order. */
  scopes: Map<string, ModuleSpecifierMap>;
  integrity: ModuleIntegrityMap;
}

/** Normalized module specifiers mapped to URLs, or null to block resolution. */
export type ModuleSpecifierMap = Map<string, URLRecord | null>;

/** Integrity metadata indexed by resolved module URLs. */
export type ModuleIntegrityMap = Map<URLRecord, string>;

/** A completed resolution that later import maps must not change. */
// https://html.spec.whatwg.org/multipage/webappapis.html#specifier-resolution-record
export interface SpecifierResolutionRecord {
  serializedBaseURL: string | null;
  specifier: string;
  specifierAsURL: URLRecord | null;
}
