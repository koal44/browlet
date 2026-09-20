import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPCookie, type CookieHost } from '../../../src/http/cookies/cookie';
import { parseHost } from '../../../src/url/host';
import { parseURL } from '../../../src/url/url';

const now = Date.UTC(2026, 8, 20);

beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => { vi.restoreAllMocks(); });

describe('HTTP cookies (§5.1.2)', () => {
  it('retains the supplied byte strings and path and initializes the specified defaults', () => {
    const name = 'na\x80me';
    const value = 'va\xfflue';
    const path = ['account', ''];
    const cookie = new HTTPCookie(name, value, path);

    expect(cookie.name).toBe(name);
    expect(cookie.value).toBe(value);
    expect(cookie.path).toBe(path);
    expect(cookie).toMatchObject({
      secure: false, host: undefined, hostOnly: false, hasPathAttribute: false,
      sameSite: 'unset', httpOnly: false,
      creationTime: now, expiryTime: null, lastAccessTime: now,
    });
  });

  it.each<[number | null, boolean]>([
    [null, false], [now - 1, true], [now, false], [now + 1, false],
  ])('treats expiry %s as expired: %s', (expiryTime, expected) => {
    const cookie = new HTTPCookie('', 'value', ['']);
    cookie.expiryTime = expiryTime;

    expect(cookie.isExpired).toBe(expected);
  });

  it.each<[string, Partial<HTTPCookie>, boolean]>([
    ['secure, host-only, explicit root path', {}, true],
    ['insecure', { secure: false }, false],
    ['domain-scoped', { hostOnly: false }, false],
    ['implicit root path', { hasPathAttribute: false }, false],
    ['empty path', { path: [] }, false],
    ['non-root path', { path: ['account'] }, false],
    ['multiple empty segments', { path: ['', ''] }, false],
    ['trailing slash', { path: ['account', ''] }, false],
    ['opaque path', { path: '/' }, false],
  ])('checks Host-prefix compatibility for %s', (_label, fields, expected) => {
    const cookie = new HTTPCookie('name', '', ['']);
    Object.assign(cookie, { secure: true, hostOnly: true, hasPathAttribute: true }, fields);

    expect(cookie.isHostPrefixCompatible).toBe(expected);
  });

  it.each([
    [false, false, false], [false, true, false],
    [true, false, false], [true, true, true],
  ])('checks Http-prefix compatibility for secure=%s, httpOnly=%s', (secure, httpOnly, expected) => {
    const cookie = new HTTPCookie('name', '', ['']);
    cookie.secure = secure;
    cookie.httpOnly = httpOnly;

    expect(cookie.isHttpPrefixCompatible).toBe(expected);
  });
});

describe('cookie domain matching (§5.3.2)', () => {
  it.each<[string, string, boolean]>([
    ['example.test', 'example.test', true],
    ['www.example.test', 'example.test', true],
    ['a.b.example.test', 'example.test', true],
    ['example.test', 'www.example.test', false],
    ['notexample.test', 'example.test', false],
    ['example.test.evil', 'example.test', false],
    ['other.test', 'example.test', false],
    ['example.test.', 'example.test', false],
    ['www.example.test.', 'example.test.', true],
    ['EXAMPLE.TEST', 'example.test', true],
    ['www.bücher.test', 'xn--bcher-kva.test', true],
    ['example.com', 'com', true],
    ['127.0.0.1', '127.0.0.1', true],
    ['127.1', '127.0.0.1', true],
    ['127.0.0.2', '127.0.0.1', false],
    ['127.0.0.1', '0.0.1', false],
    ['[2001:db8::1]', '[2001:db8:0:0:0:0:0:1]', true],
    ['[2001:db8::2]', '[2001:db8::1]', false],
    ['127.0.0.1', '[::ffff:127.0.0.1]', false],
  ])('matches host %s against cookie host %s: %s', (host, cookieHost, expected) => {
    const cookie = new HTTPCookie('name', 'value', ['']);
    cookie.host = parseCookieHost(cookieHost);

    expect(cookie.matchesDomain(parseCookieHost(host))).toBe(expected);
  });

  it.each([undefined, null])('does not match an unassigned or failed host: %s', (host) => {
    const cookie = new HTTPCookie('name', 'value', ['']);
    cookie.host = host;

    expect(cookie.matchesDomain(parseCookieHost('example.test'))).toBe(false);
  });
});

