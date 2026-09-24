import { obtainPublicSuffix } from '../../url/index';
import type { FetchRequest } from '../request';

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
