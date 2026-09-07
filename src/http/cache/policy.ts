import { getDeltaDirective, parseCacheControl, parseVary } from './fields';
import {
  heuristicallyCacheableStatuses, type CacheFields, type CacheFreshness,
} from './freshness';

/**
 * RFC 9111 §3: storage eligibility for complete GET/HEAD responses in a
 * private cache. Actual body retention and header processing belong to Fetch.
 * Partial responses, 304 updates, and must-understand storage are deferred
 * until their status-specific storage behavior exists. No-store stays binding.
 */
export function canStoreResponse(
  method: string,
  status: number,
  fields: CacheFields,
  requestCacheControl = '',
): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (status < 200 || status > 599 || status === 206 || status === 304) return false;
  const responseDirectives = parseCacheControl(fields.cacheControl ?? '');
  const requestDirectives = parseCacheControl(requestCacheControl);
  if (responseDirectives === null || requestDirectives === null) return false;
  if (requestDirectives.some(({ name }) => name === 'no-store')) return false;
  if (responseDirectives.some(({ name }) => name === 'no-store' || name === 'must-understand')) return false;

  // Wildcard Vary responses can only be reused after validation. Choosing not
  // to store them (or malformed Vary) is permitted, and avoids useless entries.
  const vary = parseVary(fields.vary ?? '');
  if (vary === null || vary.includes('*')) return false;

  // No-cache permits storage, even without a validator. Invalid expiration
  // values permit storage too; freshness calculation requires validation.
  // Private caches have no shared-cache Authorization restriction (§3.5).
  return heuristicallyCacheableStatuses.includes(status) || fields.expires !== undefined ||
    responseDirectives.some(({ name }) => name === 'public' || name === 'private' || name === 'max-age');
}

/**
 * RFC 9111 §5.2.1: request restrictions on an already storable, matching
 * response. Reuse here means fresh or explicitly permitted by max-stale;
 * SWR/SIE, validation, and Fetch cache modes need their separate transactions.
 * onlyIfCached is the HTTP directive, not Fetch's similarly named cache mode.
 */
export function evaluateCacheRequest(
  freshness: CacheFreshness,
  cacheControl = '',
): CacheRequestPolicy {
  const directives = parseCacheControl(cacheControl);
  const onlyIfCached = directives?.some(({ name }) => name === 'only-if-cached') ?? false;
  if (directives === null || freshness.requiresValidation ||
    directives.some(({ name }) => name === 'no-cache')) return { canReuse: false, onlyIfCached };

  const maxAge = getDeltaDirective(directives, 'max-age');
  const minFresh = getDeltaDirective(directives, 'min-fresh');
  const maxStale = getDeltaDirective(directives, 'max-stale', Infinity);
  const { currentAge, freshnessLifetime, fresh } = freshness;
  const canReuse = maxAge !== null && minFresh !== null && maxStale !== null &&
    (maxAge === undefined || currentAge <= maxAge) &&
    (minFresh === undefined || freshnessLifetime >= currentAge + minFresh) &&
    (fresh || maxStale !== undefined && currentAge - freshnessLifetime <= maxStale);
  // Request no-store prevents new storage, not reuse of an existing response.
  return { canReuse, onlyIfCached };
}

/**
 * RFC 9111 §4.4: non-error responses to unsafe methods (or methods whose
 * safety is unknown) trigger invalidation. URI selection/deletion needs Fetch.
 */
export function shouldInvalidateCache(method: string, status: number): boolean {
  return status >= 200 && status < 400 && !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method);
}

export type CacheRequestPolicy = {
  readonly canReuse: boolean;
  readonly onlyIfCached: boolean;
};
