import { InternalError } from '../../infra/internal-error';
import type { URLRecord } from '../../url/index';
import type { FetchEnvironment } from '../environment';
import type { FetchRequest } from '../request';
import type { FetchResponse } from '../response';

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
