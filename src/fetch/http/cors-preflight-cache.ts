import type { FetchRequest } from '../request';

/** Browser-owned CORS preflight permissions, separate from cached HTTP responses. */
export class CORSPreflightCache {
  /** Remove permissions matching the request's network partition, origin, and URL. */
  // https://fetch.spec.whatwg.org/#concept-cache-clear
  clearEntries(_request: FetchRequest): void {
    // PROVISIONAL(Fetch 9): no entries can be inserted yet. Add matching removal
    // with preflight-cache lookup, insertion, credentials checks, and expiration.
  }

  /** Whether an unexpired permission covers this method for the request. */
  // https://fetch.spec.whatwg.org/#concept-cache-match-method
  matchesMethod(_method: string, _request: FetchRequest): boolean {
    // PROVISIONAL(Fetch 9): the cache is empty until preflight can insert permissions.
    return false;
  }

  /** Whether an unexpired permission covers this header name for the request. */
  // https://fetch.spec.whatwg.org/#concept-cache-match-header
  matchesHeaderName(_name: string, _request: FetchRequest): boolean {
    // PROVISIONAL(Fetch 9): the cache is empty until preflight can insert permissions.
    return false;
  }
}
