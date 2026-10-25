import { serializeHost, type Host } from './host';
import type { Origin } from './origin';

/*
 * A URL record.
 *
 * https://url.spec.whatwg.org/#concept-url
 */
export type URLRecord = {
  scheme: string;
  username: string;
  password: string;
  host: Host | null;
  port: number | null;
  path: URLPath;
  query: string | null;
  fragment: string | null;
  blobURLEntry: BlobURLEntry | null;
};

/** Opaque paths are strings; hierarchical paths are segment lists. https://url.spec.whatwg.org/#url-path */
export type URLPath = string | string[];

/** The part of a File API registration needed by URL's origin algorithm. */
export type BlobURLEntry = {
  env: {
    origin: Origin;
  };
};

/*
 * URL serializer.
 *
 * https://url.spec.whatwg.org/#concept-url-serializer
 */
export function serializeURL(
  url: URLRecord,
  excludeFragment = false,
): string {
  let output = `${url.scheme}:`;

  if (url.host !== null) {
    output += '//';
    if (includesCredentials(url)) {
      output += url.username;
      if (url.password !== '') output += `:${url.password}`;
      output += '@';
    }
    output += serializeHost(url.host);
    if (url.port !== null) output += `:${url.port}`;
  }

  if (
    url.host === null && !hasOpaquePath(url) && url.path.length > 1 &&
    url.path[0] === ''
  ) {
    output += '/.';
  }

  output += serializeURLPath(url);
  if (url.query !== null) output += `?${url.query}`;
  if (!excludeFragment && url.fragment !== null) output += `#${url.fragment}`;

  return output;
}

/**
 * Copy mutable components while retaining the cached blob URL entry.
 */
export function copyURL(url: URLRecord): URLRecord {
  return {
    ...url,
    path: typeof url.path === 'string' ? url.path : [...url.path],
    host: url.host === null ? null : url.host.kind === 'ipv6'
      ? { ...url.host, pieces: [...url.host.pieces] } : { ...url.host },
  };
}

/*
 * URL equivalence.
 *
 * https://url.spec.whatwg.org/#url-equivalence
 */
export function urlsEqual(
  a: URLRecord,
  b: URLRecord,
  excludeFragments = false,
): boolean {
  return serializeURL(a, excludeFragments) ===
    serializeURL(b, excludeFragments);
}

export function includesCredentials(url: URLRecord): boolean {
  return url.username !== '' || url.password !== '';
}

export function hasOpaquePath(url: URLRecord): url is URLRecord & { path: string; } {
  return typeof url.path === 'string';
}

export function serializeURLPath(url: URLRecord): string {
  if (hasOpaquePath(url)) return url.path;
  return (url.path as string[]).map((segment) => `/${segment}`).join('');
}
