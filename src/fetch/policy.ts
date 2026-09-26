import { HTTPCookie, type CookieSameSiteMode } from '../http/index';
import { InternalError } from '../infra/internal-error';
import { getMIMETypeEssence, isJavaScriptMIMEType } from '../mime/index';
import {
  areSameOrigin, areSameSite, areSchemelesslySameSite, obtainPublicSuffix, obtainURLOrigin,
  serializeOrigin, serializeURLPath, stripURLForReporting, type Origin, type URLRecord,
} from '../url/index';
import type { FetchEmbedderPolicy, FetchEmbedderPolicyValue, FetchEnvironment } from './environment';
import { parseIntegrityMetadata } from './integrity';
import { isScriptLikeDestination, type FetchRequest } from './request';
import type { FetchResponse } from './response';
import { isHTTPScheme, isLocalURL } from './url';

// -----------------------------------------------------------------------------
// Port blocking
// -----------------------------------------------------------------------------

/** Whether the request's current HTTP(S) URL uses a blocked port. */
// https://fetch.spec.whatwg.org/#block-bad-port
export function isBlockedByBadPort(request: FetchRequest): boolean {
  const url = request.currentURL;
  return isHTTPScheme(url.scheme) && url.port !== null && badPorts.has(url.port);
}

// https://fetch.spec.whatwg.org/#bad-port
const badPorts = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179,
  389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601,
  636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000,
  6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

// -----------------------------------------------------------------------------
// MIME type and nosniff
// -----------------------------------------------------------------------------

/** Whether the MIME type prevents using this response for a script-like destination. */
// https://fetch.spec.whatwg.org/#should-response-to-request-be-blocked-due-to-mime-type?
export function isBlockedByMIMEType(response: FetchResponse, request: FetchRequest): boolean {
  const mimeType = response.headerList.extractMIMEType();
  if (mimeType === null) return false;
  const essence = getMIMETypeEssence(mimeType);
  return isScriptLikeDestination(request.destination) && (
    essence.startsWith('audio/') || essence.startsWith('image/') ||
    essence.startsWith('video/') || essence === 'text/csv'
  );
}

/** Whether nosniff blocks this script-like or stylesheet response. */
// https://fetch.spec.whatwg.org/#should-response-to-request-be-blocked-due-to-nosniff?
export function isBlockedByNosniff(response: FetchResponse, request: FetchRequest): boolean {
  if (!response.headerList.determineNosniff()) return false;
  const mimeType = response.headerList.extractMIMEType();
  if (isScriptLikeDestination(request.destination) && (mimeType === null || !isJavaScriptMIMEType(mimeType))) {
    return true;
  }
  return request.destination === 'style' && (mimeType === null || getMIMETypeEssence(mimeType) !== 'text/css');
}

// -----------------------------------------------------------------------------
// Cookies
// -----------------------------------------------------------------------------

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
  // SPEC_CLASH(cookie-samesite-context): Fetch reuses retrieval mode; browsers allow top-level responses to set Strict/Lax cookies.
  const sameSiteStrictOrLaxAllowed = request.destination === 'document' || isSameSiteForCookies(request);
  for (const [name, value] of response.headerList) {
    if (name.toLowerCase() !== 'set-cookie') continue;
    userAgent.cookieStore.parseAndStoreCookie(value, scheme === 'https', host, path, true, false, sameSiteStrictOrLaxAllowed);
    userAgent.cookieStore.garbageCollectCookies(host);
  }
}

/** Returns the serialized default cookie path for a URL with a non-opaque path. */
// https://fetch.spec.whatwg.org/#serialized-cookie-default-path
// UNUSED: only direct tests call this cookie-path serialization.
export function getSerializedCookieDefaultPath(url: URLRecord): string {
  if (typeof url.path === 'string') throw new InternalError('Cookie default paths require a non-opaque URL path');
  return serializeURLPath({ ...url, path: HTTPCookie.getDefaultPath(url.path) });
}

/** Select sending restrictions, including Lax-by-default for unspecified SameSite. */
// https://fetch.spec.whatwg.org/#determine-the-same-site-mode
// SPEC_CLASH(cookie-samesite-context): Use browser classification instead of Fetch's navigation/client/redirect rules.
// Approved sending and storage choices: ../http/cookies/ROADMAP.md#implementation-order.
function determineSameSiteMode(request: FetchRequest): CookieSameSiteMode {
  if (isSameSiteForCookies(request)) return 'strict-or-less';
  if (request.destination !== 'document') return 'none';
  return safeMethods.has(request.method) ? 'lax-or-less' : 'unset-or-less';
}

