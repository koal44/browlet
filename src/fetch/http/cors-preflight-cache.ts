import { serializeURL } from '../../url/index';
import { isCORSNonWildcardRequestHeaderName } from '../headers';
import type { FetchRequest } from '../request';
import { networkPartitionKeysEqual, type NetworkPartitionKey } from './network-partition';

/** Browser-owned CORS preflight permissions, separate from cached HTTP responses. */
export class CORSPreflightCache {
  /** Maximum permission lifetime in seconds; Fetch leaves this limit to the user agent. */
  maxAge = 7200;
  /** Bound retained permissions, evicting the oldest stored entry when full. */
  maxEntries = 1024;
  #entries: CORSPreflightCacheEntry[] = [];

  /** Store or refresh one allowed method or header, without retaining the requesting environment. */
  // Fetch §4.8's cache updates and §4.9's cache-entry creation.
  store(request: FetchRequest, maxAge: number, method: string | null, headerName: string | null): void {
    const key = request.determineNetworkPartitionKey();
    // Like HTTP caching, clientless requests without a partition cannot retain permissions.
    if (key === null) return;
    const now = request.userAgent.unsafeSharedCurrentTime();
    this.#entries = this.#entries.filter((entry) => entry.expiresAt > now);
    const expiresAt = now + Math.min(maxAge, this.maxAge) * 1000;
    const credentials = request.credentialsMode === 'include';
    const name = headerName?.toLowerCase() ?? null;
    // SPEC_CLASH(cors-cache-permission-refresh): Fetch refreshes broad lookup matches; browsers do not extend broader old grants from a narrower response.
    // Refresh only the same permission and credentials flag; broader grants keep their original expiry.
    const existing = this.#find(request, (entry) => entry.credentials === credentials &&
      entry.method === method && entry.headerName === name);
    if (existing) {
      existing.expiresAt = expiresAt;
      return;
    }
    if (expiresAt <= now || this.maxEntries === 0) return;
    this.#entries.push({
      key, origin: request.serializeOrigin(), url: serializeURL(request.currentURL), expiresAt,
      credentials, method, headerName: name,
    });
    while (this.#entries.length > this.maxEntries) this.#entries.shift();
  }

  /** Remove permissions matching the request's network partition, origin, and URL. */
  // https://fetch.spec.whatwg.org/#concept-cache-clear
  clearEntries(request: FetchRequest): void {
    const key = request.determineNetworkPartitionKey();
    if (key === null) return;
    const origin = request.serializeOrigin();
    const url = serializeURL(request.currentURL);
    this.#entries = this.#entries.filter((entry) =>
      !networkPartitionKeysEqual(entry.key, key) || entry.origin !== origin || entry.url !== url);
  }

  /** Whether an unexpired permission covers this method for the request. */
  // https://fetch.spec.whatwg.org/#concept-cache-match-method
  matchesMethod(method: string, request: FetchRequest): boolean {
    return this.#find(request, (entry) => matchesMethod(entry, method, request)) !== undefined;
  }

  /** Whether an unexpired permission covers this header name for the request. */
  // https://fetch.spec.whatwg.org/#concept-cache-match-header
  matchesHeaderName(name: string, request: FetchRequest): boolean {
    return this.#find(request, (entry) => matchesHeaderName(entry, name, request)) !== undefined;
  }

  #find(request: FetchRequest, matches: (entry: CORSPreflightCacheEntry) => boolean): CORSPreflightCacheEntry | undefined {
    const key = request.determineNetworkPartitionKey();
    if (key === null) return undefined;
    const origin = request.serializeOrigin();
    const url = serializeURL(request.currentURL);
    const now = request.userAgent.unsafeSharedCurrentTime();
    return this.#entries.find((entry) => entry.expiresAt > now &&
      networkPartitionKeysEqual(entry.key, key) && entry.origin === origin && entry.url === url &&
      (entry.credentials || request.credentialsMode !== 'include') && matches(entry));
  }
}

// Serialized URL/origin values avoid retaining mutable request state; a monotonic
// deadline represents max-age without retaining the request's environment or a timer.
// SPEC_MISMATCH: cache entry: key, byte-serialized origin, URL, max-age, credentials, method, header name
interface CORSPreflightCacheEntry {
  key: NetworkPartitionKey;
  origin: string;
  url: string;
  expiresAt: number;
  credentials: boolean;
  method: string | null;
  headerName: string | null;
}

function matchesMethod(entry: CORSPreflightCacheEntry, method: string, request: FetchRequest): boolean {
  return entry.method === method || entry.method === '*' && matchesWildcard(request);
}

function matchesHeaderName(entry: CORSPreflightCacheEntry, name: string, request: FetchRequest): boolean {
  return entry.headerName === name.toLowerCase() || entry.headerName === '*' &&
    !isCORSNonWildcardRequestHeaderName(name) && matchesWildcard(request);
}

function matchesWildcard(request: FetchRequest): boolean {
  // SPEC_CLASH(cors-cache-credentialed-wildcard): §4.9 permits wildcard reuse with credentials; §3.3 and browsers restrict it.
  // Apply §3.3's restriction on reuse too; a credentialed request needs an explicit match.
  return request.credentialsMode !== 'include';
}
