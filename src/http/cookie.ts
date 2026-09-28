import { asciiLower } from '../infra/ascii';
import { surroundingTabOrSpacePattern } from '../infra/patterns';
import {
  hostsEqual, obtainPublicSuffix, parseHost, type Domain, type IPAddress, type URLPath,
} from '../url/index';

/** A cookie with byte-string names and values, before or after storage assigns its host. */
// https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.1.2
export class HTTPCookie {
  /** Case-sensitive byte-string name; empty for a nameless cookie. */
  name: string;
  /** Byte-string value, preserving its original case and any quotes. */
  value: string;
  /** Whether the cookie requires a secure connection. */
  secure = false;
  /** Parsed domain or IP address; undefined before assignment, null after a failed Domain parse. */
  host: CookieHost | null | undefined = undefined;
  /** Restricts the cookie to its exact host instead of also matching subdomains. */
  hostOnly = false;
  /** URL path scope. Opaque string paths cannot be stored or matched. */
  path: URLPath;
  /** Whether the path came from a valid Path attribute rather than the default path. */
  hasPathAttribute = false;
  /** Cross-site delivery restriction; "unset" means no recognized SameSite attribute. */
  sameSite: CookieSameSite = 'unset';
  /** Restricts reading and modification to HTTP access. */
  httpOnly = false;
  /** Creation timestamp in Unix milliseconds, preserved when a stored cookie is replaced. */
  creationTime = Date.now();
  /** Expiry timestamp in Unix milliseconds, or null for a session cookie. */
  expiryTime: number | null = null;
  /** Last-access timestamp in Unix milliseconds, refreshed on storage and retrieval. */
  lastAccessTime = this.creationTime;

  /** Create a cookie without parsing attributes or applying storage policy. */
  constructor(name: string, value: string, path: URLPath) {
    this.name = name;
    this.value = value;
    this.path = path;
  }

  /** Whether the expiry timestamp is in the past. Session cookies return false. */
  // https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.1.2.1
  get isExpired(): boolean {
    return this.expiryTime !== null && this.expiryTime < Date.now();
  }

  /** Whether the cookie is Secure, host-only, and has an explicit root Path attribute. */
  // https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.1.2.1
  get isHostPrefixCompatible(): boolean {
    return this.secure && this.hostOnly && this.hasPathAttribute &&
      Array.isArray(this.path) && this.path.length === 1 && this.path[0] === '';
  }

  /** Whether both the Secure and HttpOnly flags are set. */
  // https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.1.2.1
  get isHttpPrefixCompatible(): boolean {
    return this.secure && this.httpOnly;
  }

  /** The serialized path length, including the slash before each URL path segment. */
  get pathLength(): number {
    if (typeof this.path === 'string') return this.path.length;
    let length = 0;
    for (const segment of this.path) length += segment.length + 1;
    return length;
  }

  /** Whether the assigned host is itself a public suffix; absent or failed hosts return false. */
  get hasPublicSuffixHost(): boolean {
    const host = this.host;
    if (host === undefined || host === null) return false;
    const suffix = obtainPublicSuffix(host);
    return suffix !== null && hostsEqual(host, suffix);
  }

  /** Test domain scope; the store applies host-only restrictions separately. */
  // https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.3.2
  matchesDomain(host: CookieHost): boolean {
    const cookieHost = this.host;
    if (cookieHost === undefined || cookieHost === null) return false;
    return hostsEqual(host, cookieHost) ||
      host.kind === 'domain' && cookieHost.kind === 'domain' &&
      host.value.endsWith(cookieHost.value) && host.value[host.value.length - cookieHost.value.length - 1] === '.';
  }

  /** Returns a new default cookie path derived from a non-empty request URL path list. */
  // https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.3.3
  static getDefaultPath(path: string[]): string[] {
    return path.length > 1 ? path.slice(0, -1) : [''];
  }

  /** Tests whether the request path falls within this cookie's path scope. Opaque cookie paths never match. */
  // https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.3.4
  matchesPath(requestPath: string[]): boolean {
    const cookiePath = this.path;
    if (!Array.isArray(cookiePath)) return false;
    if (requestPath.length === cookiePath.length &&
      requestPath.every((segment, i) => segment === cookiePath[i])) return true;

    let prefixLength = cookiePath.length;
    if (cookiePath[prefixLength - 1] === '') prefixLength--;
    if (prefixLength >= requestPath.length) return false;
    for (let i = 0; i < prefixLength; i++) {
      if (requestPath[i] !== cookiePath[i]) return false;
    }
    return true;
  }

