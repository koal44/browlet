import { nonASCIIDigitPattern, surroundingTabOrSpacePattern } from '../infra/patterns';
import { TextCursor } from '../infra/text-cursor';
import { parseHTTPDate } from './headers';
import { isHTTPToken } from './syntax';

/** Parsed directives in received order, including duplicates and unknown names. */
export class CacheControl {
  constructor(public directives: CacheDirective[]) {}

  /** Parse a combined field value; return null for malformed syntax. */
  // https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2
  static parse(input: string): CacheControl | null {
    const cursor = new TextCursor(input);
    const directives: CacheDirective[] = [];
    while (!cursor.eof()) {
      cursor.consumeWhile((ch) => ch === ' ' || ch === '\t' || ch === ',');
      if (cursor.eof()) break;
      const start = cursor.pos();
      cursor.consumeWhile(isHTTPToken);
      const name = cursor.slice(start).toLowerCase();
      if (!name) return null;
      let value: string | null = null;
      if (cursor.match('=')) {
        if (cursor.match('"')) {
          // Cache-Control rejects malformed quotes; Fetch's collector is forgiving.
          value = '';
          while (true) {
            if (cursor.eof()) return null;
            let ch = cursor.next();
            if (ch === '"') break;
            if (ch === '\\') {
              if (cursor.eof()) return null;
              ch = cursor.next();
            }
            if (ch !== '\t' && (ch < ' ' || ch === '\x7f' || ch > '\xff')) return null;
            value += ch;
          }
        } else {
          const start = cursor.pos();
          cursor.consumeWhile(isHTTPToken);
          value = cursor.slice(start);
          if (!value) return null;
        }
      }
      directives.push({ name, value });
      cursor.consumeWhile((ch) => ch === ' ' || ch === '\t');
      if (!cursor.eof() && !cursor.match(',')) return null;
    }
    return new CacheControl(directives);
  }

  /** Test for a directive by its lowercase name. */
  has(name: string): boolean {
    return this.directives.some((directive) => directive.name === name);
  }

  /**
   * Read seconds: undefined if absent, null if invalid or repeated.
   * Use a lowercase name; bare directives return bareValue.
   */
  getDeltaSeconds(name: string, bareValue: number | null = null): number | null | undefined {
    const matches = this.directives.filter((directive) => directive.name === name);
    if (matches.length === 0) return undefined;
    if (matches.length !== 1) return null;
    return matches[0]!.value === null ? bareValue : parseDeltaSeconds(matches[0]!.value);
  }
}

/**
 * Calculate private-cache freshness and stale permissions.
 * Timestamps use epoch milliseconds; returned ages and lifetimes use seconds.
 */
// https://www.rfc-editor.org/rfc/rfc9111.html#section-4.2
// https://www.rfc-editor.org/rfc/rfc5861.html#section-3
// https://www.rfc-editor.org/rfc/rfc5861.html#section-4
export function calculateCacheFreshness(
  headers: CacheHeaderValues,
  status: number,
  timing: CacheTiming,
): CacheFreshness {
  const { requestTime, responseTime, now } = timing;
  const control = CacheControl.parse(headers.cacheControl ?? '');
  const date = parseHTTPDate(headers.date ?? '', responseTime) ?? responseTime;
  // https://www.rfc-editor.org/rfc/rfc9111.html#section-5.1
  // Use only the first Age member, and ignore invalid values.
  const ageField = (headers.age ?? '').split(',', 1)[0]!.replace(surroundingTabOrSpacePattern, '');
  const age = parseDeltaSeconds(ageField) ?? 0;
  const apparentAge = Math.max(0, (responseTime - date) / 1000);
  const responseDelay = (responseTime - requestTime) / 1000;
  const residentTime = (now - responseTime) / 1000;
  const currentAge = Math.min(Number.MAX_SAFE_INTEGER,
    Math.max(apparentAge, age + responseDelay) + residentTime);

  const lifetime = control === null
    ? null
    : getFreshnessLifetime(headers, control, status, date, responseTime);
  const freshnessLifetime = lifetime ?? 0;
  const fresh = currentAge < freshnessLifetime;
  // Qualified no-cache is conservatively treated as unqualified: retaining
  // individual fields for conditional reuse belongs to the cache transaction.
  const requiresValidation = lifetime === null || control?.has('no-cache') === true ||
    !fresh && control?.has('must-revalidate') === true;
  const staleness = currentAge - freshnessLifetime;
  const mayServeStale = control !== null && !fresh && !requiresValidation && !control.has('no-store');
  return {
    currentAge,
    freshnessLifetime,
    fresh,
    requiresValidation,
    staleWhileRevalidate: mayServeStale &&
      staleness < (control.getDeltaSeconds('stale-while-revalidate') ?? 0),
    staleIfError: mayServeStale &&
      staleness < (control.getDeltaSeconds('stale-if-error') ?? 0),
  };
}

