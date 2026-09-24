import { HTTPCookie, type CookieSameSiteMode } from '../../http/index';
import { areSameSite, obtainURLOrigin, type Origin } from '../../url/index';
import type { FetchRequest } from '../request';
import type { FetchResponse } from '../response';

/** Append cookies selected for the request from the owning user agent's store. */
// https://fetch.spec.whatwg.org/#append-a-request-cookie-header
export function appendCookieHeader(request: FetchRequest): void {
  if (!request.userAgent.cookiesEnabled) return;
  const { scheme, host, path } = request.currentURL;
  if (host === null || host.kind === 'empty' || host.kind === 'opaque') return;
  const cookies = request.userAgent.cookieStore.retrieveCookies(
    scheme === 'https', host, path, true, determineSameSiteMode(request), laxAllowingUnsafeMaxAge,
  );
  if (cookies.length !== 0) request.headerList.append('Cookie', HTTPCookie.serialize(cookies));
}

/** Process each Set-Cookie field independently using the request's URL and cookie policy. */
// https://fetch.spec.whatwg.org/#parse-and-store-response-set-cookie-headers
export function parseAndStoreCookies(response: FetchResponse, request: FetchRequest): void {
  const { userAgent } = request;
  if (!userAgent.cookiesEnabled) return;
  const { scheme, host, path } = request.currentURL;
  if (host === null || host.kind === 'empty' || host.kind === 'opaque' || typeof path === 'string') return;
  // Browsers accept Strict/Lax cookies on top-level navigation responses even
  // when those cookies could not have been sent on the initiating request.
  const sameSiteStrictOrLaxAllowed = request.destination === 'document' || isSameSiteForCookies(request);
  for (const [name, value] of response.headerList) {
    if (name.toLowerCase() !== 'set-cookie') continue;
    userAgent.cookieStore.parseAndStoreCookie(value, scheme === 'https', host, path, true, false, sameSiteStrictOrLaxAllowed);
    userAgent.cookieStore.garbageCollectCookies(host);
  }
}

/** Select sending restrictions, including Lax-by-default for unspecified SameSite. */
// https://fetch.spec.whatwg.org/#determine-the-same-site-mode
// Follow browser classification: same-site navigations allow Strict; only top-level
// cross-site navigations receive Lax/temporarily unset cookies. Response storage differs.
export function determineSameSiteMode(request: FetchRequest): CookieSameSiteMode {
  if (isSameSiteForCookies(request)) return 'strict-or-less';
  if (request.destination !== 'document') return 'none';
  return safeMethods.has(request.method) ? 'lax-or-less' : 'unset-or-less';
}

/** Whether the initiator and client ancestry are same-site with the current URL. */
// Chromium's default does not taint this decision with earlier redirect hops.
// Fetch's redirectTaint still serves its separate origin/credentials algorithms.
export function isSameSiteForCookies(request: FetchRequest): boolean {
  let initiator: Origin | null;
  if (request.destination === 'document') {
    // No initiator denotes browser-initiated navigation, not a clientless subresource.
    initiator = request.topLevelNavigationInitiatorOrigin;
  } else {
    if (request.client === null || request.client.hasCrossSiteAncestor) return false;
    initiator = request.client.origin;
  }
  const targetOrigin = obtainURLOrigin(request.currentURL);
  return initiator === null || areSameSite(initiator, targetOrigin);
}

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);
// Chromium's Lax-allowing-unsafe compatibility window for recently created default cookies.
const laxAllowingUnsafeMaxAge = 2 * 60 * 1000;
