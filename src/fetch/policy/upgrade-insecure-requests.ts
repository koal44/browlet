import type { FetchRequest } from '../request';

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