/** Whether the initiator and client ancestry are same-site with the current URL. */
// Chromium's default does not taint this decision with earlier redirect hops.
// Fetch's redirectTaint still serves its separate origin/credentials algorithms.
function isSameSiteForCookies(request: FetchRequest): boolean {
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

// -----------------------------------------------------------------------------
// Origin
// -----------------------------------------------------------------------------

/** Append the request origin, applying redirect taint and non-CORS disclosure policy. */
// https://fetch.spec.whatwg.org/#append-a-request-origin-header
export function appendOriginHeader(request: FetchRequest): void {
  if (request.origin === undefined) throw new InternalError('Fetch request origin has not been resolved');
  let serializedOrigin = request.serializeOrigin();
  if (request.responseTainting === 'cors' || request.mode === 'websocket' || request.mode === 'webtransport') {
    request.headerList.append('Origin', serializedOrigin);
    return;
  }
  if (request.method === 'GET' || request.method === 'HEAD') return;

  if (request.mode !== 'cors') {
    switch (request.referrerPolicy) {
      case 'no-referrer':
        serializedOrigin = 'null';
        break;
      case 'no-referrer-when-downgrade':
      case 'strict-origin':
      case 'strict-origin-when-cross-origin':
        if (request.origin.kind === 'tuple' && request.origin.scheme === 'https' && request.currentURL.scheme !== 'https') {
          serializedOrigin = 'null';
        }
        break;
      case 'same-origin':
        if (!areSameOrigin(request.origin, obtainURLOrigin(request.currentURL))) serializedOrigin = 'null';
        break;
    }
  }
  request.headerList.append('Origin', serializedOrigin);
}

// -----------------------------------------------------------------------------
// CORS
// -----------------------------------------------------------------------------

/** Whether the response's CORS headers deny access to the request's origin and credentials. */
// https://fetch.spec.whatwg.org/#concept-cors-check
export function isBlockedByCORS(response: FetchResponse, request: FetchRequest): boolean {
  const origin = response.headerList.get('Access-Control-Allow-Origin');
  if (origin === null) return true;
  if (request.credentialsMode !== 'include' && origin === '*') return false;
  // Header values are byte strings; the ASCII origin serialization compares directly.
  if (request.serializeOrigin() !== origin) return true;
  return request.credentialsMode === 'include' &&
    response.headerList.get('Access-Control-Allow-Credentials') !== 'true';
}

// -----------------------------------------------------------------------------
// Embedder policy
// -----------------------------------------------------------------------------

/** Whether COEP permits credentials for this request's origin, mode, and redirect history. */
// https://fetch.spec.whatwg.org/#cross-origin-embedder-policy-allows-credentials
export function crossOriginEmbedderPolicyAllowsCredentials(request: FetchRequest): boolean {
  if (request.origin === undefined) throw new InternalError('Fetch request origin has not been resolved');
  if (request.mode !== 'no-cors' || request.client === null) return true;
  if (request.client.policyContainer.embedderPolicy.value !== 'credentialless') return true;
  // SPEC_CLASH(coep-redirect-taint): Use same-origin; the draft's inverse is tracked in Fetch #1958/#1959.
  return areSameOrigin(request.origin, obtainURLOrigin(request.currentURL)) &&
    request.redirectTaint === 'same-origin';
}

/** Whether CORP blocks the response; report embedder-policy violations when a reporting environment exists. */
// https://fetch.spec.whatwg.org/#cross-origin-resource-policy-check
export function isBlockedByCORP(
  response: FetchResponse, origin: Origin, policy: FetchEmbedderPolicy,
  destination: string, forNavigation: boolean, env: FetchEnvironment | null,
): boolean {
  if (isBlockedByCORPInternal(response, origin, 'unsafe-none', forNavigation)) {
    return true;
  }
  if (env !== null && isBlockedByCORPInternal(response, origin, policy.reportOnlyValue, forNavigation)) {
    queueCORPViolationReport(response, policy, destination, true, env);
  }
  if (!isBlockedByCORPInternal(response, origin, policy.value, forNavigation)) {
    return false;
  }
  if (env !== null) queueCORPViolationReport(response, policy, destination, false, env);
  return true;
}

/** Check one embedder policy against the response's CORP header without reporting. */
// https://fetch.spec.whatwg.org/#cross-origin-resource-policy-internal-check
export function isBlockedByCORPInternal(
  response: FetchResponse, origin: Origin, embedderPolicyValue: FetchEmbedderPolicyValue, forNavigation: boolean,
): boolean {
  if (forNavigation && embedderPolicyValue === 'unsafe-none') return false;
  let policy = response.headerList.get('Cross-Origin-Resource-Policy');
  if (policy !== 'same-origin' && policy !== 'same-site' && policy !== 'cross-origin') policy = null;
  if (policy === null && (embedderPolicyValue === 'require-corp' ||
    (embedderPolicyValue === 'credentialless' && (response.requestIncludesCredentials || forNavigation)))) {
    policy = 'same-origin';
  }
  if (policy === null || policy === 'cross-origin') return false;
  const url = response.url;
  if (url === null) throw new InternalError('CORP origin comparison requires a response URL');
  const responseOrigin = obtainURLOrigin(url);
  if (policy === 'same-origin') return !areSameOrigin(origin, responseOrigin);
  return origin.kind !== 'tuple' || !areSchemelesslySameSite(origin, responseOrigin) ||
    (origin.scheme !== 'https' && url.scheme === 'https');
}

/** Queue a COEP violation with its endpoint and sanitized original response URL. */
// https://fetch.spec.whatwg.org/#queue-a-cross-origin-embedder-policy-corp-violation-report
function queueCORPViolationReport(
  response: FetchResponse, policy: FetchEmbedderPolicy, destination: string, reportOnly: boolean, env: FetchEnvironment,
): void {
  const endpoint = reportOnly ? policy.reportOnlyReportingEndpoint : policy.reportingEndpoint;
  env.queueReport('coep', endpoint, {
    type: 'corp', blockedURL: response.serializeURLForReporting(), destination,
    disposition: reportOnly ? 'reporting' : 'enforce',
  });
}

// -----------------------------------------------------------------------------
// Fetch Metadata
// -----------------------------------------------------------------------------

/** Set the outgoing request's Fetch Metadata headers when its current URL is trustworthy. */
// https://w3c.github.io/webappsec-fetch-metadata/#fetch-integration
export function appendMetadataHeadersIfTrustworthy(request: FetchRequest): void {
  if (!request.userAgent.isURLPotentiallyTrustworthy(request.currentURL)) return;
  setFetchDestHeader(request);
  setFetchModeHeader(request);
  setFetchSiteHeader(request);
  setFetchUserHeader(request);
}

// https://w3c.github.io/webappsec-fetch-metadata/#sec-fetch-dest-header
function setFetchDestHeader(request: FetchRequest): void {
  request.headerList.setStructuredFieldValue('Sec-Fetch-Dest', {
    type: 'item', bareItem: { type: 'token', value: request.destination || 'empty' }, parameters: new Map(),
  });
}

// https://w3c.github.io/webappsec-fetch-metadata/#sec-fetch-mode-header
function setFetchModeHeader(request: FetchRequest): void {
  request.headerList.setStructuredFieldValue('Sec-Fetch-Mode', {
    type: 'item', bareItem: { type: 'token', value: request.mode }, parameters: new Map(),
  });
}

// https://w3c.github.io/webappsec-fetch-metadata/#sec-fetch-site-header
function setFetchSiteHeader(request: FetchRequest): void {
  let site: 'same-origin' | 'same-site' | 'cross-site' | 'none' = 'same-origin';
  // HTML's navigation-fetch algorithm has a null client only for browser-UI initiation.
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#create-navigation-params-by-fetching
  if (request.isNavigation && request.client === null) {
    site = 'none';
  } else {
    if (request.origin === undefined) throw new InternalError('Fetch request origin has not been resolved');
    for (const url of request.urlList) {
      const origin = obtainURLOrigin(url);
      if (areSameOrigin(origin, request.origin)) continue;
      site = 'cross-site';
      if (!areSameSite(request.origin, origin)) break;
      site = 'same-site';
    }
  }
  request.headerList.setStructuredFieldValue('Sec-Fetch-Site', {
    type: 'item', bareItem: { type: 'token', value: site }, parameters: new Map(),
  });
}

// https://w3c.github.io/webappsec-fetch-metadata/#sec-fetch-user-header
function setFetchUserHeader(request: FetchRequest): void {
  if (!request.isNavigation || !request.userActivation) return;
  // SPEC_CLASH(metadata-user-boolean): Follow the boolean field definition/ABNF over step 3's "token".
  request.headerList.setStructuredFieldValue('Sec-Fetch-User', {
    type: 'item', bareItem: { type: 'boolean', value: true }, parameters: new Map(),
  });
}

// -----------------------------------------------------------------------------
// Timing
// -----------------------------------------------------------------------------

/** Whether the response blocks exposing detailed timing for this request. */
// https://fetch.spec.whatwg.org/#concept-tao-check
export function isTimingBlocked(response: FetchResponse, request: FetchRequest): boolean {
  if (request.origin === undefined) throw new InternalError('TAO check requires a populated request origin');
  if (request.timingAllowFailed) return true;
  const values = response.headerList.getDecodeAndSplit('Timing-Allow-Origin') ?? [];
  if (values.includes('*') || values.includes(request.serializeOrigin())) return false;
  if (request.mode === 'navigate' && !areSameOrigin(obtainURLOrigin(request.currentURL), request.origin)) return true;
  return request.responseTainting !== 'basic';
}

/** Whether any navigation redirect blocks timing exposure to the destination origin. */
// https://fetch.spec.whatwg.org/#navigation-tao-check
export function isNavigationTimingBlocked(response: FetchResponse, destinationOrigin: Origin): boolean {
  const origin = serializeOrigin(destinationOrigin);
  return response.navigationTimingAllowValuesList.some((values) => !values.includes('*') && !values.includes(origin));
}

// -----------------------------------------------------------------------------
// Integrity Policy
// -----------------------------------------------------------------------------

/** Whether the request's integrity policies block it, reporting violations of either policy. */
// https://w3c.github.io/webappsec-subresource-integrity/#should-request-be-blocked-by-integrity-policy-section
export function isBlockedByIntegrityPolicy(request: FetchRequest): boolean {
  if (request.policyContainer === undefined) throw new InternalError('Fetch request policy container has not been resolved');
  const metadata = parseIntegrityMetadata(request.integrityMetadata);
  if (metadata.length !== 0 && (request.mode === 'cors' || request.mode === 'same-origin')) return false;
  if (isLocalURL(request.url)) return false;
  const { destination, client } = request;
  if (destination !== 'script' && destination !== 'style') return false;
  const policy = request.policyContainer.integrityPolicy;
  const reportPolicy = request.policyContainer.reportOnlyIntegrityPolicy;
  const block = policy.sources.includes('inline') && policy.blockedDestinations.includes(destination);
  const reportBlock = reportPolicy.sources.includes('inline') && reportPolicy.blockedDestinations.includes(destination);
  if (!block && !reportBlock) return false;
  if (client === null) return false;
  const source = client.getReportingSource();
  if (source === null) return false;

  // https://w3c.github.io/webappsec-subresource-integrity/#report-violations
  const body: IntegrityViolationReportBody = {
    documentURL: stripURLForReporting(source), blockedURL: stripURLForReporting(request.url),
    destination, reportOnly: false,
  };
  if (block) {
    for (const endpoint of policy.endpoints) client.queueReport('integrity-violation', endpoint, { ...body });
  }
  if (reportBlock) {
    for (const endpoint of reportPolicy.endpoints) {
      client.queueReport('integrity-violation', endpoint, { ...body, reportOnly: true });
    }
  }
  return block;
}

/** The HTML-owned integrity policy fields used by request blocking and reporting. */
export type FetchIntegrityPolicy = {
  /** Locations from which integrity metadata may be supplied. */
  sources: 'inline'[];
  /** Request destinations that require integrity metadata. */
  blockedDestinations: ('script' | 'style')[];
  /** Reporting endpoint names, resolved by the owner's Reporting state. */
  endpoints: string[];
};

/** Data supplied to Reporting for one enforced or report-only integrity violation. */
export type IntegrityViolationReportBody = {
  /** Sanitized URL of the document or worker that initiated the request. */
  documentURL: string;
  /** Sanitized original request URL, before redirects. */
  blockedURL: string;
  /** Intended use of the blocked resource. */
  destination: string;
  /** Whether this report describes a policy that does not block the request. */
  reportOnly: boolean;
};

// -----------------------------------------------------------------------------
// Mixed content
// -----------------------------------------------------------------------------

/** Upgrade eligible mixed images, audio, and video before mixed-content blocking. */
// https://w3c.github.io/webappsec-mixed-content/#upgrade-algorithm
export function upgradeMixedContent(request: FetchRequest): void {
  const url = request.currentURL;
  if (url.scheme !== 'http' || request.userAgent.isURLPotentiallyTrustworthy(url) ||
    url.host?.kind === 'ipv4' || url.host?.kind === 'ipv6' ||
    request.client === null || !request.client.prohibitsMixedSecurityContexts()) return;
  if (request.destination !== 'image' && request.destination !== 'audio' && request.destination !== 'video') return;
  if (request.destination === 'image' && request.initiator === 'imageset') return;
  // The algorithm has no CORS-mode exclusion; normal CORS checks still apply.
  url.scheme = 'https';
  if (url.port === 443) url.port = null;
}

/** Whether fetching the request would expose mixed content to its client. */
// https://w3c.github.io/webappsec-mixed-content/#should-block-fetch
export function isRequestBlockedByMixedContent(request: FetchRequest): boolean {
  // HTML uses document for top-level navigation and the container's local name
  // for nested navigation. A browser-initiated request has no client to protect.
  return request.client !== null && request.destination !== 'document' &&
    request.client.prohibitsMixedSecurityContexts() &&
    !request.userAgent.isURLPotentiallyTrustworthy(request.currentURL);
}

/** Whether the internal response would expose mixed content to the request's client. */
// https://w3c.github.io/webappsec-mixed-content/#should-block-response
export function isResponseBlockedByMixedContent(response: FetchResponse, request: FetchRequest): boolean {
  if (request.client === null || request.destination === 'document' ||
    !request.client.prohibitsMixedSecurityContexts()) return false;
  // Main Fetch fills an empty URL list before running its response checks.
  const url = response.url;
  if (url === null) throw new InternalError('Mixed-content response checking requires a response URL');
  return !request.userAgent.isURLPotentiallyTrustworthy(url);
}

/** Whether a trustworthy source initiated a download with any untrustworthy response hop. */
// Extracts the shared rejection condition added to HTML's attachment-response
// navigation branch and hyperlink-download path. Their callers check this
// before "handle as a download"; this predicate does not perform the download.
// https://w3c.github.io/webappsec-mixed-content/#html
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigation-as-a-download
// https://html.spec.whatwg.org/multipage/links.html#downloading-hyperlinks
export function isMixedDownload(response: FetchResponse, sourceURL: URLRecord, env: FetchEnvironment): boolean {
  return env.userAgent.isURLPotentiallyTrustworthy(sourceURL) &&
    response.urlList.some((url) => !env.userAgent.isURLPotentiallyTrustworthy(url));
}

// -----------------------------------------------------------------------------
// Upgrade insecure requests
// -----------------------------------------------------------------------------

/** Advertise navigation upgrade support and apply the client's enforced upgrade policy. */
// https://w3c.github.io/webappsec-upgrade-insecure-requests/#upgrade-request
export function upgradeInsecureRequest(request: FetchRequest): void {
  // Sending this on every navigation is permitted, including to preloadable
  // HSTS hosts. Set rather than append so redirect re-entry keeps one value.
  if (request.isNavigation) request.headerList.set('Upgrade-Insecure-Requests', '1');
  const client = request.client;
  if (client === null || !client.insecureRequestsPolicy.upgrade) return;
  const url = request.currentURL;
  // Follow Chromium's trustworthy-URL exemption. Gecko also leaves loopback
  // HTTP services alone, even under an explicit upgrade policy.
  if (url.scheme !== 'http' || request.userAgent.isURLPotentiallyTrustworthy(url)) return;
  if (request.destination === 'document' && !request.isFormSubmission &&
    !client.insecureRequestsPolicy.shouldUpgradeNavigation(url)) return;

  // Apply upgrades to the current redirect target, preserving earlier hops.
  url.scheme = 'https';
  if (url.port === 443) url.port = null;
}

// -----------------------------------------------------------------------------
// HSTS
// -----------------------------------------------------------------------------

/** Upgrade the current HTTP URL when the owning user agent's HSTS policy requires HTTPS. */
// https://www.rfc-editor.org/rfc/rfc6797.html#section-8.3
// HSTS branch of https://fetch.spec.whatwg.org/#concept-main-fetch, after referrer selection.
export function upgradeForHSTS(request: FetchRequest): void {
  const url = request.currentURL;
  if (url.scheme !== 'http' || url.host?.kind !== 'domain') return;
  const suffix = obtainPublicSuffix(url.host)?.value;
  if (suffix === 'localhost' || suffix === 'localhost.') return;
  if (!request.userAgent.hstsStore.requiresHTTPS(url.host)) return;

  url.scheme = 'https';
  // URL parsing already represents HTTP's port 80 as null. Keep HTTPS's
  // default port canonical too; every other explicit port remains unchanged.
  if (url.port === 443) url.port = null;
}
