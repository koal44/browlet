import { describe, expect, it } from 'vitest';

import { calculateCacheFreshness } from '../../../src/fetch/http/cache/freshness';
import {
  canStoreResponse, evaluateCacheRequest, shouldInvalidateCache,
} from '../../../src/fetch/http/cache/policy';

const received = Date.UTC(2026, 8, 7, 12);
const timing = { requestTime: received, responseTime: received, now: received };

describe('private HTTP cache storage policy (RFC 9111 §3)', () => {
  it.each([200, 203, 204, 300, 301, 308, 404, 405, 410, 414, 501])(
    'allows a complete GET response with heuristically cacheable status %i', (status) => {
      expect(canStoreResponse('GET', status, {})).toBe(true);
    },
  );

  it.each(['public', 'private', 'private="Set-Cookie, Authorization"', 'max-age=60'])(
    'allows explicitly cacheable responses with %j', (cacheControl) => {
      expect(canStoreResponse('GET', 302, { cacheControl })).toBe(true);
    },
  );

  it('allows HEAD storage without claiming its fields can satisfy a GET body', () => {
    expect(canStoreResponse('HEAD', 200, {})).toBe(true);
  });

  it.each(['POST', 'PUT', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT', 'CUSTOM', 'get'])(
    'leaves unsupported method %s unstored', (method) => {
      expect(canStoreResponse(method, 200, { cacheControl: 'public, max-age=60' })).toBe(false);
    },
  );

  it.each([0, 100, 103, 199, 206, 304, 600])('does not store status %i as a complete response', (status) => {
    expect(canStoreResponse('GET', status, { cacheControl: 'public, max-age=60' })).toBe(false);
  });

  it('requires explicit permission for non-heuristic status codes', () => {
    expect(canStoreResponse('GET', 302, {})).toBe(false);
    expect(canStoreResponse('GET', 500, {})).toBe(false);
    expect(canStoreResponse('GET', 500, { cacheControl: 'max-age=60' })).toBe(true);
    expect(canStoreResponse('GET', 302, { expires: new Date(received).toUTCString() })).toBe(true);
  });

  it('does not treat shared-cache directives or stale extensions as storage permission', () => {
    expect(canStoreResponse('GET', 302, { cacheControl: 's-maxage=60' })).toBe(false);
    expect(canStoreResponse('GET', 302, {
      cacheControl: 'stale-while-revalidate=30, stale-if-error=30',
    })).toBe(false);
    expect(canStoreResponse('GET', 200, { cacheControl: 'private, s-maxage=0' })).toBe(true);
  });

  it.each(['no-store', 'NO-STORE', 'private, no-store', 'public, no-store', 'no-store="ignored"'])(
    'honors response storage prohibition %j', (cacheControl) => {
      expect(canStoreResponse('GET', 200, { cacheControl })).toBe(false);
    },
  );

  it('honors request no-store independently of response permission', () => {
    expect(canStoreResponse('GET', 200, { cacheControl: 'public' }, 'no-store')).toBe(false);
    expect(canStoreResponse('GET', 200, { cacheControl: 'max-age=60' }, 'private')).toBe(true);
  });

  it('allows storing responses that require validation, even without a validator', () => {
    expect(canStoreResponse('GET', 200, { cacheControl: 'no-cache' })).toBe(true);
    expect(canStoreResponse('GET', 200, { cacheControl: 'no-cache="ETag"' }, 'no-cache')).toBe(true);
    expect(canStoreResponse('GET', 302, { expires: '0' })).toBe(true);
    expect(canStoreResponse('GET', 302, { cacheControl: 'max-age=invalid' })).toBe(true);
  });

  it('does not opt into must-understand storage before status-specific storage exists', () => {
    expect(canStoreResponse('GET', 200, { cacheControl: 'must-understand, max-age=60' })).toBe(false);
    expect(canStoreResponse('GET', 471, { cacheControl: 'must-understand, public' })).toBe(false);
    expect(canStoreResponse('GET', 200, { cacheControl: 'must-understand, no-store' })).toBe(false);
  });

  it('ignores unknown well-formed directives', () => {
    expect(canStoreResponse('GET', 200, { cacheControl: 'extension="a,b"' }, 'extension=42')).toBe(true);
  });

  it('declines malformed Cache-Control on either side', () => {
    expect(canStoreResponse('GET', 200, { cacheControl: 'public; no-store' })).toBe(false);
    expect(canStoreResponse('GET', 200, {}, 'no-store; max-age=60')).toBe(false);
  });

  it('leaves wildcard and malformed Vary responses unstored', () => {
    expect(canStoreResponse('GET', 200, { vary: '*' })).toBe(false);
    expect(canStoreResponse('GET', 200, { vary: 'Accept, *' })).toBe(false);
    expect(canStoreResponse('GET', 200, { vary: 'Accept; Accept-Language' })).toBe(false);
    expect(canStoreResponse('GET', 200, { vary: 'Accept, Accept-Language' })).toBe(true);
  });
});

describe('request restrictions on cache reuse (RFC 9111 §5.2.1)', () => {
  const fresh = calculateCacheFreshness({ cacheControl: 'max-age=60' }, 200, {
    ...timing, now: received + 20_000,
  });
  const stale = calculateCacheFreshness({ cacheControl: 'max-age=60' }, 200, {
    ...timing, now: received + 70_000,
  });

  it('permits a fresh response but not an unconditionally stale response', () => {
    expect(evaluateCacheRequest(fresh)).toEqual({ canReuse: true, onlyIfCached: false });
    expect(evaluateCacheRequest(stale).canReuse).toBe(false);
  });

  it('allows an existing response for request no-store, while prohibiting new storage', () => {
    expect(evaluateCacheRequest(fresh, 'no-store').canReuse).toBe(true);
    expect(canStoreResponse('GET', 200, {}, 'no-store')).toBe(false);
  });

  it('requires validation for request or response no-cache, regardless of freshness', () => {
    expect(evaluateCacheRequest(fresh, 'no-cache').canReuse).toBe(false);
    const response = calculateCacheFreshness({ cacheControl: 'max-age=60, no-cache' }, 200, timing);
    expect(evaluateCacheRequest(response).canReuse).toBe(false);
  });

  it('honors inclusive request max-age and min-fresh limits', () => {
    expect(evaluateCacheRequest(fresh, 'max-age=20').canReuse).toBe(true);
    expect(evaluateCacheRequest(fresh, 'max-age=19').canReuse).toBe(false);
    expect(evaluateCacheRequest(fresh, 'min-fresh=40').canReuse).toBe(true);
    expect(evaluateCacheRequest(fresh, 'min-fresh=41').canReuse).toBe(false);
    expect(evaluateCacheRequest(fresh, 'max-age=20, min-fresh=41').canReuse).toBe(false);
  });

  it('accepts quoted numeric directives from recipients', () => {
    expect(evaluateCacheRequest(fresh, 'MAX-AGE="20", MIN-FRESH="40"').canReuse).toBe(true);
  });

  it('permits max-stale up to and including its requested limit', () => {
    expect(evaluateCacheRequest(stale, 'max-stale=10').canReuse).toBe(true);
    expect(evaluateCacheRequest(stale, 'max-stale=9').canReuse).toBe(false);
    expect(evaluateCacheRequest(stale, 'max-stale').canReuse).toBe(true);
    expect(evaluateCacheRequest(stale, 'max-stale, max-age=69').canReuse).toBe(false);
    expect(evaluateCacheRequest(stale, 'max-stale, min-fresh=0').canReuse).toBe(false);
  });

  it('distinguishes newly expired from fresh at the lifetime boundary', () => {
    const expired = calculateCacheFreshness({ cacheControl: 'max-age=60' }, 200, {
      ...timing, now: received + 60_000,
    });
    expect(evaluateCacheRequest(expired).canReuse).toBe(false);
    expect(evaluateCacheRequest(expired, 'max-stale=0').canReuse).toBe(true);
  });

  it.each(['no-cache', 'must-revalidate'])(
    'does not let max-stale override response %s', (directive) => {
      const response = calculateCacheFreshness({ cacheControl: `max-age=60, ${directive}` }, 200, {
        ...timing, now: received + 70_000,
      });
      expect(evaluateCacheRequest(response, 'max-stale').canReuse).toBe(false);
    },
  );

  it.each([
    'max-age', 'min-fresh', 'max-age=-1', 'min-fresh=invalid', 'max-stale=-1',
    'max-age=20, max-age=20', 'min-fresh=1, min-fresh=2', 'max-stale, max-stale=10',
    'max-age=20; no-cache',
  ])('conservatively rejects reuse for invalid or duplicate constraints %j', (cacheControl) => {
    expect(evaluateCacheRequest(fresh, cacheControl).canReuse).toBe(false);
  });

  it('keeps only-if-cached visible on both cache hits and misses', () => {
    expect(evaluateCacheRequest(fresh, 'only-if-cached')).toEqual({ canReuse: true, onlyIfCached: true });
    expect(evaluateCacheRequest(stale, 'only-if-cached')).toEqual({ canReuse: false, onlyIfCached: true });
    expect(evaluateCacheRequest(fresh, 'only-if-cached, no-cache')).toEqual({
      canReuse: false, onlyIfCached: true,
    });
    expect(evaluateCacheRequest(fresh, 'only-if-cached, max-age=invalid').onlyIfCached).toBe(true);
  });

  it('does not turn response stale extensions into unconditional reuse', () => {
    const response = calculateCacheFreshness({
      cacheControl: 'max-age=60, stale-while-revalidate=30, stale-if-error=30',
    }, 200, { ...timing, now: received + 70_000 });
    expect(response.staleWhileRevalidate).toBe(true);
    expect(response.staleIfError).toBe(true);
    expect(evaluateCacheRequest(response).canReuse).toBe(false);
  });

  it('ignores unknown and response-only request directives', () => {
    expect(evaluateCacheRequest(fresh, 's-maxage=0, must-revalidate, extension="a,b"').canReuse).toBe(true);
  });
});

describe('cache invalidation trigger (RFC 9111 §4.4)', () => {
  it.each(['GET', 'HEAD', 'OPTIONS', 'TRACE'])('does not invalidate for safe method %s', (method) => {
    expect(shouldInvalidateCache(method, 200)).toBe(false);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'CUSTOM'])(
    'invalidates for a non-error %s response, including unknown method safety', (method) => {
      expect(shouldInvalidateCache(method, 200)).toBe(true);
      expect(shouldInvalidateCache(method, 302)).toBe(true);
    },
  );

  it.each([0, 100, 103, 400, 404, 500])('does not invalidate after status %i', (status) => {
    expect(shouldInvalidateCache('POST', status)).toBe(false);
  });
});
