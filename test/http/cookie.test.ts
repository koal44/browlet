import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HTTPCookie, parseCookieDate, type CookieHost } from '../../src/http/cookie';
import { parseHost } from '../../src/url/host';
import { parseURL } from '../../src/url/url';

const now = Date.UTC(2026, 8, 20);
const day = 86_400_000;

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
});

describe('parse a cookie (§5.4.2)', () => {
  it.each<[string, string, string]>([
    ['name=value', 'name', 'value'],
    ['name=', 'name', ''],
    ['value', '', 'value'],
    ['=value', '', 'value'],
    ['  name\t = \tvalue  ', 'name', 'value'],
    ['name=a=b=c', 'name', 'a=b=c'],
    ['name="quoted value"', 'name', '"quoted value"'],
    ['na\tme=va\tlue', 'na\tme', 'va\tlue'],
    ['\x80=\xff', '\x80', '\xff'],
    ['\xa0name\xa0=\xa0value\xa0', '\xa0name\xa0', '\xa0value\xa0'],
    ['name=value, other=cookie', 'name', 'value, other=cookie'],
    ['name=value;;;; Unknown=a=b; =ignored', 'name', 'value'],
  ])('parses %j without normalizing or unquoting the byte strings', (input, name, value) => {
    const cookie = HTTPCookie.parse(input, ['directory', 'page'], 400);

    expect(cookie).toMatchObject({
      name, value, path: ['directory'], host: undefined, hostOnly: false,
      secure: false, httpOnly: false, sameSite: 'unset', hasPathAttribute: false,
      creationTime: now, lastAccessTime: now, expiryTime: null,
    });
  });

  it('recognizes attribute names case-insensitively and flags independently of their values', () => {
    const cookie = HTTPCookie.parse('name=value; sEcUrE=false;\tHTTPONLY = no; SameSite = lAx', [''], 400);

    expect(cookie).toMatchObject({ secure: true, httpOnly: true, sameSite: 'lax' });
  });

  it.each([
    ['Strict', 'strict'], ['lAx', 'lax'], ['NONE', 'none'],
    ['', 'unset'], ['unknown', 'unset'], ['"Strict"', 'unset'],
  ])('recognizes SameSite=%s as %s', (attribute, expected) => {
    expect(HTTPCookie.parse(`n=v; SameSite=${attribute}`, [''], 400)?.sameSite).toBe(expected);
  });

  it('keeps the last recognized SameSite value when a later attribute is invalid', () => {
    expect(HTTPCookie.parse('n=v; SameSite=Lax; SameSite=Strict; SameSite=bad', [''], 400)?.sameSite).toBe('strict');
  });

  it.each(['', ' ', '\t', '=', ' = ', '; Secure', '=; Path=/'])('rejects the empty name/value pair %j', (input) => {
    expect(HTTPCookie.parse(input, [''], 400)).toBeNull();
  });

  it('limits name plus value to 4096 bytes after trimming, excluding the separator and attributes', () => {
    expect(HTTPCookie.parse('a'.repeat(2048) + '=' + 'b'.repeat(2048), [''], 400)).not.toBeNull();
    expect(HTTPCookie.parse('name=' + 'x'.repeat(4093), [''], 400)).toBeNull();
    expect(HTTPCookie.parse(' \tname=' + 'x'.repeat(4092) + ' \t; Unknown=' + 'x'.repeat(2000), [''], 400)).not.toBeNull();
    expect(HTTPCookie.parse('\xff'.repeat(4096), [''], 400)?.value.length).toBe(4096);
    expect(HTTPCookie.parse('\xff'.repeat(4097), [''], 400)).toBeNull();
  });

  it('ignores attribute values over 1024 bytes after trimming, without discarding the cookie', () => {
    expect(HTTPCookie.parse('n=v; Secure=' + 'x'.repeat(1024), [''], 400)?.secure).toBe(true);
    expect(HTTPCookie.parse('n=v; Secure=' + 'x'.repeat(1025), [''], 400)?.secure).toBe(false);
    expect(HTTPCookie.parse('n=v; HttpOnly=' + 'x'.repeat(1025) + '; Secure', [''], 400))
      .toMatchObject({ httpOnly: false, secure: true });
    expect(HTTPCookie.parse('n=v; Path=/' + 'x'.repeat(1023) + ' \t', [''], 400)?.hasPathAttribute).toBe(true);
    expect(HTTPCookie.parse('n=v; Path=/' + 'x'.repeat(1024), [''], 400)?.hasPathAttribute).toBe(false);
    expect(HTTPCookie.parse('n=v; Domain=' + 'x'.repeat(1025), [''], 400)?.host).toBeUndefined();
  });

  it('rejects every prohibited control byte, including in ignored attributes, but accepts all other bytes', () => {
    for (let byte = 0; byte <= 0xff; byte++) {
      const character = String.fromCharCode(byte);
      const rejected = byte <= 0x08 || byte >= 0x0a && byte <= 0x1f || byte === 0x7f;
      for (const input of [`name=x${character}x`, `name=x; Unknown=x${character}x`]) {
        expect(HTTPCookie.parse(input, [''], 400) === null, `byte ${byte} in ${JSON.stringify(input)}`).toBe(rejected);
      }
    }
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

describe('parse a cookie date (§5.3.1)', () => {
  const example = Date.UTC(2021, 5, 9, 10, 18, 14);

  it.each([
    'Wed, 09 Jun 2021 10:18:14 GMT',
    'Wednesday, 09-Jun-21 10:18:14 GMT',
    'Wed Jun  9 10:18:14 2021',
    '2021 Jun 09 10:18:14',
    '10:18:14 09 jUnE 2021',
    '09junk June99 2021suffix 10:18:14GMT',
    '09 junk 2021 10:18:14:ignored',
    '\t"09/Jun/2021 [10:18:14]"\t',
    'Mon, 09 Jun 2021 10:18:14 PST',
    '09 Jun 2021 10:18:14 +0900',
  ])('accepts %j as UTC without validating the weekday or timezone', (input) => {
    expect(parseCookieDate(input)).toBe(example);
  });

  it.each<[string, number]>([
    ['Jan', 0], ['Feb', 1], ['Mar', 2], ['Apr', 3], ['May', 4], ['Jun', 5],
    ['Jul', 6], ['Aug', 7], ['Sep', 8], ['Oct', 9], ['Nov', 10], ['Dec', 11],
  ])('recognizes month %s', (month, index) => {
    expect(parseCookieDate(`01 ${month} 2021 00:00:00`)).toBe(Date.UTC(2021, index, 1));
  });

  it.each<[string, number]>([
    ['00', 2000], ['01', 2001], ['69', 2069], ['70', 1970], ['99', 1999],
    ['0000', 2000], ['069', 2069], ['0070', 1970], ['1601', 1601], ['9999', 9999],
  ])('interprets year %s as %i independently of the current date', (year, expected) => {
    expect(parseCookieDate(`01 Jan ${year} 00:00:00`)).toBe(Date.UTC(expected, 0, 1));
  });

  it('accepts one-digit clock fields and Gregorian leap days', () => {
    expect(parseCookieDate('29 Feb 2000 1:2:3')).toBe(Date.UTC(2000, 1, 29, 1, 2, 3));
    expect(parseCookieDate('29 Feb 2024 23:59:59')).toBe(Date.UTC(2024, 1, 29, 23, 59, 59));
    expect(parseCookieDate('01 Jan 1970 0:0:0')).toBe(0);
  });

  it.each([
    '', '09 Jun 2021', 'Jun 2021 10:18:14', '09 2021 10:18:14', '09 Jun 10:18:14',
    '00 Jun 2021 10:18:14', '32 Jun 2021 10:18:14', '31 Apr 2021 10:18:14',
    '29 Feb 2021 10:18:14', '29 Feb 1900 10:18:14', '01 Jan 1600 10:18:14',
    '01 Jan 100 10:18:14', '01 Jan 7 10:18:14', '01 Jan 10000 10:18:14',
    '009 Jun 2021 10:18:14', '09 Jun 2021 24:00:00', '09 Jun 2021 10:60:14',
    '09 Jun 2021 10:18:60', '09 Jun 2021 010:18:14', '09 Jun 2021 10:018:14',
    '09 Jun 2021 10:18:014', '09 Jun 2021 10:18', '09 Jun 2021 x10:18:14',
    '09 xJun 2021 10:18:14', 'x09 Jun 2021 10:18:14',
    '69 Jan 01 00:00:00',
  ])('rejects missing or invalid components in %j', (input) => {
    expect(parseCookieDate(input)).toBeNull();
  });

  it('keeps the first recognized value for each component', () => {
    expect(parseCookieDate('09 Jun 2021 10:18:14 25 Dec 2030 20:30:40')).toBe(example);
    expect(parseCookieDate('32 09 Jun 2021 10:18:14')).toBeNull();
    expect(parseCookieDate('09 Jun 1600 2021 10:18:14')).toBeNull();
    expect(parseCookieDate('09 Jun 2021 24:00:00 10:18:14')).toBeNull();
  });

  it('tries the remaining productions after a time has already been found', () => {
    expect(parseCookieDate('10:18:14 09:00:00 Jun 2021')).toBe(example);
    expect(parseCookieDate('09 Jun 10:18:14 21:00:00')).toBe(example);
  });

  it('uses exactly the specified byte delimiters, preserving colons and high bytes within tokens', () => {
    for (let byte = 0; byte <= 0xff; byte++) {
      const delimiter = byte === 0x09 || byte >= 0x20 && byte <= 0x2f ||
        byte >= 0x3b && byte <= 0x40 || byte >= 0x5b && byte <= 0x60 ||
        byte >= 0x7b && byte <= 0x7e;
      const separator = String.fromCharCode(byte);
      const input = `09${separator}Jun${separator}2021${separator}10:18:14`;
      expect(parseCookieDate(input), `separator 0x${byte.toString(16)}`).toBe(delimiter ? example : null);
    }
  });

  it('allows non-digit suffixes without treating them as separators', () => {
    expect(parseCookieDate('09\x80 Jun\xff 2021\x00 10:18:14\x0b')).toBe(example);
    expect(parseCookieDate('noise\x80Jun 09 2021 10:18:14')).toBeNull();
    expect(parseCookieDate('09 Jun 2021\n10:18:14')).toBeNull();
  });
});

describe('cookie expiry attributes (§5.4.2)', () => {
  it('parses Expires as an absolute time and keeps the last valid date', () => {
    const cookie = HTTPCookie.parse(
      'n=v; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Expires=Sun, 20 Sep 2026 00:01:00 GMT; Expires=bad', [''], 400,
    );

    expect(cookie?.expiryTime).toBe(now + 60_000);
  });

  it('leaves invalid Expires as a session cookie', () => {
    expect(HTTPCookie.parse('n=v; Expires=bad', [''], 400)?.expiryTime).toBeNull();
  });

  it.each([1, 30, 400])('caps Expires at now plus the supplied limit of %i days', (limit) => {
    const cookie = HTTPCookie.parse('n=v; Expires=Fri, 31 Dec 9999 23:59:59 GMT', [''], limit);

    expect(cookie?.expiryTime).toBe(now + limit * day);
    expect(cookie?.isExpired).toBe(false);
  });

  it('does not move an earlier expiry forward to the cap', () => {
    expect(HTTPCookie.parse('n=v; Expires=Thu, 01 Jan 1970 00:00:00 GMT', [''], 400)?.expiryTime).toBe(0);
  });

  it.each(['60', '00060', ' 60\t'])('interprets Max-Age=%j in seconds', (attribute) => {
    expect(HTTPCookie.parse(`n=v; Max-Age=${attribute}`, [''], 400)?.expiryTime).toBe(now + 60_000);
  });

  it.each(['0', '-0', '-1', '-99999999999999999999999999999999999999'])('expires Max-Age=%s immediately', (attribute) => {
    const cookie = HTTPCookie.parse(`n=v; Max-Age=${attribute}`, [''], 400);
    expect(cookie?.isExpired).toBe(true);
    expect(new Date(cookie!.expiryTime!).getTime()).not.toBeNaN();
  });

  it.each(['', '-', '+60', '1.5', '1e3', '1x', '1 2', '--1', 'Infinity', '0x10', '\xff'])('ignores invalid Max-Age=%j', (attribute) => {
    expect(HTTPCookie.parse(`n=v; Max-Age=${attribute}`, [''], 400)?.expiryTime).toBeNull();
  });

  it('caps an overflowing positive Max-Age before calculating the absolute timestamp', () => {
    expect(HTTPCookie.parse('n=v; Max-Age=' + '9'.repeat(1024), [''], 7)?.expiryTime).toBe(now + 7 * day);
    expect(HTTPCookie.parse('n=v; Max-Age=' + '9'.repeat(1025), [''], 7)?.expiryTime).toBeNull();
  });

  it.each([
    'Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=60',
    'Max-Age=60; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Max-Age=60; Max-Age=bad; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Max-Age=10; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=60',
  ])('gives valid Max-Age precedence across the whole attribute list: %s', (attributes) => {
    expect(HTTPCookie.parse(`n=v; ${attributes}`, [''], 400)?.expiryTime).toBe(now + 60_000);
  });

  it('allows Expires after an invalid Max-Age', () => {
    expect(HTTPCookie.parse('n=v; Max-Age=bad; Expires=Thu, 01 Jan 1970 00:00:00 GMT', [''], 400)?.expiryTime).toBe(0);
  });
});

describe('cookie Domain and Path attributes (§5.4.2)', () => {
  it.each([
    ['EXAMPLE.COM', { kind: 'domain', value: 'example.com' }],
    ['.Example.com', { kind: 'domain', value: 'example.com' }],
    ['xn--bcher-kva.example', { kind: 'domain', value: 'xn--bcher-kva.example' }],
    ['127.1', { kind: 'ipv4', value: 0x7f000001 }],
    ['[::1]', { kind: 'ipv6', pieces: [0, 0, 0, 0, 0, 0, 0, 1] }],
  ])('uses URL host parsing for Domain=%s', (attribute, host) => {
    expect(HTTPCookie.parse(`n=v; Domain=${attribute}`, [''], 400)?.host).toEqual(host);
  });

  it.each(['', '.', 'bad host', 'example.com:443', '[::1', '\xfc.example'])('retains a failed Domain=%j parse for storage to reject', (attribute) => {
    const cookie = HTTPCookie.parse(`n=v; Domain=${attribute}`, [''], 400);
    expect(cookie).not.toBeNull();
    expect(cookie?.host).toBeNull();
  });

  it('distinguishes an absent host, a failed final host, and a later recovered host', () => {
    expect(HTTPCookie.parse('n=v', [''], 400)?.host).toBeUndefined();
    expect(HTTPCookie.parse('n=v; Domain=example.com; Domain=', [''], 400)?.host).toBeNull();
    expect(HTTPCookie.parse('n=v; Domain=; Domain=example.com', [''], 400)?.host).toEqual({ kind: 'domain', value: 'example.com' });
  });

  it('copies the default path instead of retaining the supplied array', () => {
    const path = ['directory', 'page'];
    const cookie = HTTPCookie.parse('n=v', path, 400);
    path[0] = 'changed';

    expect(cookie?.path).toEqual(['directory']);
    expect(cookie?.hasPathAttribute).toBe(false);
  });

  it.each<[string, string[]]>([
    ['/', ['']], ['/account', ['account']], ['/account/', ['account', '']],
    ['//account//', ['', 'account', '', '']], ['/a/../b', ['a', '..', 'b']],
    ['/a%2Fb', ['a%2Fb']], ['/a?b#c', ['a?b#c']], ['/a\\b', ['a\\b']],
  ])('retains the literal Path=%s segments', (attribute, path) => {
    expect(HTTPCookie.parse(`n=v; Path=${attribute}`, ['directory', 'page'], 400))
      .toMatchObject({ path, hasPathAttribute: true });
  });

  it.each(['', 'relative', '"/quoted"'])('ignores Path=%j and retains the default', (attribute) => {
    expect(HTTPCookie.parse(`n=v; Path=${attribute}`, ['directory', 'page'], 400))
      .toMatchObject({ path: ['directory'], hasPathAttribute: false });
  });

  it('keeps the last slash-prefixed Path and only then checks whether it is ASCII', () => {
    expect(HTTPCookie.parse('n=v; Path=/first; Path=/last; Path=relative', [''], 400)?.path).toEqual(['last']);
    expect(HTTPCookie.parse('n=v; Path=/\xff; Path=/valid', [''], 400)?.path).toEqual(['valid']);
    expect(HTTPCookie.parse('n=v; Path=/valid; Path=/\xff', [''], 400)).toBeNull();
    expect(HTTPCookie.parse('n=v; Path=/\xff; Path=relative', [''], 400)).toBeNull();
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

describe('cookie name prefixes (§5.1.2)', () => {
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
