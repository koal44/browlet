import { parseHTTPDate } from '../date';
import { getDeltaDirective, parseCacheControl, parseDeltaSeconds, type CacheDirective } from './fields';

/**
 * RFC 9111 §4.2 and RFC 5861 §§3–4, for a private browser cache.
 * Timestamps are UTC epoch milliseconds; returned ages/lifetimes are seconds.
 * Freshness alone does not establish storage eligibility or request matching.
 * Stale windows describe response-side permission, not network-error handling
 * or the act of scheduling revalidation. The Fetch transaction owns those.
 */
export function calculateCacheFreshness(
  fields: CacheFields,
  status: number,
  timing: CacheTiming,
): CacheFreshness {
  const { requestTime, responseTime, now } = timing;
  const directives = parseCacheControl(fields.cacheControl ?? '');
  const date = parseHTTPDate(fields.date ?? '', responseTime) ?? responseTime;
  // RFC 9111 §5.1: use only the first Age member, and ignore invalid values.
  const ageField = (fields.age ?? '').split(',', 1)[0]!.replace(/^[ \t]+|[ \t]+$/g, '');
  const age = parseDeltaSeconds(ageField) ?? 0;
  const apparentAge = Math.max(0, (responseTime - date) / 1000);
  const responseDelay = (responseTime - requestTime) / 1000;
  const residentTime = (now - responseTime) / 1000;
  const currentAge = Math.min(Number.MAX_SAFE_INTEGER,
    Math.max(apparentAge, age + responseDelay) + residentTime);

  const lifetime = directives === null
    ? null
    : getFreshnessLifetime(fields, directives, status, date, responseTime);
  const freshnessLifetime = lifetime ?? 0;
  const fresh = currentAge < freshnessLifetime;
  const has = (name: string) => directives?.some((directive) => directive.name === name) ?? false;
  // Qualified no-cache is conservatively treated as unqualified: retaining
  // individual fields for conditional reuse belongs to the cache transaction.
  const requiresValidation = lifetime === null || has('no-cache') ||
    !fresh && has('must-revalidate');
  const staleness = currentAge - freshnessLifetime;
  const mayServeStale = !fresh && !requiresValidation && !has('no-store');
  return {
    currentAge,
    freshnessLifetime,
    fresh,
    requiresValidation,
    staleWhileRevalidate: mayServeStale &&
      staleness < (getDeltaDirective(directives!, 'stale-while-revalidate') ?? 0),
    staleIfError: mayServeStale &&
      staleness < (getDeltaDirective(directives!, 'stale-if-error') ?? 0),
  };
}

/** Combined field values; missing fields remain absent. No Fetch objects needed. */
export type CacheFields = {
  readonly cacheControl?: string;
  readonly date?: string;
  readonly age?: string;
  readonly expires?: string;
  readonly lastModified?: string;
  readonly vary?: string;
};

/** Finite timestamps supplied by the caller, with requestTime <= responseTime <= now. */
export type CacheTiming = {
  readonly requestTime: number;
  readonly responseTime: number;
  readonly now: number;
};

export type CacheFreshness = {
  readonly currentAge: number;
  readonly freshnessLifetime: number;
  readonly fresh: boolean;
  readonly requiresValidation: boolean;
  readonly staleWhileRevalidate: boolean;
  readonly staleIfError: boolean;
};

// RFC 9110 §15.1. Storage still needs the method and other cacheability rules.
export const heuristicallyCacheableStatuses: readonly number[] = [200, 203, 204, 206, 300, 301, 308, 404, 405, 410, 414, 501];

function getFreshnessLifetime(
  fields: CacheFields,
  directives: readonly CacheDirective[],
  status: number,
  date: number,
  responseTime: number,
): number | null {
  // s-maxage applies only to shared caches. max-age overrides Expires,
  // including an invalid Expires value (RFC 9111 §5.3).
  const maxAge = getDeltaDirective(directives, 'max-age');
  if (maxAge !== undefined) return maxAge;
  if (fields.expires !== undefined) {
    const expires = parseHTTPDate(fields.expires, responseTime);
    return expires === null ? null : Math.max(0, (expires - date) / 1000);
  }

  // RFC 9111 §4.2.2 permits heuristics only without explicit expiration.
  // 10% of time since Last-Modified is our policy, not a mandated formula.
  if (!heuristicallyCacheableStatuses.includes(status) &&
    !directives.some(({ name }) => name === 'public' || name === 'private')) return 0;
  const lastModified = parseHTTPDate(fields.lastModified ?? '', responseTime);
  return lastModified === null ? 0 : Math.max(0, (date - lastModified) / 10_000);
}
