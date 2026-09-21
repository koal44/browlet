import { hostsEqual, type URLPath } from '../../url/index';
import { HTTPCookie, type CookieHost, type CookieSameSite, type StoredHTTPCookie } from './cookie';

/* https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.1.1 */
/** Stores cookie records, applies caller-supplied access policy, and manages eviction. */
export class CookieStore {
  /** Stored cookies in insertion order; retrieval returns these same objects. */
  cookies = new Set<StoredHTTPCookie>();
  /** Maximum retained cookie count for one exact domain or IP address. */
  totalCookiesPerHostLimit = 50;
  /** Maximum retained cookie count across all hosts. */
  totalCookiesLimit = 3000;
  /** Maximum age in days applied when parsing Expires and Max-Age attributes. */
  cookieAgeLimit = 400;

  /* https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.2.1 */
  /** Removes cookies whose expiry timestamp is in the past and returns the removed records. */
  removeExpiredCookies(): StoredHTTPCookie[] {
    const expired: StoredHTTPCookie[] = [];
    for (const cookie of this.cookies) {
      if (!cookie.isExpired) continue;
      this.cookies.delete(cookie);
      expired.push(cookie);
    }
    return expired;
  }

  /* https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.2.2 */
  /**
   * Evicts enough cookies for this host to meet the per-host limit.
   * Removes insecure cookies first, then the oldest access times within each group.
   * Returns the removed records in eviction order.
   */
  removeExcessCookiesForHost(host: CookieHost): StoredHTTPCookie[] {
    if (this.cookies.size <= this.totalCookiesPerHostLimit) return [];
    const hostCookies: StoredHTTPCookie[] = [];
    for (const cookie of this.cookies) {
      if (hostsEqual(cookie.host, host)) hostCookies.push(cookie);
    }
    const excess = hostCookies.length - this.totalCookiesPerHostLimit;
    if (excess <= 0) return [];

    hostCookies.sort((a, b) => Number(a.secure) - Number(b.secure) || a.lastAccessTime - b.lastAccessTime);
    hostCookies.length = excess;
    for (const cookie of hostCookies) this.cookies.delete(cookie);
    return hostCookies;
  }

  /* https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.2.3 */
  /** Evicts cookies with the oldest access times to meet the total limit; returns them in eviction order. */
  removeGlobalExcessCookies(): StoredHTTPCookie[] {
    const excess = this.cookies.size - this.totalCookiesLimit;
    if (excess <= 0) return [];

    const removed = [...this.cookies].sort((a, b) => a.lastAccessTime - b.lastAccessTime);
    removed.length = excess;
    for (const cookie of removed) this.cookies.delete(cookie);
    return removed;
  }

  /* https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.4.1 */
  /**
   * Parses and stores one Set-Cookie byte string using this store's age limit.
   * Applies storeCookie's access policy; garbage collection is a separate caller step.
   * Returns the stored cookie, or null for rejection or an indistinguishable replacement.
   * An indistinguishable replacement still installs the new record.
   * @param path Non-empty request URL path list used to derive the default cookie path.
   */
  parseAndStoreCookie(
    input: string, isSecure: boolean, host: CookieHost, path: string[],
    httpOnlyAllowed: boolean, allowNonHostOnlyCookieForPublicSuffix: boolean, sameSiteStrictOrLaxAllowed: boolean,
  ): StoredHTTPCookie | null {
    const cookie = HTTPCookie.parse(input, path, this.cookieAgeLimit);
    if (cookie === null) return null;
    return this.storeCookie(
      cookie, isSecure, host, httpOnlyAllowed,
      allowNonHostOnlyCookieForPublicSuffix, sameSiteStrictOrLaxAllowed,
    );
  }

