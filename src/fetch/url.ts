import { HTTPCookie } from '../http/index';
import { InternalError } from '../infra/internal-error';
import { serializeURLPath, type URLRecord } from '../url/url';

/** Fetch §2.1, local scheme. */
export function isLocalScheme(scheme: string): boolean {
  return scheme === 'about' || scheme === 'blob' || scheme === 'data';
}

/** Fetch §2.1, a URL is local. */
export function isLocalURL(url: URLRecord): boolean {
  return isLocalScheme(url.scheme);
}

/** Fetch §2.1, HTTP(S) scheme. */
export function isHTTPScheme(scheme: string): boolean {
  return scheme === 'http' || scheme === 'https';
}

/** Fetch §2.1, fetch scheme. */
export function isFetchScheme(scheme: string): boolean {
  return isLocalScheme(scheme) || scheme === 'file' || isHTTPScheme(scheme);
}

/** Returns the serialized default cookie path for a URL with a non-opaque path. */
// https://fetch.spec.whatwg.org/#serialized-cookie-default-path
export function getSerializedCookieDefaultPath(url: URLRecord): string {
  if (typeof url.path === 'string') throw new InternalError('Cookie default paths require a non-opaque URL path');
  return serializeURLPath({ ...url, path: HTTPCookie.getDefaultPath(url.path) });
}
