import type { URLRecord } from '../url/index';

// https://fetch.spec.whatwg.org/#local-scheme
export function isLocalScheme(scheme: string): boolean {
  return scheme === 'about' || scheme === 'blob' || scheme === 'data';
}

// https://fetch.spec.whatwg.org/#is-local
export function isLocalURL(url: URLRecord): boolean {
  return isLocalScheme(url.scheme);
}

// https://fetch.spec.whatwg.org/#http-scheme
export function isHTTPScheme(scheme: string): boolean {
  return scheme === 'http' || scheme === 'https';
}

// https://fetch.spec.whatwg.org/#fetch-scheme
// UNUSED: only direct tests call this scheme classification.
export function isFetchScheme(scheme: string): boolean {
  return isLocalScheme(scheme) || scheme === 'file' || isHTTPScheme(scheme);
}