  /* https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.4.3 */
  /**
   * Applies caller policy and stores the supplied object, replacing a cookie with the same name and scope.
   * Refreshes access time and preserves the existing creation time on replacement.
   * Returns the stored cookie, or null on rejection or an indistinguishable replacement.
   * An indistinguishable replacement still installs the supplied object.
   * @param isSecure Whether the caller considers the connection secure.
   * @param host Host against which the cookie's Domain scope is checked or assigned.
   * @param httpOnlyAllowed Whether this access may set or replace HttpOnly cookies.
   * @param allowNonHostOnlyCookieForPublicSuffix Whether a Domain cookie may span a public suffix.
   * @param sameSiteStrictOrLaxAllowed Whether this context may store Strict, Lax, or unset SameSite cookies.
   */
  storeCookie(
    cookie: HTTPCookie, isSecure: boolean, host: CookieHost,
    httpOnlyAllowed: boolean, allowNonHostOnlyCookieForPublicSuffix: boolean, sameSiteStrictOrLaxAllowed: boolean,
  ): StoredHTTPCookie | null {
    const path = cookie.path;
    // Cookie scope requires a URL path list; opaque paths cannot match a request.
    if (cookie.host === null || !Array.isArray(path)) return null;
    cookie.creationTime = cookie.lastAccessTime = Date.now();

    if (!allowNonHostOnlyCookieForPublicSuffix && cookie.host !== undefined && cookie.hasPublicSuffixHost) {
      if (!hostsEqual(cookie.host, host)) return null;
      cookie.host = undefined;
    }
    if (cookie.host === undefined) {
      cookie.hostOnly = true;
      cookie.host = host;
    } else {
      if (!cookie.matchesDomain(host)) return null;
      cookie.hostOnly = cookie.host.kind !== 'domain';
    }

    if (!httpOnlyAllowed && cookie.httpOnly) return null;
    if (!isSecure) {
      if (cookie.secure) return null;
      for (const existingCookie of this.cookies) {
        if (existingCookie.secure && existingCookie.name === cookie.name &&
          (cookie.matchesDomain(existingCookie.host) || existingCookie.matchesDomain(cookie.host)) &&
          existingCookie.matchesPath(path)) return null;
      }
    }
    if (cookie.sameSite !== 'none' && !sameSiteStrictOrLaxAllowed) return null;
    if (cookie.sameSite === 'none' && !cookie.secure) return null;

    if (!cookie.secure && securePrefixPattern.test(cookie.name)) return null;
    if (!cookie.isHostPrefixCompatible && hostPrefixPattern.test(cookie.name)) return null;
    if (!cookie.isHttpPrefixCompatible && httpPrefixPattern.test(cookie.name)) return null;
    if (cookie.name === '' && reservedPrefixPattern.test(cookie.value)) return null;

    let changed = true;
    for (const oldCookie of this.cookies) {
      if (oldCookie.name !== cookie.name || oldCookie.hostOnly !== cookie.hostOnly || !hostsEqual(oldCookie.host, cookie.host) ||
        !Array.isArray(oldCookie.path) || oldCookie.path.length !== path.length ||
        !oldCookie.path.every((segment, i) => segment === path[i])) continue;
      if (!httpOnlyAllowed && oldCookie.httpOnly) return null;
      changed = cookie.value !== oldCookie.value || cookie.secure !== oldCookie.secure ||
        cookie.httpOnly !== oldCookie.httpOnly || cookie.sameSite !== oldCookie.sameSite || cookie.expiryTime !== oldCookie.expiryTime;
      cookie.creationTime = oldCookie.creationTime;
      this.cookies.delete(oldCookie);
      break;
    }

    // Storage has established the host on this record; there is no second allocation.
    const storedCookie = cookie as StoredHTTPCookie;
    this.cookies.add(storedCookie);
    return changed ? storedCookie : null;
  }

  /* https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.4.4 */
  /** Removes expired cookies, then host excess, then global excess; returns the removed records in that order. */
  garbageCollectCookies(host: CookieHost): StoredHTTPCookie[] {
    return [
      ...this.removeExpiredCookies(),
      ...this.removeExcessCookiesForHost(host),
      ...this.removeGlobalExcessCookies(),
    ];
  }

  /* https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.4.5 */
  /**
   * Returns eligible stored cookies, longest serialized path first, then oldest creation time.
   * Updates access times on the returned objects without removing expired records.
   * Opaque request paths return an empty list.
   * @param maximumUnsetAge Maximum age in milliseconds for unset-SameSite cookies when
   * selecting unset-or-less; other retrieval modes do not apply this limit.
   */
  retrieveCookies(
    isSecure: boolean, host: CookieHost, path: URLPath, httpOnlyAllowed: boolean, sameSite: CookieSameSiteMode,
    maximumUnsetAge = Infinity,
  ): StoredHTTPCookie[] {
    if (typeof path === 'string') return [];
    const maximumSameSiteRank = sameSiteRanks[sameSite];
    const now = Date.now();
    const cookies: StoredHTTPCookie[] = [];
    for (const cookie of this.cookies) {
      // Expiry must be respected even between the caller's garbage-collection passes.
      if (cookie.isExpired || cookie.secure && !isSecure || cookie.httpOnly && !httpOnlyAllowed) continue;
      if (sameSiteRanks[cookie.sameSite] > maximumSameSiteRank) continue;
      if (sameSite === 'unset-or-less' && cookie.sameSite === 'unset' && now - cookie.creationTime > maximumUnsetAge) continue;
      if (cookie.hostOnly ? !hostsEqual(cookie.host, host) : !cookie.matchesDomain(host) || cookie.hasPublicSuffixHost) continue;
      if (!cookie.matchesPath(path)) continue;
      cookies.push(cookie);
    }

    // Browsers order by serialized path length, not the draft's segment count.
    cookies.sort((a, b) => b.pathLength - a.pathLength || a.creationTime - b.creationTime);
    for (const cookie of cookies) cookie.lastAccessTime = now;
    return cookies;
  }
}

/** Most restrictive SameSite category that the caller permits retrieval to include. */
export type CookieSameSiteMode = 'strict-or-less' | 'lax-or-less' | 'unset-or-less' | 'none';

const securePrefixPattern = /^__secure-/i;
const hostPrefixPattern = /^__host-/i;
const httpPrefixPattern = /^__(?:host-)?http-/i;
const reservedPrefixPattern = /^__(?:secure-|host-|http-)/i;

// Each retrieval mode permits cookies up to its corresponding SameSite restriction.
const sameSiteRanks: Record<CookieSameSite | CookieSameSiteMode, number> = {
  strict: 3, 'strict-or-less': 3,
  lax: 2, 'lax-or-less': 2,
  unset: 1, 'unset-or-less': 1,
  none: 0,
};
