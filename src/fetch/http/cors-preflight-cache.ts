import type { FetchRequest } from '../request';

/** Browser-owned CORS preflight permissions, separate from cached HTTP responses. */
export class CORSPreflightCache {
  /** Remove permissions matching the request's network partition, origin, and URL. */
  // https://fetch.spec.whatwg.org/#concept-cache-clear
  clearEntries(_request: FetchRequest): void {
    // PROVISIONAL(Fetch 9): no entries can be inserted yet. Add matching removal
    // with preflight-cache lookup, insertion, credentials checks, and expiration.
  }
}
