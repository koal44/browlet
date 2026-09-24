import { asciiLower } from '../../infra/ascii';
import { surroundingTabOrSpacePattern } from '../../infra/patterns';
import {
  hostsEqual, obtainPublicSuffix, parseHost, type Domain, type IPAddress, type URLPath,
} from '../../url/index';
import { parseCookieDate } from './date';

/* https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.1.2 */
/**
 * One HTTP cookie, before or after storage has established its host.
 * Names and values are byte strings: each U+0000–U+00FF code unit represents one byte.
 */
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

  /** Initializes a cookie from its name, value, and path without parsing attributes or applying storage policy. */
  constructor(name: string, value: string, path: URLPath) {
    this.name = name;
    this.value = value;
    this.path = path;
  }

  /* https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.1.2.1 */
  /** Whether the expiry timestamp is in the past. Session cookies return false. */
  get isExpired(): boolean {
    return this.expiryTime !== null && this.expiryTime < Date.now();
  }

  /* https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.1.2.1 */
  /** Whether the cookie is Secure, host-only, and has an explicit root Path attribute. */
  get isHostPrefixCompatible(): boolean {
    return this.secure && this.hostOnly && this.hasPathAttribute &&
      Array.isArray(this.path) && this.path.length === 1 && this.path[0] === '';
  }

  /* https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.1.2.1 */
  /** Whether both the Secure and HttpOnly flags are set. */
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

  /* https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.3.2 */
  /**
   * Tests exact host equality or a subdomain match against this cookie's host.
   * Host-only restrictions are applied separately by the store.
   */
  matchesDomain(host: CookieHost): boolean {
    const cookieHost = this.host;
    if (cookieHost === undefined || cookieHost === null) return false;
    return hostsEqual(host, cookieHost) ||
      host.kind === 'domain' && cookieHost.kind === 'domain' &&
      host.value.endsWith(cookieHost.value) && host.value[host.value.length - cookieHost.value.length - 1] === '.';
  }

  /* https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.3.3 */
  /** Returns a new default cookie path derived from a non-empty request URL path list. */
  static getDefaultPath(path: string[]): string[] {
    return path.length > 1 ? path.slice(0, -1) : [''];
  }

  /* https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.3.4 */
  /** Tests whether the request path falls within this cookie's path scope. Opaque cookie paths never match. */
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

  /*
   * https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.4.2
   * The draft's isSecure and host arguments are unused until storage.
   */
  /**
   * Parses one Set-Cookie byte string, returning null when parsing rejects it.
   * Storage policy is applied separately.
   * @param path Non-empty request URL path list used to derive the default cookie path.
   * @param cookieAgeLimit Maximum cookie lifetime in days.
   */
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

  /* https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.4.6 */
  /**
   * Serializes the supplied cookies in order as a Cookie header byte string.
   * Attributes are omitted; names and values are emitted without escaping.
   */
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

export type CookieHost = Domain | IPAddress;
export type CookieSameSite = 'strict' | 'lax' | 'unset' | 'none';

/** The same cookie after storage has established its host. */
export type StoredHTTPCookie = HTTPCookie & { host: CookieHost; };

// eslint-disable-next-line no-control-regex -- Cookies reject control bytes other than HTAB.
const invalidCookieBytePattern = /[\x00-\x08\x0a-\x1f\x7f]/;
const maxAgePattern = /^-?[0-9]+$/;
const nonASCIIBytePattern = /[\x80-\xff]/;