/** Test whether a private cache may store a complete GET/HEAD response. */
// https://www.rfc-editor.org/rfc/rfc9111.html#section-3
export function canStoreResponse(
  method: string,
  status: number,
  headers: CacheHeaderValues,
  requestCacheControl = '',
): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (status < 200 || status > 599 || status === 206 || status === 304) return false;
  const responseControl = CacheControl.parse(headers.cacheControl ?? '');
  const requestControl = CacheControl.parse(requestCacheControl);
  if (responseControl === null || requestControl === null) return false;
  if (requestControl.has('no-store')) return false;
  if (responseControl.has('no-store') || responseControl.has('must-understand')) return false;

  // Wildcard Vary responses can only be reused after validation. Choosing not
  // to store them (or malformed Vary) is permitted, and avoids useless entries.
  const vary = parseVary(headers.vary ?? '');
  if (vary === null || vary.includes('*')) return false;

  // No-cache permits storage, even without a validator. Invalid expiration
  // values permit storage too; freshness calculation requires validation.
  // Private caches have no shared-cache Authorization restriction (§3.5).
  return heuristicallyCacheableStatuses.includes(status) || headers.expires !== undefined ||
    responseControl.has('public') || responseControl.has('private') || responseControl.has('max-age');
}

/**
 * Apply request restrictions to a storable, matching response.
 * onlyIfCached denotes the HTTP directive, not Fetch's cache mode.
 */
// https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.1
export function evaluateCacheRequest(
  freshness: CacheFreshness,
  cacheControl = '',
): CacheRequestPolicy {
  const control = CacheControl.parse(cacheControl);
  const onlyIfCached = control?.has('only-if-cached') ?? false;
  if (control === null || freshness.requiresValidation ||
    control.has('no-cache')) return { canReuse: false, onlyIfCached };

  const maxAge = control.getDeltaSeconds('max-age');
  const minFresh = control.getDeltaSeconds('min-fresh');
  const maxStale = control.getDeltaSeconds('max-stale', Infinity);
  const { currentAge, freshnessLifetime, fresh } = freshness;
  const canReuse = maxAge !== null && minFresh !== null && maxStale !== null &&
    (maxAge === undefined || currentAge <= maxAge) &&
    (minFresh === undefined || freshnessLifetime >= currentAge + minFresh) &&
    (fresh || maxStale !== undefined && currentAge - freshnessLifetime <= maxStale);
  // Request no-store prevents new storage, not reuse of an existing response.
  return { canReuse, onlyIfCached };
}

/** Test whether the method and status require invalidation; Fetch selects the URIs. */
// https://www.rfc-editor.org/rfc/rfc9111.html#section-4.4
export function shouldInvalidateCache(method: string, status: number): boolean {
  return status >= 200 && status < 400 && !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method);
}

/** Parse nonnegative seconds, saturating on integer overflow. */
// https://www.rfc-editor.org/rfc/rfc9111.html#section-1.2.2
export function parseDeltaSeconds(input: string): number | null {
  if (input === '' || nonASCIIDigitPattern.test(input)) return null;
  return Math.min(Number(input), Number.MAX_SAFE_INTEGER);
}

/** Parse lowercase field names, preserving order, duplicates, and wildcard members. */
// https://www.rfc-editor.org/rfc/rfc9110.html#section-12.5.5
export function parseVary(input: string): string[] | null {
  const names: string[] = [];
  for (const member of input.split(',')) {
    const name = member.replace(surroundingTabOrSpacePattern, '');
    if (!name) continue;
    if (!isHTTPToken(name)) return null;
    names.push(name.toLowerCase());
  }
  return names;
}

export type CacheDirective = {
  name: string;
  /** Null for an argument-free directive; an empty string is an explicit argument. */
  value: string | null;
};

/** Combined, unparsed header values; missing headers remain absent. */
export type CacheHeaderValues = {
  cacheControl?: string;
  date?: string;
  age?: string;
  expires?: string;
  lastModified?: string;
  vary?: string;
};

/** Finite timestamps supplied by the caller, with requestTime <= responseTime <= now. */
export type CacheTiming = {
  requestTime: number;
  responseTime: number;
  now: number;
};

export type CacheFreshness = {
  currentAge: number;
  freshnessLifetime: number;
  fresh: boolean;
  requiresValidation: boolean;
  staleWhileRevalidate: boolean;
  staleIfError: boolean;
};

export type CacheRequestPolicy = {
  canReuse: boolean;
  onlyIfCached: boolean;
};

function getFreshnessLifetime(
  headers: CacheHeaderValues,
  control: CacheControl,
  status: number,
  date: number,
  responseTime: number,
): number | null {
  // s-maxage applies only to shared caches. max-age overrides Expires,
  // including an invalid Expires value (RFC 9111 §5.3).
  const maxAge = control.getDeltaSeconds('max-age');
  if (maxAge !== undefined) return maxAge;
  if (headers.expires !== undefined) {
    const expires = parseHTTPDate(headers.expires, responseTime);
    return expires === null ? null : Math.max(0, (expires - date) / 1000);
  }

  // https://www.rfc-editor.org/rfc/rfc9111.html#section-4.2.2
  // Heuristics apply only without explicit expiration. The 10% formula is our policy.
  if (!heuristicallyCacheableStatuses.includes(status) && !control.has('public') && !control.has('private')) return 0;
  const lastModified = parseHTTPDate(headers.lastModified ?? '', responseTime);
  return lastModified === null ? 0 : Math.max(0, (date - lastModified) / 10_000);
}

// https://www.rfc-editor.org/rfc/rfc9110.html#section-15.1
// Storage still needs the method and other cacheability rules.
const heuristicallyCacheableStatuses = [200, 203, 204, 206, 300, 301, 308, 404, 405, 410, 414, 501];