  /**
   * Parse one Set-Cookie byte string, or return null on failure.
   * path is a non-empty URL path list; cookieAgeLimit is in days.
   */
  // https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.4.2
  // The draft's isSecure and host arguments are unused until storage.
  static parse(input: string, path: string[], cookieAgeLimit: number): HTTPCookie | null {
    if (invalidCookieBytePattern.test(input)) return null;

    const parts = input.split(';');
    const nameValueInput = parts[0]!;
    const equals = nameValueInput.indexOf('=');
    const name = (equals === -1 ? '' : nameValueInput.slice(0, equals)).replace(surroundingTabOrSpacePattern, '');
    const value = nameValueInput.slice(equals + 1).replace(surroundingTabOrSpacePattern, '');
    if (name.length + value.length === 0 || name.length + value.length > 4096) return null;

    const cookie = new HTTPCookie(name, value, HTTPCookie.getDefaultPath(path));
    let pathAttributeValue: string | undefined;
    // Keep this outside the attribute loop: a valid Max-Age overrides every Expires.
    let maxAgeSeen = false;
    for (let i = 1; i < parts.length; i++) {
      const attribute = parts[i]!;
      const equals = attribute.indexOf('=');
      const name = equals === -1 ? attribute : attribute.slice(0, equals);
      const attributeName = asciiLower(name.replace(surroundingTabOrSpacePattern, ''));
      const attributeValue = (equals === -1 ? '' : attribute.slice(equals + 1)).replace(surroundingTabOrSpacePattern, '');
      if (attributeValue.length > 1024) continue;

      switch (attributeName) {
        case 'expires': {
          if (maxAgeSeen) break;
          const expiryTime = parseCookieDate(attributeValue);
          if (expiryTime === null) break;
          // The age limit is a duration; the expiry must remain an absolute timestamp.
          cookie.expiryTime = Math.min(expiryTime, Date.now() + cookieAgeLimit * 86_400_000);
          break;
        }
        case 'max-age': {
          if (!maxAgePattern.test(attributeValue)) break;
          const deltaSeconds = Math.min(Number(attributeValue), cookieAgeLimit * 86_400);
          // -8.64e15 is JavaScript's earliest representable date.
          cookie.expiryTime = deltaSeconds <= 0 ? -8.64e15 : Date.now() + deltaSeconds * 1000;
          maxAgeSeen = true;
          break;
        }
        case 'domain': {
          cookie.host = null;
          if (nonASCIIBytePattern.test(attributeValue)) break;
          const hostInput = attributeValue.startsWith('.') ? attributeValue.slice(1) : attributeValue;
          const { host } = parseHost(hostInput);
          if (host !== null && host.kind !== 'empty' && host.kind !== 'opaque') cookie.host = host;
          break;
        }
        case 'path':
          if (attributeValue.startsWith('/')) pathAttributeValue = attributeValue;
          break;
        case 'secure':
          cookie.secure = true;
          break;
        case 'httponly':
          cookie.httpOnly = true;
          break;
        case 'samesite': {
          const sameSite = asciiLower(attributeValue);
          if (sameSite === 'none' || sameSite === 'strict' || sameSite === 'lax') cookie.sameSite = sameSite;
          break;
        }
      }
    }

    if (pathAttributeValue !== undefined) {
      if (nonASCIIBytePattern.test(pathAttributeValue)) return null;
      cookie.path = pathAttributeValue.slice(1).split('/');
      cookie.hasPathAttribute = true;
    }
    return cookie;
  }

  /** Serialize cookies in the supplied order, without attributes or escaping. */
  // https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.4.6
  static serialize(cookies: HTTPCookie[]): string {
    let output = '';
    for (const cookie of cookies) {
      if (output !== '') output += '; ';
      if (cookie.name !== '') output += cookie.name + '=';
      output += cookie.value;
    }
    return output;
  }
}

/** Parses a cookie-date byte string as a Unix timestamp in milliseconds; returns null on failure. */
// https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.3.1
export function parseCookieDate(input: string): number | null {
  let time: [number, number, number] | undefined;
  let day: number | undefined;
  let month: number | undefined;
  let year: number | undefined;

  for (const token of input.split(dateDelimiterPattern)) {
    if (time === undefined) {
      const match = timePattern.exec(token);
      if (match) {
        time = [Number(match[1]), Number(match[2]), Number(match[3])];
        continue;
      }
    }
    if (day === undefined) {
      const match = dayPattern.exec(token);
      if (match) {
        day = Number(match[1]);
        continue;
      }
    }
    if (month === undefined) {
      const index = months.indexOf(token.slice(0, 3).toLowerCase());
      if (index !== -1) {
        month = index;
        continue;
      }
    }
    if (year === undefined) {
      const match = yearPattern.exec(token);
      if (match) year = Number(match[1]);
    }
  }

  if (time === undefined || day === undefined || month === undefined || year === undefined) return null;
  if (year >= 70 && year <= 99) year += 1900;
  else if (year <= 69) year += 2000;

  const [hour, minute, second] = time;
  if (day < 1 || day > 31 || year < 1601 || hour > 23 || minute > 59 || second > 59) return null;

  const date = new Date(Date.UTC(year, month, day, hour, minute, second));
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return date.getTime();
}

export type CookieHost = Domain | IPAddress;

export type CookieSameSite = 'strict' | 'lax' | 'unset' | 'none';

/** The same cookie after storage has established its host. */
export type StoredHTTPCookie = HTTPCookie & { host: CookieHost; };

// eslint-disable-next-line no-control-regex -- Cookies reject control bytes other than HTAB.
const invalidCookieBytePattern = /[\x00-\x08\x0a-\x1f\x7f]/;
const maxAgePattern = /^-?[0-9]+$/;
const nonASCIIBytePattern = /[\x80-\xff]/;
const dateDelimiterPattern = /[\t\x20-\x2f\x3b-\x40\x5b-\x60\x7b-\x7e]+/;
const timePattern = /^([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2})(?:[^0-9]|$)/;
const dayPattern = /^([0-9]{1,2})(?:[^0-9]|$)/;
const yearPattern = /^([0-9]{2,4})(?:[^0-9]|$)/;
const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