describe('cookie default path (§5.3.3)', () => {
  it.each<[string, string[]]>([
    ['/', ['']],
    ['/account', ['']],
    ['/account/', ['account']],
    ['/account/profile', ['account']],
    ['/account/profile/', ['account', 'profile']],
    ['/account//profile', ['account', '']],
    ['//', ['']],
    ['///', ['', '']],
    ['/account%2Fprofile/item', ['account%2Fprofile']],
    ['/account/profile?query#fragment', ['account']],
  ])('derives a separate default path for %s', (input, expected) => {
    const path = parsePath(input);
    const original = [...path];
    const result = HTTPCookie.getDefaultPath(path);

    expect(result).toEqual(expected);
    expect(result).not.toBe(path);
    expect(path).toEqual(original);
    result.push('changed');
    expect(path).toEqual(original);
  });
});

describe('cookie path matching (§5.3.4)', () => {
  it.each<[string, string, boolean]>([
    ['/', '/', true],
    ['/account', '/', true],
    ['/account/', '/', true],
    ['/account', '/account', true],
    ['/account/', '/account', true],
    ['/account/profile', '/account', true],
    ['/accounts', '/account', false],
    ['/accounting/profile', '/account', false],
    ['/', '/account', false],
    ['/account', '/account/', false],
    ['/account/', '/account/', true],
    ['/account/profile', '/account/', true],
    ['/account/profile', '/account/profile/', false],
    ['/account//profile', '/account/', true],
    ['/account/profile', '/account//', false],
    ['/account//profile', '/account//', true],
    ['/', '//', false],
    ['//', '//', true],
    ['//account', '//', true],
    ['/account', '//', false],
    ['/Account', '/account', false],
    ['/a%2Fb/item', '/a%2Fb', true],
    ['/a/b/item', '/a%2Fb', false],
    ['/a%2fb/item', '/a%2Fb', false],
    ['/account/profile?query#fragment', '/account/', true],
  ])('matches request path %s against cookie path %s: %s', (request, path, expected) => {
    const requestPath = parsePath(request);
    const cookiePath = parsePath(path);
    const originalRequest = [...requestPath];
    const originalCookie = [...cookiePath];
    const cookie = new HTTPCookie('name', 'value', cookiePath);

    expect(cookie.matchesPath(requestPath)).toBe(expected);
    expect(requestPath).toEqual(originalRequest);
    expect(cookie.path).toEqual(originalCookie);
  });

  it('does not match an opaque cookie path against a URL path list', () => {
    const cookie = new HTTPCookie('name', 'value', '/account');

    expect(cookie.matchesPath(['account'])).toBe(false);
  });
});

describe('serialize cookies (§5.4.6)', () => {
  it('serializes an empty list as the empty byte string', () => {
    expect(HTTPCookie.serialize([])).toBe('');
  });

  it('keeps the supplied order and omits attributes and the equals sign for an empty name', () => {
    const ordinary = new HTTPCookie('name', 'value', ['']);
    ordinary.secure = ordinary.httpOnly = true;
    ordinary.sameSite = 'strict';
    ordinary.expiryTime = 0;
    const nameless = new HTTPCookie('', 'bare', ['']);
    const emptyValue = new HTTPCookie('empty', '', ['']);
    const cookies = [ordinary, nameless, emptyValue];

    expect(HTTPCookie.serialize(cookies)).toBe('name=value; bare; empty=');
    expect(HTTPCookie.serialize([nameless, ordinary])).toBe('bare; name=value');
    expect(cookies).toEqual([ordinary, nameless, emptyValue]);
  });

  it('preserves byte values, quotes, spaces, and embedded equals signs without escaping', () => {
    expect(HTTPCookie.serialize([
      new HTTPCookie('\x80', '\xff', ['']),
      new HTTPCookie('quoted', '"a b=c"', ['']),
    ])).toBe('\x80=\xff; quoted="a b=c"');
  });
});

function parseCookieHost(input: string): CookieHost {
  const { host } = parseHost(input);
  if (!host || host.kind === 'empty' || host.kind === 'opaque') throw new Error('Expected a domain or IP address');
  return host;
}

function parsePath(input: string): string[] {
  const { url } = parseURL(`https://example.test${input}`);
  if (!url || !Array.isArray(url.path)) throw new Error('Expected a URL path list');
  return url.path;
}
